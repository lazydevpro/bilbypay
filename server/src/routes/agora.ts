import type { Hono } from "hono";
import { errors } from "../errors";
import { rateLimit } from "../db";
import type { Services } from "../services";
import { type AppEnv, requireSession } from "./common";

/**
 * Agora AUSD (https://api.agora.finance).
 * - GET /v1/agora/metrics: public AUSD supply (total + per network, Monad highlighted). No key needed.
 * - GET /v1/agora/mint-instructions, /v1/agora/routes/:id: settlement instructions for turning dollars into
 *   AUSD on Monad. Need AGORA_API_KEY; without it they answer 503 AGORA_NOT_CONFIGURED.
 */
export function agoraRoutes(app: Hono<AppEnv>, s: Services) {
  app.get("/v1/agora/metrics", async (c) => {
    const view = await s.agora.metrics();
    c.header("Cache-Control", "public, max-age=60");
    return c.json(view);
  });
  app.get("/v1/agora/mint-instructions", requireSession(s), async (c) => {
    if (!rateLimit(s.db, `agora_routes:${c.get("user")}`, 30, 60_000)) throw errors.rateLimited();
    const cursor = c.req.query("cursor");
    if (cursor !== undefined && cursor.length > 500) throw errors.invalidRequest();
    return c.json(await s.agora.mintInstructions(cursor || undefined));
  });
  app.get("/v1/agora/routes/:id", requireSession(s), async (c) => {
    if (!rateLimit(s.db, `agora_routes:${c.get("user")}`, 30, 60_000)) throw errors.rateLimited();
    const id = c.req.param("id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw errors.notFound();
    return c.json(await s.agora.route(id));
  });
}
