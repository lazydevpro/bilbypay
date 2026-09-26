import { IntentsTopUpProvider, type IntentsBackend } from "./intents";
import { MockTopUpProvider } from "./mock";
import type { FetchLike, TopUpLogger, TopUpProvider } from "./types";

/**
 * Env vars (all optional):
 *   TOPUP_PROVIDER      "aurora" | "oneclick" | "mock". Default: "aurora" if INTENTS_API_KEY is set, else "mock".
 *   INTENTS_API_KEY     Aurora Studio key (aurora) or 1Click JWT (oneclick).
 *   INTENTS_BASE_URL    Override the backend base URL (e.g. https://staging-intents-api.aurora.dev).
 *   TOPUP_DESTINATION   "usdc" (default) | "ausd" | raw asset id.
 *   TOPUP_SLIPPAGE_BPS  Default 50.
 *   TOPUP_REFERRAL      1Click referral id.
 */
export function createTopUpProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  opts: { fetch?: FetchLike; logger?: TopUpLogger; now?: () => number } = {},
): TopUpProvider {
  // A blank value (copied from .env.example) means "use the default", like every other optional var.
  const kind = (env.TOPUP_PROVIDER || (env.INTENTS_API_KEY ? "aurora" : "mock")).toLowerCase();
  if (kind === "mock") return new MockTopUpProvider({ now: opts.now });
  if (kind !== "aurora" && kind !== "oneclick") throw new Error(`TOPUP_PROVIDER must be aurora, oneclick or mock (got ${kind})`);
  const slippage = env.TOPUP_SLIPPAGE_BPS ? Number(env.TOPUP_SLIPPAGE_BPS) : undefined;
  if (slippage !== undefined && (!Number.isInteger(slippage) || slippage < 0 || slippage > 10_000)) {
    throw new Error(`TOPUP_SLIPPAGE_BPS must be an integer 0..10000 (got ${env.TOPUP_SLIPPAGE_BPS})`);
  }
  return new IntentsTopUpProvider({
    backend: kind as IntentsBackend,
    apiKey: env.INTENTS_API_KEY,
    baseUrl: env.INTENTS_BASE_URL || undefined,
    destination: env.TOPUP_DESTINATION || undefined,
    slippageBps: slippage,
    referral: env.TOPUP_REFERRAL || undefined,
    ...opts,
  });
}
