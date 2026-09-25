// The provider contract shared with packages/giftcards (Laso, Bitrefill). Keep in sync; amounts are
// USD in 6-decimal base units.

export type GiftBrand = {
  id: string;
  name: string;
  logoUrl: string;
  country: string;
  category?: string;
  minAmount: bigint;
  maxAmount: bigint;
  denominations?: bigint[];
  feePercent: number;
};
export type GiftQuote = { brandId: string; amount: bigint; price: bigint; providerQuoteId?: string; expiresAt?: Date };
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
  failureReason?: string;
};
export interface GiftCardProvider {
  readonly name: string;
  catalog(country: string): Promise<GiftBrand[]>;
  quote(brandId: string, amount: bigint): Promise<GiftQuote>;
  /** Must be idempotent on `idempotencyKey` (our giftId). */
  purchase(input: { brandId: string; amount: bigint; idempotencyKey: string; quote?: GiftQuote }): Promise<GiftPurchase>;
  getPurchase(providerOrderId: string): Promise<GiftPurchase>;
  floatAvailable(): Promise<bigint>; // pre-funded balance; brands show unavailable when too low
}
