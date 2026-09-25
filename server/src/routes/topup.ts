import { TopUpError, type TopUpProvider } from "@bilbypay/topup";
import type { Hono } from "hono";
import type { Address } from "viem";
import { z } from "zod";
import { kvGet, kvSet } from "../db";
import { ApiError, errors } from "../errors";
import type { Services } from "../services";
import { type AppEnv, body, requireSession } from "./common";

/** Aurora Intents top-up (docs/api.md "Top-up"). Quotes are remembered per user so status is owner-only. */
export function topUpRoutes(app: Hono<AppEnv>, s: Services) {
  const provider = s.topup;
  const owned = (quoteId: string) => `topup:${quoteId}`;
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TopUpError) throw new ApiError(err.httpStatus && err.httpStatus < 500 ? 400 : 502, err.code, err.userMessage, err.details ?? {});
      throw err;
    }
  };

  app.get("/v1/topup/origins", requireSession(s), (c) =>
    c.json({ origins: provider.supportedOrigins().map(({ id, label, symbol, networkLabel }) => ({ id, label, symbol, networkLabel })) }),
  );

  app.post("/v1/topup/quote", requireSession(s), async (c) => {
    const user = c.get("user") as Address;
    const { originAsset, amount } = await body(c, z.object({ originAsset: z.string().max(200), amount: z.string().regex(/^\d{1,30}$/) }));
    const quote = await run(() => provider.quote({ originAsset, amount: BigInt(amount), recipient: user }));
    if (!quote.depositAddress) throw errors.internal();
    kvSet(s.db, owned(quote.quoteId), user);
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

  app.get("/v1/topup/:quoteId", requireSession(s), async (c) => {
    const quoteId = c.req.param("quoteId");
    if (kvGet(s.db, owned(quoteId)) !== c.get("user")) throw errors.notFound();
    const st = await run(() => provider.status(quoteId));
    return c.json({ status: st.status, message: st.message, amountOut: st.amountOut?.toString(), refundedAmount: st.refundedAmount?.toString() });
  });
}

export type { TopUpProvider };
