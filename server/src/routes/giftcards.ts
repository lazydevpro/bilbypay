import type { Hono } from "hono";
import { z } from "zod";
import { errors } from "../errors";
import type { Services } from "../services";
import { type AppEnv, body, requireSession } from "./common";

export function giftCardRoutes(app: Hono<AppEnv>, s: Services) {
  app.get("/v1/giftcards/catalog", async (c) => {
    const country = (c.req.query("country") ?? "US").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw errors.invalidRequest();
    return c.json({ brands: await s.gifts.catalogView(country) });
  });

  app.post("/v1/giftcards/quote", async (c) => {
    const { brandId, amount } = await body(c, z.object({ brandId: z.string().max(80), amount: z.string().regex(/^\d{1,30}$/) }));
    return c.json(await s.gifts.quoteView(brandId, BigInt(amount)));
  });

  app.get("/v1/giftcards", requireSession(s), (c) => c.json({ cards: s.gifts.list(c.get("user")) }));

  app.get("/v1/giftcards/:id/reveal", requireSession(s), (c) => {
    const redemption = s.gifts.reveal(c.get("user"), c.req.param("id"));
    c.header("Cache-Control", "no-store");
    return c.json(redemption);
  });
}
