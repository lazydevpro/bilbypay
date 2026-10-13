import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgoraClient, AgoraError, agoraAmount, jwtExpiryMs, MINT_DIRECTIONS } from "../src/agora/client";
import { AgoraService } from "../src/agora/service";
import { Tokens } from "../src/auth";
import { loadAgoraConfig } from "../src/config";
import { openDb, type Db } from "../src/db";
import { ApiError } from "../src/errors";
import { agoraRoutes } from "../src/routes/agora";
import type { AppEnv } from "../src/routes/common";
import type { Services } from "../src/services";

const KEY = "test-agora-access-key-do-not-log";
const BASE = "https://api.agora.finance";
const METRICS = {
  chains: [
    { chainId: "eip155:1", circulatingSupply: "64870315.160326", network: "ethereum", totalSupply: "71919999.240777" },
    { chainId: "eip155:143", circulatingSupply: "104350204.252830", network: "monad", totalSupply: "109206890.954020" },
    { chainId: "sui:mainnet", circulatingSupply: "0.000000", network: "sui", totalSupply: "1875101.170135" },
  ],
  circulatingSupply: "169220519.413156", partial: false, totalSupply: "183001991.364932",
};
const ROUTE = {
  id: "8d7f3a52-3f61-4f0c-9a43-0c7b0e2f7c11", name: null, createdAt: "2026-10-01T00:00:00Z", direction: "mint-fiat",
  to: { currency: "ausd", accountId: "0b5c3a3e-7d55-4a51-8f1e-5d0f9f1a2b3c", chain: "monad" },
  instructions: [{ memo: "AGR-123", beneficiaryName: "Agora", beneficiaryAddress: "1 St", accountNumber: "000123", bankName: "Bank", bankAddress: "2 St", routingNumber: "021000021", supportedCurrencies: ["usd"] }],
};

function jwt(expSeconds: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "ES256" })}.${b64({ exp: expSeconds, sub: "org" })}.sig`;
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req-1", ...headers } });

function fakeAgora(opts: { now: () => number; tokenTtlS?: number; failMetrics?: boolean }) {
  const calls: { method: string; url: string; auth?: string }[] = [];
  let tokens = 0;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ method: init?.method ?? "GET", url, auth });
    const path = new URL(url).pathname;
    if (path === "/v0/metrics") return opts.failMetrics ? json({ code: "internal_error", message: "boom", docs_url: "x" }, 500) : json(METRICS);
    if (path === "/v0/auth/token") {
      if (auth !== `Bearer ${KEY}`) return json({ code: "unauthorized", message: "bad key", docs_url: "x", context: { reason: "invalid_token" } }, 401);
      tokens += 1;
      return json({ sessionJwt: jwt(Math.floor(opts.now() / 1000) + (opts.tokenTtlS ?? 900)) });
    }
    if (!auth?.startsWith("Bearer ey")) return json({ code: "unauthorized", message: "jwt required", docs_url: "x", context: { reason: "missing_header" } }, 401);
    if (path === "/v0/routes") return json({ data: [ROUTE], nextCursor: null });
    if (path === `/v0/routes/${ROUTE.id}`) return json(ROUTE);
    if (path.startsWith("/v0/routes/")) return json({ code: "not_found", message: "no route", docs_url: "x" }, 404, { "request-id": "req-404" });
    if (path === "/v0/transactions") return json({ data: [], nextCursor: null });
    return json({ code: "not_found", message: "?", docs_url: "x" }, 404);
  });
  return { fetcher, calls, tokens: () => tokens };
}

describe("Agora client", () => {
  it("converts decimal-string amounts to 6-decimal base units", () => {
    expect(agoraAmount("104350204.252830")).toBe(104_350_204_252_830n);
    expect(agoraAmount("0.000000")).toBe(0n);
    expect(agoraAmount("12")).toBe(12_000_000n);
    expect(agoraAmount("1.123456789")).toBe(1_123_456n); // truncated, never rounded up
    expect(() => agoraAmount("-1")).toThrow(AgoraError);
    expect(() => agoraAmount("1e6")).toThrow(AgoraError);
  });

  it("reads public metrics without a key", async () => {
    const f = fakeAgora({ now: Date.now });
    const m = await new AgoraClient({ fetch: f.fetcher }).metrics();
    expect(m.totalSupply).toBe(183_001_991_364_932n);
    expect(m.chains.find((c) => c.network === "monad")?.circulatingSupply).toBe(104_350_204_252_830n);
    expect(f.calls).toEqual([{ method: "GET", url: `${BASE}/v0/metrics`, auth: undefined }]);
  });

  it("exchanges the key for a session JWT once, caches it until shortly before exp, then refreshes", async () => {
    let now = Date.parse("2026-10-14T00:00:00Z");
    const f = fakeAgora({ now: () => now, tokenTtlS: 600 });
    const client = new AgoraClient({ apiKey: KEY, fetch: f.fetcher, now: () => now });
    await Promise.all([client.listRoutes({ direction: MINT_DIRECTIONS, toChain: ["monad"] }), client.listTransactions({ type: ["mint"] })]);
    expect(f.tokens()).toBe(1);
    // The key goes only to the token endpoint; everything else uses the JWT.
    for (const c of f.calls) {
      if (c.url.endsWith("/v0/auth/token")) expect(c).toMatchObject({ method: "POST", auth: `Bearer ${KEY}` });
      else expect(c.auth).not.toContain(KEY);
    }
    expect(f.calls.find((c) => c.url.includes("/v0/routes"))!.url).toBe(`${BASE}/v0/routes?direction=mint-fiat%2Cmint-stablecoin&toChain=monad`);
    now += 8 * 60_000; // still > 60 s before exp
    await client.listRoutes();
    expect(f.tokens()).toBe(1);
    now += 90_000; // inside the refresh window
    await client.listRoutes();
    expect(f.tokens()).toBe(2);
  });

  it("maps errors to code/message/Request-Id and never puts the key in the error", async () => {
    const f = fakeAgora({ now: Date.now });
    const bad = new AgoraClient({ apiKey: "wrong-key", fetch: f.fetcher });
    const err = await bad.listRoutes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgoraError);
    expect(err).toMatchObject({ status: 401, code: "unauthorized", reason: "invalid_token", requestId: "req-1" });
    expect(String((err as Error).message)).not.toContain("wrong-key");

    const good = new AgoraClient({ apiKey: KEY, fetch: f.fetcher });
    await expect(good.getRoute("8d7f3a52-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404, code: "not_found", requestId: "req-404" });
    await expect(new AgoraClient({ fetch: f.fetcher }).sessionJwt()).rejects.toMatchObject({ code: "not_configured" });

    const offline = new AgoraClient({ fetch: async () => { throw new TypeError("fetch failed"); } });
    await expect(offline.metrics()).rejects.toMatchObject({ status: 503, code: "network_error" });
  });

  it("reads exp from a JWT and tolerates junk", () => {
    expect(jwtExpiryMs(jwt(1_800_000_000))).toBe(1_800_000_000_000);
    expect(jwtExpiryMs("not-a-jwt")).toBeUndefined();
  });
});

describe("Agora service + routes", () => {
  const dbs: Db[] = [];
  afterEach(() => { for (const db of dbs.splice(0)) db.close(); vi.restoreAllMocks(); });

  function appWith(agora: AgoraService) {
    const db = openDb(":memory:"); dbs.push(db);
    const tokens = new Tokens(new Uint8Array(32).fill(7));
    const app = new Hono<AppEnv>();
    app.onError((e, c) => (e instanceof ApiError ? c.json(e.toBody(), e.status as 400) : c.json({ error: { code: "INTERNAL" } }, 500)));
    agoraRoutes(app, { db, tokens, agora } as unknown as Services);
    return { app, tokens };
  }

  it("GET /v1/agora/metrics is public, base-unit strings, Monad highlighted, cached ~5 min, stale on outage", async () => {
    let now = Date.parse("2026-10-14T00:00:00Z");
    const f = fakeAgora({ now: () => now });
    const agora = new AgoraService({}, { fetch: f.fetcher, now: () => now });
    const { app } = appWith(agora);
    const res = await app.request("/v1/agora/metrics");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      source: "agora", asset: "AUSD", partial: false, totalSupply: "183001991364932", circulatingSupply: "169220519413156",
      home: { network: "monad", chainId: "eip155:143", circulatingSupply: "104350204252830" },
    });
    expect(body.networks.map((n: { network: string }) => n.network)).toEqual(["monad", "ethereum", "sui"]);
    await app.request("/v1/agora/metrics");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    now += 5 * 60_000 + 1;
    await app.request("/v1/agora/metrics");
    expect(f.fetcher).toHaveBeenCalledTimes(2);

    // Agora down: keep serving the last figures, flagged stale.
    vi.spyOn(console, "error").mockImplementation(() => {});
    f.fetcher.mockImplementation(async () => json({ code: "internal_error", message: "boom", docs_url: "x" }, 500));
    now += 5 * 60_000 + 1;
    const stale = await (await app.request("/v1/agora/metrics")).json();
    expect(stale).toMatchObject({ stale: true, totalSupply: "183001991364932" });
  });

  it("answers 503 AGORA_UNAVAILABLE when Agora is down and nothing is cached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeAgora({ now: Date.now, failMetrics: true });
    const { app } = appWith(new AgoraService({}, { fetch: f.fetcher }));
    const res = await app.request("/v1/agora/metrics");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("AGORA_UNAVAILABLE");
  });

  it("mint instructions need a session, and without AGORA_API_KEY say not configured (no upstream call)", async () => {
    const f = fakeAgora({ now: Date.now });
    const { app, tokens } = appWith(new AgoraService({}, { fetch: f.fetcher }));
    expect((await app.request("/v1/agora/mint-instructions")).status).toBe(401);
    const token = await tokens.sessionToken("0x1111111111111111111111111111111111111111");
    const res = await app.request("/v1/agora/mint-instructions", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("AGORA_NOT_CONFIGURED");
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("with a key, returns Monad mint routes with settlement instructions; logs never contain the key", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeAgora({ now: Date.now });
    const { app, tokens } = appWith(new AgoraService({ apiKey: KEY }, { fetch: f.fetcher }));
    const token = await tokens.sessionToken("0x1111111111111111111111111111111111111111");
    const headers = { Authorization: `Bearer ${token}` };
    const list = await (await app.request("/v1/agora/mint-instructions", { headers })).json();
    expect(list).toMatchObject({ source: "agora", nextCursor: null, routes: [{ id: ROUTE.id, direction: "mint-fiat", to: { chain: "monad" } }] });
    expect(list.routes[0].instructions[0]).toMatchObject({ memo: "AGR-123", routingNumber: "021000021" });
    expect((await app.request(`/v1/agora/routes/${ROUTE.id}`, { headers })).status).toBe(200);
    expect((await app.request("/v1/agora/routes/8d7f3a52-0000-0000-0000-000000000000", { headers })).status).toBe(404);
    expect((await app.request("/v1/agora/routes/not-a-uuid", { headers })).status).toBe(404);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(logs.mock.calls)).toContain("req-404");
  });

  it("config: key optional, base must be HTTPS", () => {
    expect(loadAgoraConfig({})).toEqual({ apiKey: undefined, baseUrl: undefined });
    expect(loadAgoraConfig({ AGORA_API_KEY: "k", AGORA_API_BASE: "https://api.agorafi.co" })).toEqual({ apiKey: "k", baseUrl: "https://api.agorafi.co" });
    expect(() => loadAgoraConfig({ AGORA_API_BASE: "http://api.agora.finance" })).toThrow();
  });
});

// Live: the real public endpoint. Skips (passes) when offline.
describe("Agora live /v0/metrics", () => {
  it("returns AUSD supply including Monad", async () => {
    let m;
    try {
      m = await new AgoraClient({ timeoutMs: 8_000 }).metrics();
    } catch (e) {
      if (e instanceof AgoraError && e.code === "network_error") { console.warn("offline: skipping live Agora metrics check"); return; }
      throw e;
    }
    expect(m.chains.length).toBeGreaterThan(0);
    const monad = m.chains.find((c) => c.network === "monad");
    if (monad) console.info(`live Agora: Monad AUSD circulating ${monad.circulatingSupply} / total ${monad.totalSupply} (base units)`);
    if (!m.partial) expect(m.totalSupply).toBeGreaterThan(0n);
  }, 15_000);
});
