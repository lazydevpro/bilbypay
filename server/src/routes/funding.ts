import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { rateLimit } from "../db";
import { ApiError, errors } from "../errors";
import type { Services } from "../services";
import { type AppEnv, body, requireSession } from "./common";

export function fundingRoutes(app: Hono<AppEnv>, s: Services) {
  app.get("/v1/funding/options", requireSession(s), async (c) => {
    if (!rateLimit(s.db, `funding_options:${c.get("user")}`, 60, 60_000)) throw errors.rateLimited();
    return c.json(await s.funding.options());
  });
  app.post("/v1/funding/sessions", requireSession(s), async (c) => {
    if (!rateLimit(s.db, `funding_create:${c.get("user")}`, 20, 60_000)) throw errors.rateLimited();
    const input = await body(c, z.object({ amount: z.string().max(20), returnUrl: z.string().max(2000), idempotencyKey: z.string().max(100) }).strict());
    return c.json(await s.funding.create(c.get("user"), input));
  });
  app.get("/v1/funding/sessions/:id", requireSession(s), async (c) => {
    if (!rateLimit(s.db, `funding_status:${c.get("user")}`, 120, 60_000)) throw errors.rateLimited();
    return c.json(await s.funding.get(c.get("user"), c.req.param("id")));
  });
  app.post("/v1/funding/webhooks/ramp/:id", bodyLimit({ maxSize: 64_000, onError: () => { throw new ApiError(413, "FUNDING_WEBHOOK_INVALID", "Provider update is too large."); } }), async (c) => {
    s.funding.webhook(c.req.param("id"), await c.req.text(), c.req.header("x-body-signature"));
    return c.body(null, 204);
  });
}
