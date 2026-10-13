import { Hono } from "hono";
import { cors } from "hono/cors";
import { ApiError, errors } from "./errors";
import { claimRoutes } from "./routes/claims";
import type { AppEnv } from "./routes/common";
import { giftCardRoutes } from "./routes/giftcards";
import { identityRoutes } from "./routes/identity";
import { moneyRoutes } from "./routes/money";
import { publicRoutes } from "./routes/public";
import { topUpRoutes } from "./routes/topup";
import { fundingRoutes } from "./routes/funding";
import type { Services } from "./services";

export function createApp(s: Services, options: { corsOrigins?: string } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const origins = (options.corsOrigins ?? process.env.CORS_ORIGINS ?? "").split(",").map((value: string) => value.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsed: URL;
    try { parsed = new URL(origin); }
    catch { throw new Error("CORS_ORIGINS must contain exact HTTP or HTTPS origins separated by commas"); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.hostname.includes("*") || parsed.origin !== origin) {
      throw new Error("CORS_ORIGINS must contain exact HTTP or HTTPS origins separated by commas");
    }
  }
  app.use("*", cors({
    origin: origins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    credentials: false,
    maxAge: 600,
  }));

  app.onError((err, c) => {
    const e = err instanceof ApiError ? err : errors.internal();
    // Log only our own failures; request bodies (which may hold codes or tokens) are never logged.
    if (!(err instanceof ApiError)) console.error(`${c.req.method} ${c.req.path}:`, err instanceof Error ? (err.stack ?? err.message) : err);
    return c.json(e.toBody(), e.status as 400);
  });
  app.notFound((c) => c.json(errors.notFound().toBody(), 404));

  identityRoutes(app, s);
  moneyRoutes(app, s);
  claimRoutes(app, s);
  giftCardRoutes(app, s);
  topUpRoutes(app, s);
  fundingRoutes(app, s);
  publicRoutes(app, s);
  return app;
}
