import { isAddress, keccak256, toHex } from "viem";
import { ORIGINS, findOrigin, usdToUnits } from "./assets";
import { TopUpError } from "./errors";
import type { QuoteParams, TopUpOrigin, TopUpProvider, TopUpQuote, TopUpStatus, TopUpStatusResult } from "./types";

export type MockTopUpConfig = {
  /** Deposit "arrives" this long after the quote unless `simulateDeposit` is called first. `null` = never. Default 5s. */
  autoDepositMs?: number | null;
  /** Time from deposit to completion. Default 8s. */
  processingMs?: number;
  /** Fee kept by the "provider", bps of amount. Default 10 (0.1%). */
  feeBps?: number;
  /** Quotes below this (6-dec USD) are rejected with AMOUNT_TOO_LOW. Default $1. */
  minAmount?: bigint;
  ttlMs?: number;
  now?: () => number;
  origins?: readonly TopUpOrigin[];
};

type MockEntry = {
  quote: TopUpQuote;
  createdAt: number;
  depositedAt?: number;
  outcome: "completed" | "failed" | "refunded";
};

const MESSAGES: Record<TopUpStatus, string> = {
  waiting: "Waiting for your money to arrive.",
  processing: "Money received. Adding it to your balance now.",
  completed: "Added to your balance.",
  refunded: "This top-up couldn't be completed, so your money was returned.",
  failed: "This top-up didn't go through. If money left your account, contact support.",
};

/**
 * In-memory provider for dev and tests. Each live quote moves
 * waiting → processing → completed (or a forced failed/refunded) purely as a function of time,
 * so polling a stateless server works without timers.
 */
export class MockTopUpProvider implements TopUpProvider {
  readonly name = "mock";
  private readonly entries = new Map<string, MockEntry>();
  private readonly cfg: Required<Omit<MockTopUpConfig, "autoDepositMs" | "origins">> & {
    autoDepositMs: number | null;
    origins: readonly TopUpOrigin[];
  };
  private counter = 0;

  constructor(config: MockTopUpConfig = {}) {
    this.cfg = {
      autoDepositMs: config.autoDepositMs === undefined ? 5_000 : config.autoDepositMs,
      processingMs: config.processingMs ?? 8_000,
      feeBps: config.feeBps ?? 10,
      minAmount: config.minAmount ?? 1_000_000n,
      ttlMs: config.ttlMs ?? 60 * 60 * 1000,
      now: config.now ?? Date.now,
      origins: config.origins ?? ORIGINS,
    };
  }

  supportedOrigins(): TopUpOrigin[] {
    return [...this.cfg.origins];
  }

  async quote(params: QuoteParams): Promise<TopUpQuote> {
    const origin = findOrigin(params.originAsset, this.cfg.origins);
    if (!origin) throw new TopUpError("UNSUPPORTED_ORIGIN", { message: `unknown origin ${params.originAsset}` });
    if (!isAddress(params.recipient, { strict: false })) throw new TopUpError("INVALID_ADDRESS");
    if (params.amount < this.cfg.minAmount) {
      throw new TopUpError("AMOUNT_TOO_LOW", { details: { minAmountBaseUnits: usdToUnits(this.cfg.minAmount, origin.decimals).toString() } });
    }
    const fee = (params.amount * BigInt(this.cfg.feeBps)) / 10_000n;
    const exactOut = params.mode === "exactOut";
    const amountIn = exactOut ? params.amount + fee : params.amount;
    const amountOut = exactOut ? params.amount : params.amount - fee;
    const now = this.cfg.now();
    const n = ++this.counter;
    const depositAddress = params.dry
      ? undefined
      : `0x${keccak256(toHex(`mock-topup-${now}-${n}`)).slice(26)}`;
    const quote: TopUpQuote = {
      quoteId: params.dry ? `dry:mock-${n}` : depositAddress!,
      depositAddress,
      originAsset: origin.id,
      amountIn,
      amountInBaseUnits: usdToUnits(amountIn, origin.decimals).toString(),
      amountOut,
      minAmountOut: amountOut,
      expiresAt: new Date(now + this.cfg.ttlMs).toISOString(),
      etaSeconds: Math.round(this.cfg.processingMs / 1000),
      dry: params.dry ?? false,
      raw: { mock: true },
    };
    if (!quote.dry) this.entries.set(quote.quoteId, { quote, createdAt: now, outcome: "completed" });
    return quote;
  }

  /** Pretend the user's deposit just landed. */
  simulateDeposit(quoteId: string): void {
    const e = this.get(quoteId);
    e.depositedAt ??= this.cfg.now();
  }

  /** Force how this top-up ends. */
  setOutcome(quoteId: string, outcome: MockEntry["outcome"]): void {
    this.get(quoteId).outcome = outcome;
  }

  async status(quoteIdOrDepositAddress: string): Promise<TopUpStatusResult> {
    const e = this.get(quoteIdOrDepositAddress);
    const now = this.cfg.now();
    const depositedAt =
      e.depositedAt ?? (this.cfg.autoDepositMs !== null && now - e.createdAt >= this.cfg.autoDepositMs ? e.createdAt + this.cfg.autoDepositMs : undefined);
    let status: TopUpStatus = "waiting";
    if (depositedAt !== undefined) status = now - depositedAt >= this.cfg.processingMs ? e.outcome : "processing";
    // Past the deadline without a deposit: nothing to refund; stays "waiting" like the real API
    // (PENDING_DEPOSIT) — the server should expire it on its side.
    const done = status === "completed";
    return {
      quoteId: e.quote.quoteId,
      status,
      providerStatus: `MOCK_${status.toUpperCase()}`,
      message: MESSAGES[status],
      amountIn: depositedAt !== undefined ? e.quote.amountIn : undefined,
      amountOut: done ? e.quote.amountOut : undefined,
      refundedAmount: status === "refunded" ? e.quote.amountIn : undefined,
      destinationTxHashes: done ? [keccak256(toHex(`mock-dest-${e.quote.quoteId}`))] : [],
      originTxHashes: depositedAt !== undefined ? [keccak256(toHex(`mock-origin-${e.quote.quoteId}`))] : [],
      updatedAt: new Date(now).toISOString(),
      raw: { mock: true },
    };
  }

  async submitDepositTx(params: { quoteId: string; txHash: string }): Promise<TopUpStatusResult> {
    this.simulateDeposit(params.quoteId);
    return this.status(params.quoteId);
  }

  private get(quoteId: string): MockEntry {
    if (quoteId.startsWith("dry:")) throw new TopUpError("NOT_A_LIVE_QUOTE");
    const e = this.entries.get(quoteId);
    if (!e) throw new TopUpError("NOT_FOUND", { message: `no mock top-up ${quoteId}` });
    return e;
  }
}
