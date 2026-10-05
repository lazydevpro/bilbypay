import type { Hono } from "hono";
import { z } from "zod";
import { errors } from "../errors";
import type { Services } from "../services";
import { type AppEnv, body, requireSession } from "./common";

const ACTION_TYPES = ["send", "gift_send", "gift_buy", "cancel", "burrow_autosave", "burrow_add", "burrow_withdraw"] as const;

/** Balance, contacts, prepare → submit, activity. */
export function moneyRoutes(app: Hono<AppEnv>, s: Services) {
  const auth = requireSession(s);

  app.get("/v1/balance", auth, async (c) => c.json(await s.balances.balance(c.get("user"))));

  app.post("/v1/resolve", auth, async (c) => {
    const { phones, region } = await body(c, z.object({ phones: z.array(z.string().max(40)).max(200), region: z.string().length(2).optional() }));
    s.accounts.requireRegistered(c.get("user"));
    return c.json({ results: await s.accounts.resolve(c.get("user"), phones, region) });
  });

  app.post("/v1/actions", auth, async (c) => {
    const { type, params } = await body(c, z.object({ type: z.enum(ACTION_TYPES), params: z.record(z.string(), z.unknown()).default({}) }));
    return c.json(await s.actions.prepare(c.get("user"), type, params));
  });

  app.post("/v1/actions/:id/submit", auth, async (c) => {
    const { signatures } = await body(c, z.object({ signatures: z.record(z.string(), z.string()) }));
    return c.json(await s.actions.submit(c.get("user"), c.req.param("id"), signatures));
  });

  app.get("/v1/activity", auth, (c) => {
    const cursor = c.req.query("cursor");
    if (cursor !== undefined && !/^\d+$/.test(cursor)) throw errors.invalidRequest();
    return c.json(s.activity.list(c.get("user"), cursor));
  });
}
