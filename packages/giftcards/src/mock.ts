/**
 * Deterministic in-memory provider for development, demos without spending money, and tests.
 * Codes are fake (prefixed "DEMO-") and derived from the idempotency key, so the same gift always
 * gets the same code. Brand ids ending in "-fail" always fail (configurable).
 */
import { createHash } from "node:crypto";
import type { GiftBrand, GiftCardProvider, GiftPurchase, GiftQuote } from "./types";
import { addPercent, KeyedMutex } from "./util";

const usd = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));
const logo = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=256`;

type MockBrand = Omit<GiftBrand, "country"> & {
  countries: string[];
  barcodeFormat?: string;
  hasPin?: boolean;
  hasUrl?: boolean;
  instructions: string;
};

/** Deliberately no Amazon: it locks cards it associates with resale (spec §4a). */
const BRANDS: MockBrand[] = [
  { id: "starbucks", name: "Starbucks", logoUrl: logo("starbucks.com"), countries: ["US", "CA"], category: "food", minAmount: usd(5), maxAmount: usd(500), feePercent: 0, barcodeFormat: "PDF417", hasPin: true, instructions: "Add the card in the Starbucks app under Pay > Add card, or show the barcode to your barista." },
  { id: "uber", name: "Uber", logoUrl: logo("uber.com"), countries: ["US", "GB", "AU", "IN", "MX"], category: "transportation", minAmount: usd(15), maxAmount: usd(500), feePercent: 2, instructions: "In the Uber app open Wallet > Add gift card and enter the code." },
  { id: "uber-eats", name: "Uber Eats", logoUrl: logo("ubereats.com"), countries: ["US", "GB", "AU"], category: "food-delivery", minAmount: usd(15), maxAmount: usd(500), feePercent: 2, instructions: "In the Uber Eats app open Wallet > Add gift card and enter the code." },
  { id: "doordash", name: "DoorDash", logoUrl: logo("doordash.com"), countries: ["US", "CA", "AU"], category: "food-delivery", minAmount: usd(15), maxAmount: usd(200), feePercent: 1.5, instructions: "In the DoorDash app open Account > Gift card and enter the code." },
  { id: "netflix", name: "Netflix", logoUrl: logo("netflix.com"), countries: ["US", "GB", "CA", "IN", "MX", "PH"], category: "streaming", minAmount: usd(25), maxAmount: usd(200), denominations: [usd(25), usd(30), usd(50), usd(60), usd(100), usd(200)], feePercent: 1, hasUrl: true, instructions: "Go to netflix.com/redeem and enter the code." },
  { id: "spotify", name: "Spotify", logoUrl: logo("spotify.com"), countries: ["US", "GB", "CA", "AU", "MX"], category: "music", minAmount: usd(10), maxAmount: usd(99), denominations: [usd(10), usd(30), usd(60), usd(99)], feePercent: 1, hasUrl: true, instructions: "Go to spotify.com/redeem and enter the code." },
  { id: "airbnb", name: "Airbnb", logoUrl: logo("airbnb.com"), countries: ["US", "GB", "CA", "AU"], category: "travel", minAmount: usd(25), maxAmount: usd(500), feePercent: 2.5, hasUrl: true, instructions: "Go to airbnb.com/giftcards/redeem and enter the code." },
  { id: "apple", name: "Apple Gift Card", logoUrl: logo("apple.com"), countries: ["US", "CA", "GB"], category: "electronics", minAmount: usd(10), maxAmount: usd(500), feePercent: 2, instructions: "On iPhone open App Store > your photo > Redeem Gift Card or Code." },
  { id: "google-play", name: "Google Play", logoUrl: logo("play.google.com"), countries: ["US", "IN", "PH", "MX", "NG"], category: "games", minAmount: usd(10), maxAmount: usd(200), feePercent: 2, instructions: "Open Google Play > Profile > Payments & subscriptions > Redeem code." },
  { id: "target", name: "Target", logoUrl: logo("target.com"), countries: ["US"], category: "retail", minAmount: usd(5), maxAmount: usd(500), feePercent: 1, barcodeFormat: "CODE128", hasPin: true, instructions: "Show the barcode at checkout or add it to your Target account." },
  { id: "sephora", name: "Sephora", logoUrl: logo("sephora.com"), countries: ["US", "CA"], category: "cosmetics", minAmount: usd(10), maxAmount: usd(500), feePercent: 2, barcodeFormat: "CODE128", hasPin: true, instructions: "Show the barcode in store or enter the number and PIN at checkout online." },
  { id: "nike", name: "Nike", logoUrl: logo("nike.com"), countries: ["US"], category: "apparel", minAmount: usd(25), maxAmount: usd(500), feePercent: 2, hasPin: true, instructions: "Enter the card number and PIN at checkout on nike.com or in the Nike app." },
];

export type MockGiftCardProviderOptions = {
  /** Starting float, USD base units. Default $10,000. Purchases draw it down. */
  float?: bigint;
  /** Decides which brand ids fail at purchase. Default: ids ending in "-fail". */
  shouldFail?: (brandId: string) => boolean;
  /** Adds a "-fail" test brand to every country's catalog. Default false. */
  includeFailBrand?: boolean;
  /** Purchases return "pending" first and complete on the next getPurchase(). Default false. */
  asyncFulfilment?: boolean;
};

const FAIL_BRAND: MockBrand = {
  id: "test-card-fail",
  name: "Test card (always fails)",
  logoUrl: logo("example.com"),
  countries: [],
  category: "test",
  minAmount: usd(5),
  maxAmount: usd(500),
  feePercent: 0,
  instructions: "",
};

export class MockGiftCardProvider implements GiftCardProvider {
  readonly name = "mock";
  private floatLeft: bigint;
  private readonly shouldFail: (brandId: string) => boolean;
  private readonly byKey = new Map<string, GiftPurchase>();
  private readonly byOrder = new Map<string, { purchase: GiftPurchase; ready: boolean }>();
  private readonly mutex = new KeyedMutex();

  constructor(private readonly options: MockGiftCardProviderOptions = {}) {
    this.floatLeft = options.float ?? usd(10_000);
    this.shouldFail = options.shouldFail ?? ((id) => id.endsWith("-fail"));
  }

  async catalog(country: string): Promise<GiftBrand[]> {
    const cc = country.toUpperCase();
    const brands = BRANDS.filter((b) => b.countries.includes(cc));
    if (this.options.includeFailBrand) brands.push(FAIL_BRAND);
    return brands.map((b) => toBrand(b, cc));
  }

  private brand(brandId: string): MockBrand {
    const b = BRANDS.find((x) => x.id === brandId) ?? (brandId.endsWith("-fail") ? { ...FAIL_BRAND, id: brandId } : undefined);
    if (!b) throw new Error(`Unknown gift card brand: ${brandId}`);
    return b;
  }

  async quote(brandId: string, amount: bigint): Promise<GiftQuote> {
    const b = this.brand(brandId);
    checkAmount(b, amount);
    return {
      brandId,
      amount,
      price: addPercent(amount, b.feePercent),
      providerQuoteId: `mockq_${hash(`${brandId}:${amount}`).slice(0, 12)}`,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    };
  }

  async purchase(input: { brandId: string; amount: bigint; idempotencyKey: string; quote?: GiftQuote }): Promise<GiftPurchase> {
    return this.mutex.run(input.idempotencyKey, async () => {
      const existing = this.byKey.get(input.idempotencyKey);
      if (existing) return structuredClone(existing);

      const h = hash(input.idempotencyKey);
      const providerOrderId = `mock_${h.slice(0, 16)}`;
      let purchase: GiftPurchase;
      if (this.shouldFail(input.brandId)) {
        purchase = { providerOrderId, status: "failed", failureReason: "This gift card is temporarily unavailable. You haven't been charged." };
      } else {
        const b = this.brand(input.brandId);
        checkAmount(b, input.amount);
        const price = input.quote?.price ?? addPercent(input.amount, b.feePercent);
        if (price > this.floatLeft) {
          purchase = { providerOrderId, status: "failed", failureReason: "Gift cards are briefly unavailable. You haven't been charged." };
        } else {
          this.floatLeft -= price;
          purchase = { providerOrderId, status: "completed", redemption: fakeRedemption(b, h) };
        }
      }
      const ready = !this.options.asyncFulfilment || purchase.status === "failed";
      this.byOrder.set(providerOrderId, { purchase, ready });
      const visible: GiftPurchase = ready ? purchase : { providerOrderId, status: "pending" };
      this.byKey.set(input.idempotencyKey, ready ? purchase : visible);
      return structuredClone(visible);
    });
  }

  async getPurchase(providerOrderId: string): Promise<GiftPurchase> {
    const entry = this.byOrder.get(providerOrderId);
    if (!entry) throw new Error(`Unknown order ${providerOrderId}`);
    if (!entry.ready) {
      entry.ready = true;
      for (const [k, v] of this.byKey) if (v.providerOrderId === providerOrderId) this.byKey.set(k, entry.purchase);
      return { providerOrderId, status: "pending" };
    }
    return structuredClone(entry.purchase);
  }

  async floatAvailable(): Promise<bigint> {
    return this.floatLeft;
  }
}

function toBrand(b: MockBrand, country: string): GiftBrand {
  const { countries: _c, barcodeFormat: _b, hasPin: _p, hasUrl: _u, instructions: _i, ...rest } = b;
  return { ...rest, country, ...(b.denominations ? { denominations: [...b.denominations] } : {}) };
}

function checkAmount(b: MockBrand, amount: bigint) {
  if (amount < b.minAmount || amount > b.maxAmount) throw new Error(`${b.name} cards are between $${b.minAmount / 1_000_000n} and $${b.maxAmount / 1_000_000n}`);
  if (b.denominations && !b.denominations.includes(amount)) throw new Error(`${b.name} cards come in fixed amounts only`);
  if (amount % 10_000n !== 0n) throw new Error("Amount must be whole cents");
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function fakeRedemption(b: MockBrand, h: string) {
  const digits = BigInt(`0x${h.slice(0, 15)}`).toString().padStart(16, "0").slice(0, 16);
  const code = `DEMO-${h.slice(16, 20)}-${h.slice(20, 24)}-${h.slice(24, 28)}`.toUpperCase();
  return {
    code: b.barcodeFormat ? digits : code,
    ...(b.hasPin ? { pin: BigInt(`0x${h.slice(28, 36)}`).toString().slice(0, 8).padStart(8, "0") } : {}),
    ...(b.hasUrl ? { url: `https://example.com/redeem/${b.id}?code=${code}` } : {}),
    ...(b.barcodeFormat ? { barcode: { format: b.barcodeFormat, value: digits } } : {}),
    instructions: b.instructions,
  };
}
