/**
 * The provider-neutral gift card interface. The server declares the same shapes structurally,
 * so keep these in sync with it (field names and optionality matter; comments don't).
 *
 * All money is USD in 6-decimal base units (1_000_000n = $1.00), the same as @bilbypay/core.
 */

export type GiftBrand = {
  /** Provider-scoped id. Pass it back unchanged to quote()/purchase(). */
  id: string;
  name: string;
  logoUrl: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  category?: string;
  /** Smallest face value, USD base units. */
  minAmount: bigint;
  /** Largest face value, USD base units. */
  maxAmount: bigint;
  /** When set, only these exact face values can be bought. */
  denominations?: bigint[];
  /** Estimated fee on top of face value, in percent (4.8 = 4.8%). quote() has the exact price. */
  feePercent: number;
};

export type GiftQuote = {
  brandId: string;
  /** Face value, USD base units. */
  amount: bigint;
  /** What we pay the provider for it (face value + provider fee), USD base units. */
  price: bigint;
  providerQuoteId?: string;
  expiresAt?: Date;
};

/** Bearer value. Never log any of these fields. */
export type GiftRedemption = {
  code?: string;
  pin?: string;
  url?: string;
  barcode?: { format: string; value: string };
  instructions?: string;
};

export type GiftPurchase = {
  providerOrderId: string;
  status: "completed" | "pending" | "failed";
  redemption?: GiftRedemption;
  /** Human-readable, safe to show to the user. Never contains codes. */
  failureReason?: string;
};

export interface GiftCardProvider {
  readonly name: string;
  catalog(country: string): Promise<GiftBrand[]>;
  quote(brandId: string, amount: bigint): Promise<GiftQuote>;
  /** Must be idempotent on `idempotencyKey` (our giftId). */
  purchase(input: { brandId: string; amount: bigint; idempotencyKey: string; quote?: GiftQuote }): Promise<GiftPurchase>;
  getPurchase(providerOrderId: string): Promise<GiftPurchase>;
  floatAvailable(): Promise<bigint>;
}

/**
 * Durable key/value store the providers use to make purchase() idempotent across restarts.
 *
 * Values are plain JSON (no bigint, no Date). They CAN contain redemption codes and signed
 * payment authorizations, so a server-side implementation must encrypt values at rest.
 *
 * `set` must be durable before it resolves: providers write "about to pay" markers and rely on
 * them surviving a crash. Cross-process mutual exclusion (two servers purchasing the same key at
 * once) is the caller's job — e.g. a unique constraint on giftId plus a row lock. Within one
 * process the providers serialise calls per key themselves.
 */
export interface IdempotencyStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
