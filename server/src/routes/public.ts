import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { SERVER_ROOT } from "../config";
import type { Services } from "../services";
import { ogPng, type ShareView, sharePage } from "../share";
import type { AppEnv } from "./common";

const WELL_KNOWN = ["apple-app-site-association", "assetlinks.json"];

/** Share links, OG images, universal-link files, health. Not under /v1. */
export function publicRoutes(app: Hono<AppEnv>, s: Services) {
  const view = (code: string): ShareView | undefined => {
    try {
      return s.claims.view(code);
    } catch {
      return undefined;
    }
  };

  app.get("/c/:code", (c) => {
    const code = c.req.param("code");
    const v = view(code);
    const html = sharePage({ code, view: v, baseUrl: s.config.publicBaseUrl, appStoreUrl: s.config.appStoreUrl, playStoreUrl: s.config.playStoreUrl, webAppUrl: s.config.webAppUrl });
    return c.html(html, v ? 200 : 404);
  });

  app.get("/og/:file", async (c) => {
    const m = /^(.+)\.png$/.exec(c.req.param("file"));
    if (!m) return c.notFound();
    const png = await ogPng(view(m[1]!));
    return c.body(png as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" });
  });

  for (const name of WELL_KNOWN) {
    let content: string;
    try {
      content = readFileSync(resolve(SERVER_ROOT, "public/.well-known", name), "utf8");
    } catch {
      continue; // no filesystem (Cloudflare Worker): the passkey domain's site serves these files instead
    }
    app.get(`/.well-known/${name}`, (c) => c.body(content, 200, { "Content-Type": "application/json" }));
  }

  app.get("/health", async (c) => {
    const [block, relayerBalance, treasuryFloat] = await Promise.all([
      s.chain.client.getBlockNumber(),
      s.chain.client.getBalance({ address: s.relayer.address }),
      s.gifts.provider.floatAvailable(),
    ]);
    return c.json({
      ok: true,
      chainId: s.config.chainId,
      block: Number(block),
      relayerBalance: relayerBalance.toString(),
      treasuryFloat: treasuryFloat.toString(),
      ...(s.welcome.amount > 0n ? { welcomeGrant: s.welcome.amount.toString() } : {}),
    });
  });
}
