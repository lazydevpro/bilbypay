/**
 * Bitrefill REST API v2 (Business tier for production; Personal works for our own testing only —
 * Bitrefill's ToS forbids reselling on a Personal account, see research notes §1 "Terms").
 *
 * docs.bitrefill.com was not reachable from the build container. Shapes come from:
 *  - research_notes/Gift cards/crypto_native_alternatives.md §1 (read from the live docs 2026-09-25);
 *  - bitrefill/agents skills/bitrefill/references/touchpoints/api.md and bitrefill/bitrefill-mcp-server
 *    src/utils/api/authenticated.ts + src/types/api.ts (Bitrefill's own repos, GitHub, 2026-09-25);
 *  - the Bitrefill MCP (read-only calls on 2026-09-25: product details + balances; the MCP layer
 *    reformats responses, so REST field names can differ).
 * Items marked VERIFY are inferred, not confirmed. Check them with the free test products
 * (`test-gift-card-code`, `test-gift-card-link`, `*-fail`, Business accounts only) before real money.
 *
 * Endpoints used:
 *   GET  /products?country=&start=&limit=&include_test_products=   → {data:[Product], meta:{_next?}}
 *   GET  /products/{id}                                             → {data: Product with packages/range}
 *   POST /invoices {products:[{product_id,value,quantity}], payment_method:"balance", auto_pay, send_email:false, webhook_url?}
 *   POST /invoices/{id}/pay                                         (two-step mode)
 *   GET  /invoices/{id}                                             → {data:{id,status,payment,orders:[{id,status}]}}
 *   GET  /orders/{id}                                               → {data:{redemption_info:{code,pin,link,barcode_format,barcode_value,instructions,expiration_date}}}
 *   GET  /accounts/balance                                          (shape VERIFY — parsed defensively)
 *
 * Idempotency: POST /invoices has no idempotency key or metadata field (notes: [U]). So by default we
 * create the invoice WITHOUT auto_pay, persist its id, and only then pay it with POST /invoices/{id}/pay
 * — a crash at any point leaves at most an unpaid invoice, never a second paid one. On resume we GET
 * the invoice before paying, so /pay is never sent for an invoice that's already paid.
 * `autoPay: true` saves one round trip but has a crash window (create+pay succeeded, id not yet
 * persisted) that we can only surface as "pending, needs review".
 */
import type { FetchLike, GiftBrand, GiftCardProvider, GiftPurchase, GiftQuote, GiftRedemption, IdempotencyStore } from "./types";
import {
  addPercent,
  errorText,
  fromUnits,
  isRecord,
  KeyedMutex,
  MemoryIdempotencyStore,
  ProviderUnavailableError,
  readJson,
  sleep,
  str,
  toUnits,
} from "./util";

/**
 * Notes: OpenAPI says api-bitrefill.com/v2 but the guides (and Bitrefill's own MCP server + agent
 * skills) use api.bitrefill.com/v2. VERIFY; override with BITREFILL_BASE_URL.
 */
export const BITREFILL_BASE_URL = "https://api.bitrefill.com/v2";

export type BitrefillProviderOptions = {
  /** Business/Affiliate: HTTP Basic API_ID:API_SECRET. */
  apiId?: string;
  apiSecret?: string;
  /** Personal: Bearer key. Used only if apiId/apiSecret are absent. */
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  store?: IdempotencyStore;
  /** List the free test products (Business accounts only). */
  includeTestProducts?: boolean;
  /** See file comment. Default false (create, persist, then pay). */
  autoPay?: boolean;
  webhookUrl?: string;
  /**
   * Which balance sub-account to pay from ("USD"). The MCP exposes `balance_currency`; whether REST
   * /invoices accepts it is VERIFY, so it's only sent when set.
   */
  balanceCurrency?: string;
  /** Estimated fee % for catalog/quote when a product has no explicit USD package price. Default 0. */
  feePercent?: number;
  pollAttempts?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  catalogTtlMs?: number;
  now?: () => number;
};

type Rec =
  | { phase: "creating" }
  | { phase: "created"; invoiceId: string }
  | { phase: "done"; purchase: GiftPurchase };

const REASONS = {
  unavailable: "This gift card isn't available right now.",
  badAmount: "That amount isn't available for this gift card.",
  failed: "We couldn't complete this gift card purchase right now.",
  review: "Your gift card is taking longer than usual. We're checking with the provider.",
};

const DELIVERED = new Set(["delivered", "complete", "completed", "all_delivered", "success"]);
const ORDER_FAILED = new Set(["failed", "refunded", "cancelled", "canceled", "denied", "error", "payment_error"]);
const INVOICE_FAILED = new Set(["denied", "payment_error", "expired", "failed", "cancelled", "canceled", "refunded"]);
const INVOICE_UNPAID = new Set(["unpaid", "not_paid", "created", "pending_payment"]);

export class BitrefillProvider implements GiftCardProvider {
  readonly name = "bitrefill";
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly store: IdempotencyStore;
  private readonly mutex = new KeyedMutex();
  private readonly authHeader: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly catalogCache = new Map<string, { at: number; brands: GiftBrand[] }>();

  constructor(private readonly options: BitrefillProviderOptions) {
    this.baseUrl = (options.baseUrl ?? BITREFILL_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.store = options.store ?? new MemoryIdempotencyStore();
    this.sleep = options.sleep ?? sleep;
    this.now = options.now ?? Date.now;
    if (options.apiId && options.apiSecret) {
      this.authHeader = `Basic ${Buffer.from(`${options.apiId}:${options.apiSecret}`).toString("base64")}`;
    } else if (options.apiKey) {
      this.authHeader = `Bearer ${options.apiKey}`;
    } else {
      throw new Error("BitrefillProvider needs apiId+apiSecret (Business) or apiKey (Personal)");
    }
  }

  private async call(method: string, path: string, body?: unknown): Promise<{ res: Response; body: unknown; data: unknown }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: this.authHeader,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new ProviderUnavailableError(this.name, `network error on ${method} ${path.split("?")[0]}: ${(err as Error).message}`);
    }
    const parsed = await readJson(res);
    const data = isRecord(parsed) && "data" in parsed ? parsed.data : parsed;
    return { res, body: parsed, data };
  }

  private async get(path: string) {
    const r = await this.call("GET", path);
    if (!r.res.ok) throw new ProviderUnavailableError(this.name, `GET ${path.split("?")[0]} → ${r.res.status} ${errorText(r.body) ?? ""}`, r.res.status);
    return r;
  }

  // ---------------------------------------------------------------- catalog / quote

  async catalog(country: string): Promise<GiftBrand[]> {
    const cc = country.toUpperCase();
    const cached = this.catalogCache.get(cc);
    if (cached && this.now() - cached.at < (this.options.catalogTtlMs ?? 60 * 60_000)) return cached.brands;
    const brands: GiftBrand[] = [];
    const limit = 50;
    // Bitrefill asks integrators to cache /products and refresh daily (rate limits: 60 req/min).
    for (let start = 0, page = 0; page < 40; page++, start += limit) {
      const q = new URLSearchParams({ country: cc, start: String(start), limit: String(limit) });
      if (this.options.includeTestProducts) q.set("include_test_products", "true");
      const { data, body } = await this.get(`/products?${q}`);
      const items = Array.isArray(data) ? data : [];
      for (const p of items) {
        const b = this.toBrand(p, cc);
        if (b) brands.push(b);
      }
      const next = isRecord(body) && isRecord(body.meta) ? body.meta._next : undefined;
      if (items.length < limit || next === null || (isRecord(body) && isRecord(body.meta) && "_next" in body.meta && !next)) break;
    }
    this.catalogCache.set(cc, { at: this.now(), brands });
    return brands;
  }

  private toBrand(p: unknown, cc: string): GiftBrand | undefined {
    if (!isRecord(p) || typeof p.id !== "string" || typeof p.name !== "string") return undefined;
    const isTest = p.id.startsWith("test-");
    if (isTest && !this.options.includeTestProducts) return undefined;
    if (!isTest && p.currency !== "USD") return undefined; // our amounts are USD
    if (p.in_stock === false || p.inStock === false) return undefined;
    if (typeof p.type === "string" && !/gift/i.test(p.type)) return undefined;
    if (typeof p.recipient_type === "string" && p.recipient_type !== "none") return undefined; // phone refills etc.
    const productCountry = str(p.country_code) ?? str(p.country);
    if (!isTest && productCountry && productCountry.toUpperCase() !== cc) return undefined;
    const amounts = productAmounts(p);
    if (!amounts) return undefined;
    const categories = Array.isArray(p.categories) ? p.categories.filter((c): c is string => typeof c === "string") : [];
    return {
      id: p.id,
      name: p.name,
      // Documented CDN uses the product ID; `image` is not a reliable asset URL.
      // https://docs.bitrefill.com/reference/get_products
      logoUrl: `https://cdn.bitrefill.com/primg/w250h100i1/${encodeURIComponent(p.id)}.png`,
      artworkUrl: `https://cdn.bitrefill.com/primg/w600h400/${encodeURIComponent(p.id)}.png`,
      country: cc,
      ...(categories[0] ? { category: categories[0] } : {}),
      minAmount: amounts.min,
      maxAmount: amounts.max,
      ...(amounts.denominations ? { denominations: amounts.denominations } : {}),
      feePercent: this.options.feePercent ?? 0,
    };
  }

  async quote(brandId: string, amount: bigint): Promise<GiftQuote> {
    const { data } = await this.get(`/products/${encodeURIComponent(brandId)}`);
    if (!isRecord(data)) throw new ProviderUnavailableError(this.name, "product response had no data");
    const amounts = productAmounts(data);
    if (!amounts) throw new Error(REASONS.unavailable);
    if (amount < amounts.min || amount > amounts.max) throw new Error(`${String(data.name)} cards are between ${fromUnits(amounts.min)} and ${fromUnits(amounts.max)} USD`);
    if (amounts.denominations && !amounts.denominations.includes(amount)) throw new Error(`${String(data.name)} cards come in fixed amounts only`);
    return { brandId, amount, price: packageUsdPrice(data, amount) ?? addPercent(amount, this.options.feePercent ?? 0) };
  }

  // ---------------------------------------------------------------- purchase

  async purchase(input: { brandId: string; amount: bigint; idempotencyKey: string; quote?: GiftQuote }): Promise<GiftPurchase> {
    const key = `bitrefill:purchase:${input.idempotencyKey}`;
    return this.mutex.run(input.idempotencyKey, async () => {
      const rec = (await this.store.get(key)) as Rec | undefined;
      if (rec?.phase === "done") return rec.purchase;
      if (rec?.phase === "created") return this.advance(key, rec.invoiceId);
      if (rec?.phase === "creating" && this.options.autoPay) {
        // A previous auto_pay create may or may not have gone through. Don't risk a second card.
        return { providerOrderId: `unknown:${input.idempotencyKey}`, status: "pending", failureReason: REASONS.review };
      }
      // Fresh (or a two-step create that never got an id back: at worst an unpaid invoice is orphaned).
      await this.store.set(key, { phase: "creating" } satisfies Rec);
      const body = {
        products: [{ product_id: input.brandId, value: Number(fromUnits(input.amount)), quantity: 1 }],
        payment_method: "balance",
        auto_pay: !!this.options.autoPay,
        send_email: false,
        ...(this.options.webhookUrl ? { webhook_url: this.options.webhookUrl } : {}),
        ...(this.options.balanceCurrency ? { balance_currency: this.options.balanceCurrency } : {}),
      };
      let created: Awaited<ReturnType<BitrefillProvider["call"]>>;
      try {
        created = await this.call("POST", "/invoices", body);
      } catch (err) {
        if (this.options.autoPay) return { providerOrderId: `unknown:${input.idempotencyKey}`, status: "pending", failureReason: REASONS.review };
        throw err; // Nothing paid; the "creating" marker lets a retry create again.
      }
      const invoiceId = isRecord(created.data) ? str(created.data.id) : undefined;
      if (!created.res.ok || !invoiceId) {
        if (created.res.status >= 500 || created.res.status === 429) {
          if (this.options.autoPay) return { providerOrderId: `unknown:${input.idempotencyKey}`, status: "pending", failureReason: REASONS.review };
          throw new ProviderUnavailableError(this.name, `POST /invoices → ${created.res.status}`, created.res.status);
        }
        const purchase: GiftPurchase = {
          providerOrderId: `none:${input.idempotencyKey}`,
          status: "failed",
          failureReason: created.res.status === 404 ? REASONS.unavailable : created.res.status === 400 ? REASONS.badAmount : REASONS.failed,
        };
        await this.store.set(key, { phase: "done", purchase } satisfies Rec);
        return purchase;
      }
      await this.store.set(key, { phase: "created", invoiceId } satisfies Rec);
      return this.advance(key, invoiceId, created.data);
    });
  }

  /** Pays (if still unpaid and we're in two-step mode), polls, and maps the invoice. */
  private async advance(storeKey: string, invoiceId: string, initial?: unknown): Promise<GiftPurchase> {
    let invoice = isRecord(initial) ? initial : (await this.get(`/invoices/${encodeURIComponent(invoiceId)}`)).data;
    if (!this.options.autoPay && isRecord(invoice) && isUnpaid(invoice)) {
      const paid = await this.call("POST", `/invoices/${encodeURIComponent(invoiceId)}/pay`);
      if (!paid.res.ok) {
        if (paid.res.status >= 500 || paid.res.status === 429) return { providerOrderId: invoiceId, status: "pending", failureReason: REASONS.review };
        // e.g. insufficient balance. The invoice stays unpaid, so this is final for us.
        const purchase: GiftPurchase = { providerOrderId: invoiceId, status: "failed", failureReason: REASONS.failed };
        await this.store.set(storeKey, { phase: "done", purchase } satisfies Rec);
        return purchase;
      }
      invoice = isRecord(paid.data) && paid.data.id ? paid.data : invoice;
    }
    const attempts = this.options.pollAttempts ?? 10;
    for (let i = 0; ; i++) {
      const purchase = await this.mapInvoice(invoiceId, invoice);
      if (purchase.status !== "pending" || i >= attempts) {
        if (purchase.status !== "pending") await this.store.set(storeKey, { phase: "done", purchase } satisfies Rec);
        return purchase;
      }
      await this.sleep(this.options.pollIntervalMs ?? 1000);
      invoice = (await this.get(`/invoices/${encodeURIComponent(invoiceId)}`)).data;
    }
  }

  private async mapInvoice(invoiceId: string, invoice: unknown): Promise<GiftPurchase> {
    if (!isRecord(invoice)) return { providerOrderId: invoiceId, status: "pending" };
    const status = String(invoice.status ?? "").toLowerCase();
    const orders = Array.isArray(invoice.orders) ? invoice.orders.filter(isRecord) : [];
    const order = orders[0];
    if (INVOICE_FAILED.has(status)) return { providerOrderId: invoiceId, status: "failed", failureReason: REASONS.failed };
    if (!order) return { providerOrderId: invoiceId, status: "pending" };
    const orderStatus = String(order.status ?? "").toLowerCase();
    // A "complete" invoice can still contain a failed order (notes: webhooks) — check the order.
    if (ORDER_FAILED.has(orderStatus)) return { providerOrderId: invoiceId, status: "failed", failureReason: REASONS.failed };
    if (!DELIVERED.has(orderStatus) && !isRecord(order.redemption_info)) return { providerOrderId: invoiceId, status: "pending" };
    const orderId = str(order.id);
    let info = isRecord(order.redemption_info) ? order.redemption_info : undefined;
    if (!info && orderId) {
      const { data } = await this.get(`/orders/${encodeURIComponent(orderId)}`);
      if (isRecord(data)) {
        if (ORDER_FAILED.has(String(data.status ?? "").toLowerCase())) {
          return { providerOrderId: invoiceId, status: "failed", failureReason: REASONS.failed };
        }
        info = isRecord(data.redemption_info) ? data.redemption_info : undefined;
      }
    }
    const redemption = info && toRedemption(info);
    return redemption ? { providerOrderId: invoiceId, status: "completed", redemption } : { providerOrderId: invoiceId, status: "pending" };
  }

  /** providerOrderId is the Bitrefill invoice id. */
  async getPurchase(providerOrderId: string): Promise<GiftPurchase> {
    if (providerOrderId.startsWith("unknown:")) {
      return { providerOrderId, status: "pending", failureReason: REASONS.review };
    }
    if (providerOrderId.startsWith("none:")) {
      return { providerOrderId, status: "failed", failureReason: REASONS.failed };
    }
    const { data } = await this.get(`/invoices/${encodeURIComponent(providerOrderId)}`);
    return this.mapInvoice(providerOrderId, data);
  }

  /** USD sub-account balance. Response shape is VERIFY; see parseUsdBalance. */
  async floatAvailable(): Promise<bigint> {
    const { data } = await this.get("/accounts/balance");
    const v = parseUsdBalance(data);
    if (v === undefined) throw new ProviderUnavailableError(this.name, "could not find a USD balance in /accounts/balance");
    return v;
  }
}

// ------------------------------------------------------------------ helpers

function isUnpaid(invoice: Record<string, unknown>): boolean {
  const s = String(invoice.status ?? "").toLowerCase();
  const payment = isRecord(invoice.payment) ? String(invoice.payment.status ?? "").toLowerCase() : "";
  return INVOICE_UNPAID.has(s) || INVOICE_UNPAID.has(payment);
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return undefined;
}

/** Face-value bounds. `range` = open amounts; otherwise the package values are the denominations. */
function productAmounts(p: Record<string, unknown>): { min: bigint; max: bigint; denominations?: bigint[] } | undefined {
  if (isRecord(p.range)) {
    const min = num(p.range.min);
    const max = num(p.range.max);
    if (min !== undefined && max !== undefined) return { min: toUnits(min), max: toUnits(max) };
  }
  const values = (Array.isArray(p.packages) ? p.packages : [])
    .map((pk) => (isRecord(pk) ? num(pk.value ?? pk.package_value) : undefined))
    .filter((v): v is number => v !== undefined)
    .map((v) => toUnits(v))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!values.length) return undefined;
  return { min: values[0]!, max: values[values.length - 1]!, denominations: values };
}

/**
 * USD price of the matching package, if the product lists one. VERIFY: which REST field carries it.
 * We accept `usdPrice`/`usd_price` (third-party OpenAPI copy), or `price` only for USD products
 * where it is plausibly a USD price (within 0.8x–1.2x of face value; guards against satoshis).
 */
function packageUsdPrice(p: Record<string, unknown>, amount: bigint): bigint | undefined {
  const pkgs = Array.isArray(p.packages) ? p.packages.filter(isRecord) : [];
  const pkg = pkgs.find((pk) => {
    const v = num(pk.value ?? pk.package_value);
    return v !== undefined && toUnits(v) === amount;
  });
  if (!pkg) return undefined;
  const usd = num(pkg.usdPrice ?? pkg.usd_price);
  if (usd !== undefined) return toUnits(usd);
  const price = num(pkg.price ?? pkg.payment_price);
  if (price !== undefined && p.currency === "USD") {
    const units = toUnits(price);
    if (units * 10n >= amount * 8n && units * 10n <= amount * 12n) return units;
  }
  return undefined;
}

function toRedemption(info: Record<string, unknown>): GiftRedemption | undefined {
  const r: GiftRedemption = {};
  const code = str(info.code);
  const pin = str(info.pin);
  const url = str(info.link);
  const format = str(info.barcode_format);
  const value = str(info.barcode_value);
  const instructions = str(info.instructions);
  if (code) r.code = code;
  if (pin) r.pin = pin;
  if (url) r.url = url;
  if (format && value) r.barcode = { format, value };
  if (instructions) r.instructions = instructions;
  return code || url || value ? r : undefined;
}

/**
 * Accepts the shapes seen so far (none confirmed for REST):
 *   {balance: 12.3, currency: "USD"}                                  (third-party client tests)
 *   [{currency|balance_currency: "USD", amount|balance: "12.30", amount_base?, decimals?}, ...]
 *   {balances: [...same...]}                                           (Bitrefill MCP get-balances)
 */
export function parseUsdBalance(data: unknown): bigint | undefined {
  const entries: unknown[] = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.balances)
      ? data.balances
      : isRecord(data)
        ? [data]
        : [];
  for (const e of entries) {
    if (!isRecord(e)) continue;
    const currency = String(e.balance_currency ?? e.currency ?? "").toUpperCase();
    if (currency !== "USD") continue;
    if (e.payment_method !== undefined && e.payment_method !== "balance") continue; // skip cashback
    const baseUnits = num(e.amount_base);
    const decimals = num(e.decimals);
    if (baseUnits !== undefined && decimals !== undefined && decimals <= 6) {
      return BigInt(Math.round(baseUnits)) * 10n ** BigInt(6 - decimals);
    }
    const v = num(e.amount ?? e.balance);
    if (v !== undefined) return toUnits(v);
  }
  return undefined;
}
