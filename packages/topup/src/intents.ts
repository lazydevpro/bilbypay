import { getAddress, isAddress } from "viem";
import { MONAD_DESTINATIONS, ORIGINS, findOrigin, unitsToUsd, usdToUnits } from "./assets";
import { TopUpError, mapProviderError } from "./errors";
import type {
  FetchLike,
  QuoteParams,
  TopUpLogger,
  TopUpOrigin,
  TopUpProvider,
  TopUpQuote,
  TopUpStatus,
  TopUpStatusResult,
} from "./types";

/*
 * Aurora Intents (powered by NEAR Intents) — "Swap API" / 1Click.
 *
 * Two wire-compatible backends. Both take the same 1Click `QuoteRequest` body and return the same
 * `QuoteResponse` / `GetExecutionStatusResponse` JSON:
 *
 * backend "aurora" (default) — Aurora Intents API, the backend of Aurora's own swap widget.
 *   Base https://intents-api.aurora.dev (staging: https://staging-intents-api.aurora.dev)
 *   API key from https://studio.aurora.dev, passed as a PATH segment (not a header):
 *     POST /api/quote/{apiKey}                       body QuoteRequest → QuoteResponse
 *     GET  /api/status/{apiKey}?depositAddress=&depositMemo=         → GetExecutionStatusResponse
 *     POST /api/deposit/submit/{apiKey}  { txHash, depositAddress }
 *     GET  /api/tokens/{apiKey}                      → { asset_stats, tokens }
 *   Source: @aurora-is-near/intents-swap-widget@7.24.1 src/network.ts (base URLs),
 *   src/hooks/useMakeQuote.ts, src/hooks/useOneClickExecutionStatus.ts,
 *   src/hooks/useMakeQuoteTransfer.ts, src/utils/feeServiceTokens.ts. Its README says the key
 *   "is not secret. It is safe to ship in front-end code."
 *
 * backend "oneclick" — NEAR Intents 1Click API directly.
 *   Base https://1click.chaindefuser.com, optional `Authorization: Bearer <JWT>`:
 *     GET /v0/tokens, POST /v0/quote, GET /v0/status?depositAddress=&depositMemo=,
 *     POST /v0/deposit/submit
 *   Source: @defuse-protocol/one-click-sdk-typescript@0.1.26 dist/index.mjs (OpenAPI.BASE,
 *   OneClickService.getTokens/getQuote/getExecutionStatus/submitDepositTx, Bearer header) and
 *   dist/index.d.ts (QuoteRequest, Quote, QuoteResponse, GetExecutionStatusResponse, SwapDetails).
 *
 * Neither endpoint was reachable from the build sandbox (egress blocked), so every request/response
 * shape here is from those sources, not from a live call. Run scripts/quote-smoke.ts to verify.
 */

export type IntentsBackend = "aurora" | "oneclick";

export const DEFAULT_BASE_URLS: Record<IntentsBackend, string> = {
  aurora: "https://intents-api.aurora.dev",
  oneclick: "https://1click.chaindefuser.com",
};

export type IntentsTopUpConfig = {
  backend?: IntentsBackend;
  /** Aurora Studio API key (backend "aurora", required) or 1Click JWT (backend "oneclick", optional). */
  apiKey?: string;
  baseUrl?: string;
  /** Destination on Monad: "usdc" (default, verified listed), "ausd" (unverified), or a raw asset id. */
  destination?: keyof typeof MONAD_DESTINATIONS | string;
  /** Slippage tolerance in basis points (1Click `slippageTolerance`). Default 50 (0.5%). */
  slippageBps?: number;
  /** How long a deposit address stays valid (1Click `deadline`). Default 1h, like the Aurora widget. */
  quoteTtlMs?: number;
  /** 1Click `referral` (lowercase distribution-channel id). */
  referral?: string;
  origins?: readonly TopUpOrigin[];
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  logger?: TopUpLogger;
};

/** 1Click QuoteRequest (subset we send). */
export type OneClickQuoteRequest = {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
  depositMode: "SIMPLE";
  referral?: string;
  quoteWaitingTimeMs?: number;
};

type OneClickProviderStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

const STATUS_MAP: Record<OneClickProviderStatus, TopUpStatus> = {
  PENDING_DEPOSIT: "waiting",
  INCOMPLETE_DEPOSIT: "waiting",
  KNOWN_DEPOSIT_TX: "processing",
  PROCESSING: "processing",
  SUCCESS: "completed",
  REFUNDED: "refunded",
  FAILED: "failed",
};

const STATUS_MESSAGES: Record<OneClickProviderStatus, string> = {
  PENDING_DEPOSIT: "Waiting for your money to arrive.",
  INCOMPLETE_DEPOSIT: "We received less than expected. Send the rest, or it will be returned to you.",
  KNOWN_DEPOSIT_TX: "We can see your payment. Adding it to your balance now.",
  PROCESSING: "Money received. Adding it to your balance now.",
  SUCCESS: "Added to your balance.",
  REFUNDED: "This top-up couldn't be completed, so your money was returned.",
  FAILED: "This top-up didn't go through. If money left your account, contact support.",
};

/**
 * Placeholders the Aurora widget uses for dry quotes without a connected wallet
 * (intents-swap-widget src/constants/chains.ts DRY_QUOTE_ZERO_ADDRESSES).
 */
const DRY_REFUND_PLACEHOLDERS: Partial<Record<TopUpOrigin["addressKind"], string>> = {
  evm: "0x0000000000000000000000000000000000000001",
  sol: "11111111111111111111111111111112",
  near: "system.near",
};

const MEMO_SEP = "::";

export class IntentsTopUpProvider implements TopUpProvider {
  readonly name: string;
  readonly backend: IntentsBackend;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly destinationAsset: string;
  private readonly destinationDecimals: number;
  private readonly slippageBps: number;
  private readonly quoteTtlMs: number;
  private readonly referral?: string;
  private readonly origins: readonly TopUpOrigin[];
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly log: TopUpLogger;

  constructor(config: IntentsTopUpConfig = {}) {
    this.backend = config.backend ?? "aurora";
    this.name = this.backend === "aurora" ? "aurora-intents" : "near-intents-1click";
    this.apiKey = config.apiKey || undefined;
    if (this.backend === "aurora" && !this.apiKey) {
      throw new Error("Aurora Intents backend needs an API key from https://studio.aurora.dev (INTENTS_API_KEY)");
    }
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URLS[this.backend]).replace(/\/+$/, "");
    const dest = config.destination ?? "usdc";
    const known = (MONAD_DESTINATIONS as Record<string, { assetId: string; decimals: number }>)[dest];
    this.destinationAsset = known?.assetId ?? dest;
    this.destinationDecimals = known?.decimals ?? 6;
    this.slippageBps = config.slippageBps ?? 50;
    this.quoteTtlMs = config.quoteTtlMs ?? 60 * 60 * 1000;
    this.referral = config.referral;
    this.origins = config.origins ?? ORIGINS;
    this.fetchFn = config.fetch ?? ((input, init) => fetch(input, init));
    this.now = config.now ?? Date.now;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.log = config.logger ?? (() => {});
  }

  get destination(): string {
    return this.destinationAsset;
  }

  supportedOrigins(): TopUpOrigin[] {
    return [...this.origins];
  }

  /** Build the 1Click QuoteRequest body. Exposed for tests and the smoke script. */
  buildQuoteRequest(params: QuoteParams): { body: OneClickQuoteRequest; origin: TopUpOrigin } {
    const origin = findOrigin(params.originAsset, this.origins);
    if (!origin) throw new TopUpError("UNSUPPORTED_ORIGIN", { message: `unknown origin ${params.originAsset}` });
    if (!isAddress(params.recipient, { strict: false })) {
      throw new TopUpError("INVALID_ADDRESS", { message: `recipient is not an EVM address: ${params.recipient}` });
    }
    if (params.amount <= 0n) throw new TopUpError("AMOUNT_TOO_LOW", { message: "amount must be positive" });
    const dry = params.dry ?? false;
    const mode = params.mode ?? "exactIn";

    let refundTo = params.refundTo?.trim();
    if (refundTo) {
      if (origin.addressKind === "evm") {
        if (!isAddress(refundTo, { strict: false })) {
          throw new TopUpError("INVALID_ADDRESS", { message: `refundTo is not an EVM address: ${refundTo}` });
        }
        refundTo = getAddress(refundTo);
      }
    } else if (origin.addressKind === "evm") {
      // Same EVM key on the origin network. Fine for EOAs; see README for smart-account caveat.
      refundTo = getAddress(params.recipient);
    } else if (dry && DRY_REFUND_PLACEHOLDERS[origin.addressKind]) {
      refundTo = DRY_REFUND_PLACEHOLDERS[origin.addressKind];
    } else {
      throw new TopUpError("REFUND_ADDRESS_REQUIRED", { message: `refundTo required for ${origin.id}` });
    }

    const amount =
      mode === "exactIn" ? usdToUnits(params.amount, origin.decimals) : usdToUnits(params.amount, this.destinationDecimals);

    const body: OneClickQuoteRequest = {
      dry,
      swapType: mode === "exactIn" ? "EXACT_INPUT" : "EXACT_OUTPUT",
      slippageTolerance: this.slippageBps,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: this.destinationAsset,
      amount: amount.toString(),
      refundTo: refundTo!,
      refundType: "ORIGIN_CHAIN",
      recipient: getAddress(params.recipient),
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(this.now() + this.quoteTtlMs).toISOString(),
      depositMode: "SIMPLE",
      quoteWaitingTimeMs: 0,
      ...(this.referral ? { referral: this.referral } : {}),
    };
    return { body, origin };
  }

  async quote(params: QuoteParams): Promise<TopUpQuote> {
    const { body, origin } = this.buildQuoteRequest(params);
    const res = await this.request("POST", this.path("quote"), body, "quote");
    const quote = obj(obj(res)?.quote);
    if (!quote) throw new TopUpError("UNKNOWN", { message: "quote response missing `quote`", raw: res });

    const amountIn = big(quote.amountIn);
    const amountOut = big(quote.amountOut);
    const minAmountOut = big(quote.minAmountOut) ?? amountOut;
    if (amountIn === undefined || amountOut === undefined) {
      throw new TopUpError("UNKNOWN", { message: "quote response missing amounts", raw: res });
    }
    const depositAddress = str(quote.depositAddress);
    const depositMemo = str(quote.depositMemo);
    if (!body.dry && !depositAddress) {
      throw new TopUpError("NO_OFFER", { message: "live quote returned no depositAddress", raw: res });
    }

    const quoteId = body.dry
      ? `dry:${str(obj(res)?.correlationId) ?? this.now().toString(36)}`
      : encodeQuoteId(depositAddress!, depositMemo);

    this.log("debug", "topup quote", { quoteId, correlationId: obj(res)?.correlationId, origin: origin.id });

    return {
      quoteId,
      depositAddress,
      depositMemo,
      originAsset: origin.id,
      amountIn: unitsToUsd(amountIn, origin.decimals),
      amountInBaseUnits: amountIn.toString(),
      amountOut: unitsToUsd(amountOut, this.destinationDecimals),
      minAmountOut: unitsToUsd(minAmountOut!, this.destinationDecimals),
      expiresAt: str(quote.deadline) ?? body.deadline,
      etaSeconds: typeof quote.timeEstimate === "number" ? quote.timeEstimate : undefined,
      dry: body.dry,
      raw: res,
    };
  }

  async status(quoteIdOrDepositAddress: string): Promise<TopUpStatusResult> {
    const { depositAddress, depositMemo } = decodeQuoteId(quoteIdOrDepositAddress);
    const qs = new URLSearchParams({ depositAddress });
    if (depositMemo) qs.set("depositMemo", depositMemo);
    const res = await this.request("GET", `${this.path("status")}?${qs}`, undefined, "status");
    return this.parseStatus(quoteIdOrDepositAddress, res);
  }

  async submitDepositTx(params: { quoteId: string; txHash: string }): Promise<TopUpStatusResult | void> {
    const { depositAddress, depositMemo } = decodeQuoteId(params.quoteId);
    const body = { txHash: params.txHash, depositAddress, ...(depositMemo ? { memo: depositMemo } : {}) };
    const res = await this.request("POST", this.path("deposit/submit"), body, "submit");
    // 1Click returns a status document (SubmitDepositTxResponse); the Aurora proxy's body is unspecified.
    if (obj(res)?.status) return this.parseStatus(params.quoteId, res);
  }

  /**
   * Raw token catalogue. 1Click returns TokenResponse[]; the Aurora proxy returns
   * `{ asset_stats, tokens }` with widget "SimpleToken" entries (shape not pinned — best effort).
   */
  async listTokens(): Promise<Array<{ assetId: string; blockchain?: string; symbol?: string; decimals?: number; raw: unknown }>> {
    const res = await this.request("GET", this.path("tokens"), undefined, "status");
    const list = Array.isArray(res) ? res : Array.isArray(obj(res)?.tokens) ? (obj(res)!.tokens as unknown[]) : [];
    return list.flatMap((t) => {
      const o = obj(t);
      const assetId = str(o?.assetId) ?? str(o?.defuseAssetId);
      if (!o || !assetId) return [];
      return [{ assetId, blockchain: str(o.blockchain), symbol: str(o.symbol), decimals: typeof o.decimals === "number" ? o.decimals : undefined, raw: t }];
    });
  }

  private parseStatus(quoteId: string, res: unknown): TopUpStatusResult {
    const r = obj(res);
    const providerStatus = str(r?.status) ?? "UNKNOWN";
    const known = providerStatus in STATUS_MAP ? (providerStatus as OneClickProviderStatus) : undefined;
    if (!known) this.log("warn", "unknown topup provider status", { providerStatus, raw: res });
    const details = obj(r?.swapDetails) ?? {};
    const req = obj(obj(r?.quoteResponse)?.quoteRequest);
    const originDecimals = findOrigin(str(req?.originAsset) ?? "", this.origins)?.decimals ?? 6;
    const destAsset = str(req?.destinationAsset);
    const destDecimals =
      Object.values(MONAD_DESTINATIONS).find((d) => d.assetId === destAsset)?.decimals ?? this.destinationDecimals;

    const amountIn = big(details.amountIn) ?? big(details.depositedAmount);
    const amountOut = big(details.amountOut);
    const refunded = big(details.refundedAmount);

    return {
      quoteId,
      status: known ? STATUS_MAP[known] : "processing",
      providerStatus,
      message: known ? STATUS_MESSAGES[known] : STATUS_MESSAGES.PROCESSING,
      amountIn: amountIn === undefined ? undefined : unitsToUsd(amountIn, originDecimals),
      amountOut: amountOut === undefined ? undefined : unitsToUsd(amountOut, destDecimals),
      refundedAmount: refunded === undefined ? undefined : unitsToUsd(refunded, originDecimals),
      destinationTxHashes: hashes(details.destinationChainTxHashes),
      originTxHashes: hashes(details.originChainTxHashes),
      updatedAt: str(r?.updatedAt),
      raw: res,
    };
  }

  private path(endpoint: "quote" | "status" | "tokens" | "deposit/submit"): string {
    return this.backend === "aurora"
      ? `${this.baseUrl}/api/${endpoint}/${encodeURIComponent(this.apiKey!)}`
      : `${this.baseUrl}/v0/${endpoint}`;
  }

  private async request(method: "GET" | "POST", url: string, body: unknown, context: "quote" | "status" | "submit"): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.backend === "oneclick" && this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.log("error", `topup ${context} network error`, { url: redact(url, this.apiKey), err: String(err) });
      throw new TopUpError("UNAVAILABLE", { message: `network error: ${String(err)}`, raw: err });
    }

    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      /* keep text */
    }
    if (!response.ok) {
      const error = mapProviderError(response.status, parsed, context);
      this.log("warn", `topup ${context} failed`, { url: redact(url, this.apiKey), status: response.status, body: parsed, code: error.code });
      throw error;
    }
    return parsed;
  }
}

/** Alias: the 1Click wire protocol is what this speaks, whichever backend. */
export { IntentsTopUpProvider as OneClickTopUpProvider };

export function encodeQuoteId(depositAddress: string, depositMemo?: string): string {
  return depositMemo ? `${depositAddress}${MEMO_SEP}${depositMemo}` : depositAddress;
}

export function decodeQuoteId(quoteId: string): { depositAddress: string; depositMemo?: string } {
  if (quoteId.startsWith("dry:")) {
    throw new TopUpError("NOT_A_LIVE_QUOTE", { message: `dry quote ${quoteId} has no deposit address` });
  }
  const i = quoteId.indexOf(MEMO_SEP);
  if (i < 0) return { depositAddress: quoteId };
  return { depositAddress: quoteId.slice(0, i), depositMemo: quoteId.slice(i + MEMO_SEP.length) };
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function big(v: unknown): bigint | undefined {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return undefined;
}
function hashes(v: unknown): string[] {
  return Array.isArray(v) ? v.flatMap((x) => (str(obj(x)?.hash) ? [str(obj(x)!.hash)!] : [])) : [];
}
function redact(url: string, key?: string): string {
  return key ? url.split(encodeURIComponent(key)).join("<key>") : url;
}
