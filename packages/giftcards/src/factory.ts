import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { BitrefillProvider } from "./bitrefill";
import { LasoProvider } from "./laso";
import { MockGiftCardProvider } from "./mock";
import type { FetchLike, GiftCardProvider, IdempotencyStore } from "./types";

export type GiftProviderEnv = Record<string, string | undefined>;

/**
 * Builds the provider named by GIFT_PROVIDER (mock | laso | bitrefill; default mock).
 *
 * laso:      LASO_PRIVATE_KEY (required, 0x… Base float key), BASE_RPC_URL (strongly recommended:
 *            float balance + settlement checks), LASO_BASE_URL, LASO_PAY_TO (comma-separated
 *            override of the allowed payTo addresses), LASO_MAX_FEE_PERCENT
 * bitrefill: BITREFILL_API_ID + BITREFILL_API_SECRET (Business) or BITREFILL_API_KEY (Personal),
 *            BITREFILL_BASE_URL, BITREFILL_TEST_PRODUCTS=true, BITREFILL_AUTO_PAY=true,
 *            BITREFILL_WEBHOOK_URL, BITREFILL_BALANCE_CURRENCY, BITREFILL_FEE_PERCENT
 * mock:      MOCK_GIFT_FLOAT_USD (default 10000)
 *
 * Pass `store` so purchase idempotency survives restarts (the in-memory default does not).
 */
export function createGiftCardProvider(
  env: GiftProviderEnv = process.env,
  deps: { store?: IdempotencyStore; fetch?: FetchLike } = {},
): GiftCardProvider {
  const kind = (env.GIFT_PROVIDER ?? "mock").trim().toLowerCase();
  switch (kind) {
    case "mock":
      return new MockGiftCardProvider({
        float: env.MOCK_GIFT_FLOAT_USD ? BigInt(Math.round(Number(env.MOCK_GIFT_FLOAT_USD) * 1e6)) : undefined,
      });
    case "laso": {
      const key = env.LASO_PRIVATE_KEY?.trim();
      if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("GIFT_PROVIDER=laso needs LASO_PRIVATE_KEY (0x + 64 hex)");
      return new LasoProvider({
        account: privateKeyToAccount(key as Hex),
        baseUrl: env.LASO_BASE_URL || undefined,
        rpcUrl: env.BASE_RPC_URL || undefined,
        allowedPayTo: env.LASO_PAY_TO ? (env.LASO_PAY_TO.split(",").map((s) => s.trim()) as Address[]) : undefined,
        maxFeePercent: env.LASO_MAX_FEE_PERCENT ? Number(env.LASO_MAX_FEE_PERCENT) : undefined,
        store: deps.store,
        fetch: deps.fetch,
      });
    }
    case "bitrefill":
      return new BitrefillProvider({
        apiId: env.BITREFILL_API_ID || undefined,
        apiSecret: env.BITREFILL_API_SECRET || undefined,
        apiKey: env.BITREFILL_API_KEY || undefined,
        baseUrl: env.BITREFILL_BASE_URL || undefined,
        includeTestProducts: env.BITREFILL_TEST_PRODUCTS === "true",
        autoPay: env.BITREFILL_AUTO_PAY === "true",
        webhookUrl: env.BITREFILL_WEBHOOK_URL || undefined,
        balanceCurrency: env.BITREFILL_BALANCE_CURRENCY || undefined,
        feePercent: env.BITREFILL_FEE_PERCENT ? Number(env.BITREFILL_FEE_PERCENT) : undefined,
        store: deps.store,
        fetch: deps.fetch,
      });
    default:
      throw new Error(`Unknown GIFT_PROVIDER "${kind}" (expected mock, laso or bitrefill)`);
  }
}
