import type { Address } from "viem";

/**
 * How an origin address is shaped. Used to decide whether we can default the
 * refund address to the user's Monad (EVM) address.
 */
export type AddressKind = "evm" | "sol" | "tron" | "near";

/** A place the user can top up from, e.g. "USDC on Base". */
export type TopUpOrigin = {
  /** Short, stable id used by the app/server API, e.g. "base:usdc". */
  id: string;
  /** User-facing label, e.g. "USDC on Base". */
  label: string;
  /** Token symbol, e.g. "USDC". */
  symbol: string;
  /** Network name as shown to users, e.g. "Base". */
  networkLabel: string;
  /** Provider asset id, e.g. "nep141:base-0x8335…2913.omft.near". */
  assetId: string;
  /** Token decimals on the origin network. */
  decimals: number;
  addressKind: AddressKind;
};

export type TopUpStatus = "waiting" | "processing" | "completed" | "failed" | "refunded";

export type QuoteParams = {
  /** An origin id from `supportedOrigins()` (e.g. "base:usdc"), or a raw provider asset id. */
  originAsset: string;
  /**
   * Dollar amount as a 6-decimal bigint (same convention as @bilbypay/core `parseUsd`).
   * With `mode: "exactIn"` (default) this is what the user sends; with "exactOut" it is
   * what should land in their BilbyPay balance.
   */
  amount: bigint;
  /** The user's Monad address. */
  recipient: Address;
  /**
   * Where the provider returns money if the top-up cannot complete. Must be an address on the
   * origin network. Defaults to `recipient` for EVM origins (see README caveat for smart accounts).
   */
  refundTo?: string;
  mode?: "exactIn" | "exactOut";
  /** Preview only: no deposit address is created and no funds can move. */
  dry?: boolean;
};

export type TopUpQuote = {
  /** Opaque id for `status()`. For live quotes this encodes the deposit address (+ memo). */
  quoteId: string;
  /** Where the user sends funds. Undefined for dry quotes. */
  depositAddress?: string;
  /** Some origins (e.g. Stellar) require a memo alongside the address. */
  depositMemo?: string;
  originAsset: string;
  /** What the user must send, in 6-decimal USD units (origin stablecoin scaled to 6 decimals). */
  amountIn: bigint;
  /** Same as amountIn, in origin-token base units as a decimal string (what the wallet sends). */
  amountInBaseUnits: string;
  /** Expected amount arriving on Monad, 6-decimal USD bigint. */
  amountOut: bigint;
  /** Worst case after slippage, 6-decimal USD bigint. */
  minAmountOut: bigint;
  /** After this, the deposit address should not be used (ISO string). */
  expiresAt: string;
  /** Provider's estimate in seconds from deposit confirmation to completion. */
  etaSeconds?: number;
  dry: boolean;
  /** Full provider response (includes the provider signature — persist it for disputes). */
  raw: unknown;
};

export type TopUpStatusResult = {
  quoteId: string;
  status: TopUpStatus;
  /** Provider's own status string, for logs. */
  providerStatus: string;
  /** Short, plain-language line for the app. Never contains provider/crypto jargon. */
  message: string;
  /** Amount received from the user, 6-decimal USD bigint, when known. */
  amountIn?: bigint;
  /** Amount delivered on Monad, 6-decimal USD bigint, when known. */
  amountOut?: bigint;
  /** Amount returned to the user, 6-decimal USD bigint, when refunded. */
  refundedAmount?: bigint;
  /** Transaction hashes on Monad that delivered the funds (for receipts / judges). */
  destinationTxHashes: string[];
  originTxHashes: string[];
  updatedAt?: string;
  raw: unknown;
};

export interface TopUpProvider {
  readonly name: string;
  supportedOrigins(): TopUpOrigin[];
  quote(params: QuoteParams): Promise<TopUpQuote>;
  /** Accepts a `quoteId` from `quote()` or a bare deposit address. */
  status(quoteIdOrDepositAddress: string): Promise<TopUpStatusResult>;
  /** Optional: tell the provider about the user's deposit so it is picked up faster. */
  submitDepositTx?(params: { quoteId: string; txHash: string }): Promise<TopUpStatusResult | void>;
}

/** Minimal logger hook; raw provider details go here, never to users. */
export type TopUpLogger = (level: "debug" | "warn" | "error", msg: string, details?: unknown) => void;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
