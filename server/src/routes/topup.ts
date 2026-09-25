import type { Hono } from "hono";
import type { Address } from "viem";
import { z } from "zod";
import { errors } from "../errors";
import type { Services } from "../services";
import { type AppEnv, body, requireSession } from "./common";

/** Top-ups from other networks (docs/api.md "Top-up"); settlement lives in TopUpService. */
export function topUpRoutes(app: Hono<AppEnv>, s: Services) {
  app.get("/v1/topup/origins", requireSession(s), (c) =>
    c.json({ origins: s.topups.origins().map(({ id, label, symbol, networkLabel }) => ({ id, label, symbol, networkLabel })) }),
  );

  app.post("/v1/topup/quote", requireSession(s), async (c) => {
    const { originAsset, amount } = await body(c, z.object({ originAsset: z.string().max(200), amount: z.string().regex(/^\d{1,30}$/) }));
    const quote = await s.topups.quote(c.get("user") as Address, originAsset, BigInt(amount));
    if (!quote.depositAddress) throw errors.internal();
    return c.json({
      quoteId: quote.quoteId,
      depositAddress: quote.depositAddress,
      depositMemo: quote.depositMemo,
      originAsset: quote.originAsset,
      amountIn: quote.amountIn.toString(),
      amountInBaseUnits: quote.amountInBaseUnits,
      amountOut: quote.amountOut.toString(),
      minAmountOut: quote.minAmountOut.toString(),
      expiresAt: quote.expiresAt,
      etaSeconds: quote.etaSeconds,
    });
  });

  app.get("/v1/topup/:quoteId", requireSession(s), async (c) => c.json(await s.topups.status(c.get("user") as Address, c.req.param("quoteId"))));
}
