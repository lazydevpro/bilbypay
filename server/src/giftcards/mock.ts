import { randomInt } from "node:crypto";
import type { GiftBrand, GiftCardProvider, GiftPurchase, GiftQuote } from "./types";

const USD = 1_000_000n;
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

const BRANDS: GiftBrand[] = [
  { id: "starbucks-us", name: "Starbucks", logoUrl: favicon("starbucks.com"), country: "US", category: "Food & drink", minAmount: 5n * USD, maxAmount: 500n * USD, feePercent: 0 },
  { id: "uber-us", name: "Uber", logoUrl: favicon("uber.com"), country: "US", category: "Travel", minAmount: 15n * USD, maxAmount: 500n * USD, feePercent: 2.5 },
  { id: "target-us", name: "Target", logoUrl: favicon("target.com"), country: "US", category: "Shopping", minAmount: 10n * USD, maxAmount: 1000n * USD, feePercent: 1 },
  {
    id: "doordash-us",
    name: "DoorDash",
    logoUrl: favicon("doordash.com"),
    country: "US",
    category: "Food & drink",
    minAmount: 25n * USD,
    maxAmount: 100n * USD,
    denominations: [25n * USD, 50n * USD, 100n * USD],
    feePercent: 0,
  },
  // Always fails at purchase, like Bitrefill's *-fail test products: exercises the auto-refund path.
  { id: "test-fail-us", name: "Test card (always fails)", logoUrl: favicon("example.com"), country: "US", category: "Test", minAmount: 1n * USD, maxAmount: 500n * USD, feePercent: 0 },
];

/** Price = face value + fee, rounded up to the cent. */
export function priceWithFee(amount: bigint, feePercent: number): bigint {
  const bps = BigInt(Math.round(feePercent * 100));
  const fee = (amount * bps + 9_999n) / 10_000n;
  const cents = 10_000n;
  return ((amount + fee + cents - 1n) / cents) * cents;
}

const rand = (n: number) => Array.from({ length: n }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)]).join("");

/**
 * In-memory provider for dev and tests. Purchases are idempotent per key and draw down a float,
 * like a real pre-funded provider balance.
 */
export class MockGiftCardProvider implements GiftCardProvider {
  readonly name = "mock";
  private orders = new Map<string, GiftPurchase>();
  private byKey = new Map<string, string>();
  float: bigint;
  /** Test knobs. */
  failBrands = new Set<string>(["test-fail-us"]);
  pendingBrands = new Set<string>();
  purchaseCalls = 0;

  constructor(opts: { float?: bigint } = {}) {
    this.float = opts.float ?? 10_000n * USD;
  }

  async catalog(country: string): Promise<GiftBrand[]> {
    return BRANDS.filter((b) => b.country === country.toUpperCase());
  }

  private brand(id: string): GiftBrand {
    const b = BRANDS.find((x) => x.id === id);
    if (!b) throw new Error(`Unknown brand ${id}`);
    return b;
  }

  async quote(brandId: string, amount: bigint): Promise<GiftQuote> {
    const b = this.brand(brandId);
    return { brandId, amount, price: priceWithFee(amount, b.feePercent), providerQuoteId: `mq_${rand(8)}`, expiresAt: new Date(Date.now() + 10 * 60_000) };
  }

  async purchase(input: { brandId: string; amount: bigint; idempotencyKey: string; quote?: GiftQuote }): Promise<GiftPurchase> {
    this.purchaseCalls++;
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) return this.orders.get(existing)!;
    const b = this.brand(input.brandId);
    const providerOrderId = `mock_${rand(12)}`;
    const price = priceWithFee(input.amount, b.feePercent);
    let order: GiftPurchase;
    if (this.failBrands.has(b.id)) order = { providerOrderId, status: "failed", failureReason: "out_of_stock" };
    else if (price > this.float) order = { providerOrderId, status: "failed", failureReason: "insufficient_float" };
    else {
      this.float -= price;
      const redemption = {
        code: `${rand(4)}-${rand(4)}-${rand(4)}-${rand(4)}`,
        pin: String(randomInt(10_000)).padStart(4, "0"),
        barcode: { format: "code128", value: rand(16) },
        instructions: `Show this code at any ${b.name} or enter it in the ${b.name} app.`,
      };
      order = this.pendingBrands.has(b.id) ? { providerOrderId, status: "pending" } : { providerOrderId, status: "completed", redemption };
      if (order.status === "pending") this.pendingRedemptions.set(providerOrderId, redemption);
    }
    this.orders.set(providerOrderId, order);
    this.byKey.set(input.idempotencyKey, providerOrderId);
    return order;
  }

  private pendingRedemptions = new Map<string, GiftPurchase["redemption"]>();

  /** Test helper: completes a pending order. */
  complete(providerOrderId: string) {
    const redemption = this.pendingRedemptions.get(providerOrderId);
    if (redemption) this.orders.set(providerOrderId, { providerOrderId, status: "completed", redemption });
  }

  async getPurchase(providerOrderId: string): Promise<GiftPurchase> {
    const order = this.orders.get(providerOrderId);
    if (!order) throw new Error(`Unknown order ${providerOrderId}`);
    return order;
  }

  async floatAvailable(): Promise<bigint> {
    return this.float;
  }
}
