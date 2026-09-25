import type { Hono } from "hono";
import { z } from "zod";
import type { Services } from "../services";
import { type AppEnv, body, requireSession } from "./common";

export function claimRoutes(app: Hono<AppEnv>, s: Services) {
  app.get("/v1/claims/:code", (c) => c.json(s.claims.view(c.req.param("code"))));

  app.post("/v1/claims/:code/accept", requireSession(s), async (c) => {
    const { phoneToken, brandId } = await body(c, z.object({ phoneToken: z.string(), brandId: z.string().max(80).optional() }));
    return c.json(await s.claims.accept(c.req.param("code"), c.get("user"), phoneToken, brandId));
  });
}
