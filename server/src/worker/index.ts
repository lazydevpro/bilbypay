/**
 * BilbyPay API on Cloudflare: a Worker in front of one SQLite-backed Durable Object that runs the same Hono app as
 * the Node server (src/main.ts). The object's SQLite database replaces the data/*.db file and its alarm replaces
 * the keeper/directory timers. Deploy: see server/README.md ("Cloudflare").
 */
import { DurableObject } from "cloudflare:workers";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import interBold from "../../assets/fonts/Inter_700Bold.ttf";
import interRegular from "../../assets/fonts/Inter_400Regular.ttf";
import testnetDeployment from "../../../contracts/deployments/10143-v2.json";
import { createApp } from "../app";
import { loadConfig } from "../config";
import { migrate } from "../db";
import { createServices, type Services } from "../services";
import { provideOgAssets } from "../share";
import { durableObjectDb } from "./do-db";

export interface Env {
  BILBY_API: DurableObjectNamespace<BilbyApi>;
  /** Bearer token for /__admin/* (one-time data import, cursor repair). Unset = admin routes disabled. */
  ADMIN_TOKEN?: string;
  /** Seconds between keeper + directory passes (alarm interval). */
  TICK_SECONDS?: string;
  [key: string]: unknown;
}

const BUNDLED_DEPLOYMENTS: Record<string, unknown> = { "10143": testnetDeployment };

/** The string vars/secrets, as the Node server would see them in process.env. */
function stringEnv(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;
  const chainId = out.CHAIN_ID ?? "143";
  if (!out.DEPLOYMENT_JSON && !out.AUSD_ADDRESS && BUNDLED_DEPLOYMENTS[chainId]) {
    out.DEPLOYMENT_JSON = JSON.stringify(BUNDLED_DEPLOYMENTS[chainId]);
  }
  out.DATABASE_PATH = ":memory:"; // unused: the Durable Object's storage is passed in directly
  return out;
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export class BilbyApi extends DurableObject<Env> {
  private readonly services: Services;
  private readonly app: ReturnType<typeof createApp>;
  private readonly tickMs: number;
  private readonly corsOrigins: string;
  private readonly startedAt = new Date().toISOString();

  /** Last errors logged inside the object (wrangler tail doesn't show Durable Object logs); see /__admin/stats. */
  private readonly recentErrors: { at: string; message: string }[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const logError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      const message = args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      this.recentErrors.push({ at: new Date().toISOString(), message: message.slice(0, 2000) });
      if (this.recentErrors.length > 20) this.recentErrors.shift();
      logError(...args);
    };
    provideOgAssets({ wasm: resvgWasm, fonts: [interRegular, interBold] });
    const db = durableObjectDb(ctx.storage);
    migrate(db);
    const vars = stringEnv(env);
    const config = loadConfig(vars);
    this.services = createServices(config, { db });
    this.corsOrigins = vars.CORS_ORIGINS ?? "";
    this.app = createApp(this.services, { corsOrigins: this.corsOrigins });
    this.tickMs = Math.max(2, Number(env.TICK_SECONDS ?? "10")) * 1000;
    void ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 1_000);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__admin/")) return this.admin(request, url);
    return this.app.fetch(request);
  }

  /** Background work the Node server ran on timers: keeper jobs, then directory reconciliation. */
  override async alarm(): Promise<void> {
    // Maintenance switch (kv "admin:paused" = "1", set via /__admin/kv): keeps imports and cursor repairs race-free.
    const paused = this.ctx.storage.sql.exec("SELECT value FROM kv WHERE key = 'admin:paused'").toArray()[0]?.value === "1";
    if (paused) {
      await this.ctx.storage.setAlarm(Date.now() + this.tickMs);
      return;
    }
    try {
      if (this.services.config.keeper.enabled) await this.services.keeper.tick();
    } catch (e) {
      console.error("keeper tick failed", e instanceof Error ? e.message : e);
    }
    try {
      await this.services.directoryCache.runOnce();
    } catch (e) {
      console.error("directory reconciliation failed", e instanceof Error ? e.message : e);
    }
    await this.ctx.storage.setAlarm(Date.now() + this.tickMs);
  }

  private async admin(request: Request, url: URL): Promise<Response> {
    const token = this.env.ADMIN_TOKEN;
    const given = /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!token || !sameSecret(given, token)) return new Response("Not found", { status: 404 });
    const sql = this.ctx.storage.sql;
    const tables = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'")
      .toArray().map((r) => String(r.name));

    if (url.pathname === "/__admin/stats" && request.method === "GET") {
      const counts = Object.fromEntries(tables.map((t) => [t, Number(sql.exec(`SELECT COUNT(*) AS n FROM "${t}"`).one().n)]));
      const kv = sql.exec("SELECT key, value FROM kv").toArray();
      return Response.json({ counts, kv, alarm: await this.ctx.storage.getAlarm(), corsOrigins: this.corsOrigins, startedAt: this.startedAt, recentErrors: this.recentErrors });
    }

    // Restart the object so it re-reads vars/secrets (a deploy doesn't always recycle a busy instance promptly).
    if (url.pathname === "/__admin/restart" && request.method === "POST") {
      this.ctx.abort("admin restart");
    }

    // One-time copy of the Node server's SQLite data: { tables: { name: rows[] } }. Refuses to overwrite a
    // database that already has accounts unless ?replace=1.
    if (url.pathname === "/__admin/import" && request.method === "POST") {
      const body = (await request.json()) as { tables: Record<string, Record<string, unknown>[]> };
      const replace = url.searchParams.get("replace") === "1";
      const existing = Number(sql.exec("SELECT COUNT(*) AS n FROM accounts").one().n);
      if (existing && !replace) return Response.json({ error: `accounts already has ${existing} rows; pass ?replace=1` }, { status: 409 });
      const inserted: Record<string, number> = {};
      this.ctx.storage.transactionSync(() => {
        // Foreign keys are enforced here; check them once at commit, after every table is replaced.
        sql.exec("PRAGMA defer_foreign_keys = ON");
        for (const [table, rows] of Object.entries(body.tables)) {
          if (!tables.includes(table)) throw new Error(`unknown table ${table}`);
          if (replace) sql.exec(`DELETE FROM "${table}"`);
          for (const row of rows) {
            const cols = Object.keys(row);
            if (cols.some((c) => !/^[a-z_][a-z0-9_]*$/i.test(c))) throw new Error(`bad column in ${table}`);
            sql.exec(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
              ...cols.map((c) => row[c] ?? null));
          }
          inserted[table] = rows.length;
        }
      });
      return Response.json({ inserted });
    }

    // Cursor repair: { set?: { key: value }, delete?: [key] } on the kv table.
    if (url.pathname === "/__admin/kv" && request.method === "POST") {
      const body = (await request.json()) as { set?: Record<string, string>; delete?: string[] };
      this.ctx.storage.transactionSync(() => {
        for (const key of body.delete ?? []) sql.exec("DELETE FROM kv WHERE key = ?", key);
        for (const [key, value] of Object.entries(body.set ?? {})) {
          sql.exec("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
        }
      });
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    // One object holds the whole database: the server was written around a single SQLite file, and traffic is small.
    return env.BILBY_API.getByName("main").fetch(request);
  },
} satisfies ExportedHandler<Env>;
