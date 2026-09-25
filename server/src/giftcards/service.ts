import { formatUsd } from "@bilbypay/core";
import type { Address, Hex } from "viem";
import type { ActivityRepo } from "../activity";
import type { Db } from "../db";
import { errors } from "../errors";
import { decryptSecret, encryptSecret } from "../secrets";
import type { Treasury } from "../treasury";
import { newId, nowIso } from "../util";
import type { GiftBrand, GiftCardProvider, GiftQuote, GiftRedemption } from "./types";

export type GiftOrderRow = {
  id: string;
  gift_id: string;
  owner_address: string;
  source: "buy" | "gift";
  brand_id: string;
  brand_name: string;
  logo_url: string;
  face_value: string;
  paid: string;
  provider: string;
  provider_order_id: string | null;
  status: "processing" | "ready" | "failed";
  redemption_enc: string | null;
  from_name: string | null;
  failure_reason: string | null;
  refund_to: string | null;
  refund_tx: string | null;
  activity_id: string | null;
  created_at: string;
  updated_at: string;
};

export type FulfilInput = {
  giftId: Hex;
  owner: Address;
  source: "buy" | "gift";
  brand: GiftBrand;
  faceValue: bigint;
  /** What was paid into the treasury for this card; refunded in full if the purchase fails. */
  paid: bigint;
  refundTo: Address;
  fromName?: string;
  activityId?: string;
  quote?: GiftQuote;
};

const CATALOG_TTL_MS = 5 * 60_000;
const PURCHASE_ATTEMPTS = 3;

/**
 * Buys cards from the provider float after the user's money has landed in the treasury.
 * Invariants: one purchase per giftId (UNIQUE), provider order id stored before any code is
 * stored or shown, codes encrypted at rest and never logged, a definitive failure refunds in full.
 */
export class GiftCardService {
  private catalogs = new Map<string, { at: number; brands: GiftBrand[] }>();

  constructor(
    private readonly db: Db,
    readonly provider: GiftCardProvider,
    private readonly treasury: Treasury,
    private readonly activity: ActivityRepo,
    private readonly codeKey: Buffer,
    private readonly countries: string[] = ["US"],
  ) {}

  async brands(country: string): Promise<GiftBrand[]> {
    const key = country.toUpperCase();
    const cached = this.catalogs.get(key);
    if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.brands;
    const brands = await this.provider.catalog(key);
    this.catalogs.set(key, { at: Date.now(), brands });
    return brands;
  }

  async findBrand(brandId: string): Promise<GiftBrand | undefined> {
    const countries = new Set([...this.countries, ...this.catalogs.keys()]);
    for (const country of countries) {
      const brand = (await this.brands(country)).find((b) => b.id === brandId);
      if (brand) return brand;
    }
    return undefined;
  }

  async catalogView(country: string) {
    const [brands, float] = await Promise.all([this.brands(country), this.provider.floatAvailable()]);
    return brands.map((b) => ({
      id: b.id,
      name: b.name,
      logoUrl: b.logoUrl,
      category: b.category,
      country: b.country,
      minAmount: b.minAmount.toString(),
      maxAmount: b.maxAmount.toString(),
      denominations: b.denominations?.map(String),
      feePercent: b.feePercent,
      available: float >= b.minAmount,
    }));
  }

  validateAmount(brand: GiftBrand, amount: bigint) {
    if (brand.denominations?.length) {
      if (!brand.denominations.includes(amount)) {
        const list = brand.denominations.map((d) => formatUsd(d)).join(", ");
        throw errors.invalidRequest(`${brand.name} cards come in ${list}. Pick one of those amounts.`);
      }
    } else if (amount < brand.minAmount || amount > brand.maxAmount) {
      throw errors.invalidRequest(`${brand.name} cards are ${formatUsd(brand.minAmount)} to ${formatUsd(brand.maxAmount)}.`);
    }
  }

  async quoteView(brandId: string, amount: bigint) {
    const brand = await this.findBrand(brandId);
    if (!brand) throw errors.notFound("We couldn't find that gift card.");
    this.validateAmount(brand, amount);
    const [quote, float] = await Promise.all([this.provider.quote(brandId, amount), this.provider.floatAvailable()]);
    return { brandId, amount: amount.toString(), price: quote.price.toString(), available: float >= quote.price };
  }

  /** Pre-check before the user pays: brand exists, amount fits, and the float can cover it. */
  async checkAvailable(brandId: string, amount: bigint): Promise<{ brand: GiftBrand; quote: GiftQuote }> {
    const brand = await this.findBrand(brandId);
    if (!brand) throw errors.giftUnavailable("We couldn't find that gift card. Please pick another brand.");
    this.validateAmount(brand, amount);
    const [quote, float] = await Promise.all([this.provider.quote(brandId, amount), this.provider.floatAvailable()]);
    if (float < quote.price) throw errors.giftUnavailable(`${brand.name} cards are temporarily unavailable. Please pick another brand.`);
    return { brand, quote };
  }

  getOrder(id: string): GiftOrderRow | undefined {
    return this.db.prepare("SELECT * FROM gift_orders WHERE id = ?").get(id) as GiftOrderRow | undefined;
  }

  private byGiftId(giftId: Hex): GiftOrderRow | undefined {
    return this.db.prepare("SELECT * FROM gift_orders WHERE gift_id = ?").get(giftId) as GiftOrderRow | undefined;
  }

  async fulfil(input: FulfilInput): Promise<GiftOrderRow> {
    let order = this.byGiftId(input.giftId);
    if (!order) {
      const id = newId("gc");
      const now = nowIso();
      try {
        this.db
          .prepare(
            `INSERT INTO gift_orders (id, gift_id, owner_address, source, brand_id, brand_name, logo_url, face_value, paid,
              provider, status, from_name, refund_to, activity_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.giftId,
            input.owner,
            input.source,
            input.brand.id,
            input.brand.name,
            input.brand.logoUrl,
            input.faceValue.toString(),
            input.paid.toString(),
            this.provider.name,
            input.fromName ?? null,
            input.refundTo,
            input.activityId ?? null,
            now,
            now,
          );
      } catch (err) {
        // Lost a race on the UNIQUE(gift_id): the other caller owns the purchase.
        if (!String(err).includes("UNIQUE")) throw err;
      }
      order = this.byGiftId(input.giftId)!;
    }
    if (order.status !== "processing" || order.provider_order_id) return order;
    return this.purchase(order, input.quote);
  }

  private async purchase(order: GiftOrderRow, quote?: GiftQuote): Promise<GiftOrderRow> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < PURCHASE_ATTEMPTS; attempt++) {
      try {
        const p = await this.provider.purchase({
          brandId: order.brand_id,
          amount: BigInt(order.face_value),
          idempotencyKey: order.gift_id,
          quote,
        });
        // The order id goes in first, so a crash after this point can always be reconciled.
        this.db.prepare("UPDATE gift_orders SET provider_order_id = ?, updated_at = ? WHERE id = ?").run(p.providerOrderId, nowIso(), order.id);
        return this.applyResult(order.id, p.status, p.redemption, p.failureReason);
      } catch (err) {
        lastErr = err;
      }
    }
    // Ambiguous (network/provider error): the card may or may not exist, so never refund here.
    // The keeper retries with the same idempotency key until the provider gives a definite answer.
    console.error(`gift ${order.id}: purchase attempts failed, will retry`, lastErr instanceof Error ? lastErr.message : lastErr);
    return this.getOrder(order.id)!;
  }

  private async applyResult(
    id: string,
    status: "completed" | "pending" | "failed",
    redemption: GiftRedemption | undefined,
    failureReason: string | undefined,
  ): Promise<GiftOrderRow> {
    if (status === "completed" && redemption) {
      const enc = encryptSecret(this.codeKey, JSON.stringify(redemption), id);
      this.db
        .prepare("UPDATE gift_orders SET status = 'ready', redemption_enc = ?, updated_at = ? WHERE id = ? AND status = 'processing'")
        .run(enc, nowIso(), id);
      const order = this.getOrder(id)!;
      if (order.activity_id) this.activity.update(order.activity_id, { status: "completed", giftCardId: id });
      return order;
    }
    if (status === "failed") {
      this.db
        .prepare("UPDATE gift_orders SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ? AND status = 'processing'")
        .run(failureReason ?? "failed", nowIso(), id);
      await this.refund(id);
      return this.getOrder(id)!;
    }
    return this.getOrder(id)!;
  }

  /** Returns the full payment to the payer. Guarded so it can only ever run once per card. */
  async refund(id: string): Promise<void> {
    const claimed = this.db
      .prepare("UPDATE gift_orders SET refund_tx = 'sending', updated_at = ? WHERE id = ? AND status = 'failed' AND refund_tx IS NULL")
      .run(nowIso(), id);
    if (claimed.changes !== 1) return;
    const order = this.getOrder(id)!;
    const amount = BigInt(order.paid);
    let hash: Hex | undefined;
    try {
      const sent = await this.treasury.pay(order.refund_to as Address, amount, `refund ${id}`);
      hash = sent.hash;
    } catch (err) {
      // Not broadcast (the relayer estimates first): safe to retry later.
      this.db.prepare("UPDATE gift_orders SET refund_tx = NULL WHERE id = ?").run(id);
      console.error(`gift ${id}: refund failed, will retry`, err instanceof Error ? err.message : err);
      return;
    }
    this.db.prepare("UPDATE gift_orders SET refund_tx = ?, updated_at = ? WHERE id = ?").run(hash, nowIso(), id);
    if (order.activity_id) this.activity.update(order.activity_id, { status: "failed", giftCardId: id });
    this.activity.add({
      address: order.refund_to as Address,
      kind: "refund",
      status: "completed",
      amount,
      note: `${order.brand_name} cards are unavailable right now, so your ${formatUsd(amount)} is back in your balance.`,
      giftCardId: id,
      txHash: hash,
    });
  }

  /** Keeper: settles cards left processing (pending at the provider, or an ambiguous error). */
  async reconcile(): Promise<void> {
    const rows = this.db.prepare("SELECT * FROM gift_orders WHERE status = 'processing'").all() as GiftOrderRow[];
    for (const order of rows) {
      try {
        if (!order.provider_order_id) await this.purchase(order);
        else {
          const p = await this.provider.getPurchase(order.provider_order_id);
          await this.applyResult(order.id, p.status, p.redemption, p.failureReason);
        }
      } catch (err) {
        console.error(`gift ${order.id}: reconcile failed`, err instanceof Error ? err.message : err);
      }
    }
    const unrefunded = this.db.prepare("SELECT id FROM gift_orders WHERE status = 'failed' AND refund_tx IS NULL").all() as { id: string }[];
    for (const { id } of unrefunded) await this.refund(id);
  }

  list(owner: Address) {
    const rows = this.db
      .prepare("SELECT * FROM gift_orders WHERE owner_address = ? ORDER BY created_at DESC")
      .all(owner) as GiftOrderRow[];
    return rows.map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      brandName: r.brand_name,
      logoUrl: r.logo_url,
      amount: r.face_value,
      status: r.status,
      createdAt: r.created_at,
      from: r.from_name ?? undefined,
    }));
  }

  /** Decrypts a card's code for its owner. Never log the return value. */
  reveal(owner: Address, id: string): GiftRedemption {
    const order = this.getOrder(id);
    if (!order || order.owner_address !== owner) throw errors.notFound("We couldn't find that gift card.");
    if (order.status === "processing") throw errors.giftProcessing();
    if (order.status !== "ready" || !order.redemption_enc) throw errors.giftUnavailable("This gift card couldn't be delivered, and the money was returned.");
    return JSON.parse(decryptSecret(this.codeKey, order.redemption_enc, order.id)) as GiftRedemption;
  }
}
