import { createHash, createHmac, createPublicKey, verify, type KeyObject } from "node:crypto";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import type { RampConfig } from "./config";
import { tx, type Db } from "./db";
import { ApiError, errors } from "./errors";
import { decryptSecret, encryptSecret } from "./secrets";
import { KeyedMutex, newId } from "./util";

// Pinned sandbox endpoints/key. No environment setting can switch this service to live funding.
export const RAMP_DEMO_API = "https://api.demo.rampnetwork.com/api";
export const RAMP_DEMO_WIDGET = "https://app.demo.rampnetwork.com";
// https://docs.rampnetwork.com/webhooks — demo secp256k1 key, not the production key.
export const RAMP_DEMO_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEevN2PMEeIaaMkS4VIfXOqsLebj19kVeu
wWl0AnkIA6DJU0r3ixkXVhJTltycJtkDoEAYtPHfARyTofB5ZNw9xA==
-----END PUBLIC KEY-----`;
const DEMO_ASSET = { chain: "BASE", symbol: "USDC", type: "ERC20", decimals: 6, address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" };
const SESSION_TTL_MS = 24 * 60 * 60_000;
const DISCOVERY_TTL_MS = 60_000;
const RECONCILE_INTERVAL_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const terminal = new Set<FundingStatus>(["completed", "failed", "cancelled", "expired"]);

export type FundingStatus = "pending" | "processing" | "completed" | "failed" | "cancelled" | "expired";
export type FundingOptions = {
  provider: "ramp"; environment: "sandbox"; available: boolean;
  unavailableReason?: "not_configured" | "provider_unavailable" | "asset_unavailable";
  message: string; country: "US"; currency: "USD"; minAmount: string; maxAmount: string;
};
export type FundingSession = {
  id: string; environment: "sandbox"; status: FundingStatus; amount: string; currency: "USD";
  checkoutUrl?: string; createdAt: string; updatedAt: string; message: string; fee?: string;
};
type Asset = { chain: string; symbol: string; type: string; decimals: number; address: string | null };
type SessionRow = {
  id: string; owner_address: Address; idempotency_key: string; status: FundingStatus; amount: string;
  recipient_address: Address; asset: string; asset_details: string; return_url: string; checkout_url: string;
  provider_purchase_id: string | null; provider_view_token_enc: string | null; provider_status: string | null;
  provider_rank: number; provider_updated_at: number | null; fee: string | null; last_checked_at: number;
  created_at: string; updated_at: string; expires_at: number;
};
type Discovery = { options: FundingOptions; asset?: Asset };
type Dependencies = { fetch?: typeof fetch; now?: () => number; webhookPublicKey?: KeyObject };
const assetSchema = z.object({
  chain: z.string().max(40), symbol: z.string().max(40), type: z.string().max(40), decimals: z.number().int().min(0).max(36),
  address: z.string().max(160).nullable().optional(), enabled: z.boolean(), hidden: z.boolean(),
  currencyCode: z.string(), minPurchaseAmount: z.number(), maxPurchaseAmount: z.number(),
});
const discoverySchema = z.object({ currencyCode: z.literal("USD"), minPurchaseAmount: z.number(), maxPurchaseAmount: z.number(), assets: z.array(assetSchema).max(2000) });
const purchaseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/), receiverAddress: z.string().max(160), fiatCurrency: z.literal("USD"),
  fiatValue: z.number().finite().positive(), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  status: z.enum(["INITIALIZED", "PAYMENT_STARTED", "PAYMENT_IN_PROGRESS", "PAYMENT_FAILED", "PAYMENT_EXECUTED", "FIAT_SENT", "FIAT_RECEIVED", "RELEASING", "RELEASED", "EXPIRED", "CANCELLED"]),
  asset: z.object({ chain: z.string(), symbol: z.string(), type: z.string(), decimals: z.number().int(), address: z.string().nullable() }),
  purchaseViewToken: z.string().min(1).max(500).optional(), appliedFee: z.number().finite().nonnegative().optional(),
});
type Purchase = z.infer<typeof purchaseSchema>;
const webhookSchema = z.object({ type: z.enum(["CREATED", "RELEASED", "RETURNED"]), purchase: purchaseSchema });

/** Ramp signs sorted, compact JSON recursively, not the raw whitespace or callback URL. */
export function canonicalRampJson(value: unknown, depth = 0): string {
  if (depth > 40) throw new Error("JSON nesting too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalRampJson(item, depth + 1)).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalRampJson((value as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
  throw new Error("Unsupported JSON value");
}

/** Exact cent precision for provider fiat prices and request amounts. */
function providerUsd(value: number): bigint {
  const cents = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) throw new Error("Invalid fiat precision");
  return BigInt(cents) * 10_000n;
}
function sameAddress(a: string, b: string) { return /^0x[0-9a-fA-F]{40}$/.test(a) && a.toLowerCase() === b.toLowerCase(); }
function sameAsset(a: Asset, b: Asset) {
  return a.chain === b.chain && a.symbol === b.symbol && a.type === b.type && a.decimals === b.decimals &&
    (a.address === null ? b.address === null : b.address !== null && sameAddress(a.address, b.address));
}

/** This service can only record provider simulations. It has no chain, balance, or treasury dependency. */
export class RampFundingService {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly publicKey: KeyObject;
  private readonly locks = new KeyedMutex();
  private discoveryCache?: { at: number; result: Discovery };
  private discoveryInFlight?: Promise<Discovery>;

  constructor(private readonly db: Db, private readonly config: RampConfig, private readonly receiverSecret: Uint8Array, private readonly encryptionKey: Buffer, dependencies: Dependencies = {}) {
    if (config.mode !== "disabled" && config.mode !== "sandbox") throw new Error("Live Ramp funding is not implemented");
    this.fetcher = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.publicKey = dependencies.webhookPublicKey ?? createPublicKey(RAMP_DEMO_PUBLIC_KEY);
  }

  async options(): Promise<FundingOptions> { return (await this.discovery()).options; }

  async create(owner: Address, input: { amount: string; returnUrl: string; idempotencyKey: string }): Promise<FundingSession> {
    if (!this.isConfigured()) throw new ApiError(503, "FUNDING_UNAVAILABLE", this.unavailable("not_configured").message, { unavailableReason: "not_configured" });
    const normalizedOwner = getAddress(owner);
    if (!/^[1-9]\d{0,13}$/.test(input.amount) || BigInt(input.amount) % 10_000n !== 0n) throw errors.invalidRequest("Enter a dollar amount with at most two decimal places.");
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.idempotencyKey)) throw errors.invalidRequest();
    const returnUrl = this.validReturnUrl(input.returnUrl);
    return this.locks.run(`${normalizedOwner}:${input.idempotencyKey}`, async () => {
      const existing = this.db.prepare("SELECT * FROM ramp_sessions WHERE owner_address = ? AND idempotency_key = ?").get(normalizedOwner, input.idempotencyKey) as SessionRow | undefined;
      if (existing) {
        if (existing.amount !== input.amount || existing.return_url !== returnUrl) throw new ApiError(409, "FUNDING_REQUEST_CHANGED", "Start a new checkout for a different amount.");
        return this.view(this.expire(existing));
      }
      const { options, asset } = await this.discovery();
      if (!options.available || !asset) throw new ApiError(503, "FUNDING_UNAVAILABLE", options.message, { unavailableReason: options.unavailableReason });
      const amount = BigInt(input.amount);
      if (amount < BigInt(options.minAmount) || amount > BigInt(options.maxAmount)) throw errors.invalidRequest("That amount is outside the available checkout limits.");
      const id = newId("fund");
      const recipient = this.sandboxRecipient(id);
      const finalUrl = new URL(returnUrl); finalUrl.searchParams.set("id", id);
      const checkout = new URL(RAMP_DEMO_WIDGET);
      const params = {
        hostApiKey: this.config.hostApiKey!, hostAppName: "BilbyPay Sandbox", hostLogoUrl: this.config.hostLogoUrl!,
        defaultFlow: "ONRAMP", enabledFlows: "ONRAMP", enabledCryptoAssets: this.config.sandboxAsset,
        inAsset: "USD", outAsset: this.config.sandboxAsset, inAssetValue: (amount / 10_000n).toString(),
        selectedCountryCode: "US", userAddress: recipient,
        webhookStatusUrl: `${this.config.webhookBaseUrl}/v1/funding/webhooks/ramp/${id}`,
        // Hosted finalUrl stays in this browsing context; successUrl/failureUrl open a new tab.
        finalUrl: finalUrl.href,
      };
      for (const [key, value] of Object.entries(params)) checkout.searchParams.set(key, value);
      const created = new Date(this.now()).toISOString();
      this.db.prepare(`INSERT INTO ramp_sessions (id,owner_address,idempotency_key,environment,status,amount,currency,recipient_address,asset,asset_details,return_url,checkout_url,created_at,updated_at,expires_at)
        VALUES (?,?,?,'sandbox','pending',?,'USD',?,?,?,?,?,?,?,?)`).run(id, normalizedOwner, input.idempotencyKey, input.amount, recipient, this.config.sandboxAsset, JSON.stringify(asset), returnUrl, checkout.href, created, created, this.now() + SESSION_TTL_MS);
      return this.view(this.row(id)!);
    });
  }

  async get(owner: Address, id: string): Promise<FundingSession> {
    let row = this.row(id);
    if (!row || row.owner_address.toLowerCase() !== owner.toLowerCase()) throw errors.notFound();
    row = this.expire(row);
    if (this.config.mode === "sandbox" && !terminal.has(row.status) && row.provider_purchase_id && row.provider_view_token_enc && this.now() - row.last_checked_at >= RECONCILE_INTERVAL_MS) {
      await this.locks.run(id, async () => {
        const current = this.row(id)!;
        if (terminal.has(current.status) || this.now() - current.last_checked_at < RECONCILE_INTERVAL_MS) return;
        this.db.prepare("UPDATE ramp_sessions SET last_checked_at = ? WHERE id = ?").run(this.now(), id);
        try {
          const url = new URL(`${RAMP_DEMO_API}/host-api/purchase/${encodeURIComponent(current.provider_purchase_id!)}`);
          url.searchParams.set("secret", decryptSecret(this.encryptionKey, current.provider_view_token_enc!, `ramp:${id}`));
          const purchase = purchaseSchema.parse(await this.readJson(url));
          this.applyPurchase(id, purchase);
        } catch { /* Provider interruptions never turn an unfinished simulation into a payment. */ }
      });
      row = this.row(id)!;
    }
    return this.view(row);
  }

  webhook(id: string, rawBody: string, signature: string | undefined): void {
    this.assertSandbox();
    if (Buffer.byteLength(rawBody) > 64_000 || !signature || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length > 200) throw new ApiError(401, "FUNDING_WEBHOOK_INVALID", "Invalid provider update.");
    let raw: unknown;
    let canonical: string;
    try {
      raw = JSON.parse(rawBody);
      canonical = canonicalRampJson(raw);
      if (!verify("sha256", Buffer.from(canonical), this.publicKey, Buffer.from(signature, "base64"))) throw new Error("signature");
    } catch { throw new ApiError(401, "FUNDING_WEBHOOK_INVALID", "Invalid provider update."); }
    const parsed = webhookSchema.safeParse(raw);
    if (!parsed.success) throw errors.invalidRequest("Unsupported provider update.");
    const event = parsed.data;
    if (event.type === "RELEASED" && event.purchase.status !== "RELEASED") throw errors.invalidRequest("Inconsistent provider update.");
    const fingerprint = createHash("sha256").update(canonical).digest("hex");
    this.applyPurchase(id, event.purchase, event.type, fingerprint);
  }

  private applyPurchase(id: string, purchase: Purchase, eventType?: "CREATED" | "RELEASED" | "RETURNED", fingerprint?: string) {
    tx(this.db, () => {
      const row = this.row(id);
      if (!row) throw errors.notFound();
      // URL parameters are not signed. The unique recipient in the signed body binds this session.
      const asset = JSON.parse(row.asset_details) as Asset;
      let amount: bigint;
      try { amount = providerUsd(purchase.fiatValue); } catch { throw errors.invalidRequest("Invalid provider amount."); }
      if (!sameAddress(purchase.receiverAddress, row.recipient_address) || purchase.fiatCurrency !== "USD" || amount.toString() !== row.amount || !sameAsset(purchase.asset, asset)) throw errors.invalidRequest("Provider update does not match this checkout.");
      if (row.provider_purchase_id && row.provider_purchase_id !== purchase.id) throw errors.invalidRequest("This checkout already has a provider purchase.");
      const other = this.db.prepare("SELECT id FROM ramp_sessions WHERE provider_purchase_id = ?").get(purchase.id) as { id: string } | undefined;
      if (other && other.id !== id) throw errors.invalidRequest("Provider purchase already belongs to another checkout.");
      const createdAt = Date.parse(purchase.createdAt), updatedAt = Date.parse(purchase.updatedAt);
      if (updatedAt < createdAt || updatedAt > this.now() + 5 * 60_000 || createdAt < Date.parse(row.created_at) - 5 * 60_000 || createdAt > row.expires_at) throw errors.invalidRequest("Invalid provider update time.");
      if (fingerprint) {
        const seen = this.db.prepare("SELECT session_id FROM ramp_events WHERE fingerprint = ?").get(fingerprint) as { session_id: string } | undefined;
        if (seen) { if (seen.session_id !== id) throw errors.invalidRequest("Provider update already used."); return; }
        this.db.prepare("INSERT INTO ramp_events VALUES (?,?,?)").run(fingerprint, id, new Date(this.now()).toISOString());
      }
      const outcome = this.outcome(purchase.status, eventType);
      // A locally abandoned checkout may receive delayed evidence for a purchase created in time.
      // Provider-terminal outcomes remain final; local expiry alone is not provider evidence.
      const localExpiry = row.status === "expired" && !row.provider_purchase_id;
      if ((terminal.has(row.status) && !localExpiry) || updatedAt < (row.provider_updated_at ?? 0) || outcome.rank < row.provider_rank) return;
      let fee: string | null = null;
      if (purchase.appliedFee !== undefined) {
        const rounded = Math.round(purchase.appliedFee * 1_000_000);
        if (Number.isSafeInteger(rounded) && rounded >= 0 && BigInt(rounded) <= amount) fee = String(rounded);
      }
      const encrypted = purchase.purchaseViewToken ? encryptSecret(this.encryptionKey, purchase.purchaseViewToken, `ramp:${id}`) : row.provider_view_token_enc;
      this.db.prepare(`UPDATE ramp_sessions SET provider_purchase_id=?,provider_view_token_enc=?,provider_status=?,provider_rank=?,provider_updated_at=?,status=?,fee=?,updated_at=? WHERE id=?`)
        .run(purchase.id, encrypted, purchase.status, outcome.rank, updatedAt, outcome.status, fee, new Date(this.now()).toISOString(), id);
    });
  }

  private outcome(status: Purchase["status"], type?: string): { status: FundingStatus; rank: number } {
    if (type === "RETURNED") return { status: "failed", rank: 6 };
    if (status === "RELEASED") return { status: "completed", rank: 6 };
    if (status === "EXPIRED") return { status: "expired", rank: 6 };
    if (status === "CANCELLED") return { status: "cancelled", rank: 6 };
    const rank = { INITIALIZED: 0, PAYMENT_STARTED: 1, PAYMENT_IN_PROGRESS: 2, PAYMENT_FAILED: 2, PAYMENT_EXECUTED: 3, FIAT_SENT: 3, FIAT_RECEIVED: 4, RELEASING: 5 }[status];
    // PAYMENT_FAILED describes an attempt that the provider may retry, not a terminal purchase.
    return { status: rank === 0 ? "pending" : "processing", rank };
  }

  private discovery(): Promise<Discovery> {
    if (!this.isConfigured()) return Promise.resolve({ options: this.unavailable("not_configured") });
    if (this.discoveryCache && this.now() - this.discoveryCache.at < DISCOVERY_TTL_MS) return Promise.resolve(this.discoveryCache.result);
    return this.discoveryInFlight ??= this.loadDiscovery().then((result) => { this.discoveryCache = { at: this.now(), result }; return result; }).finally(() => { this.discoveryInFlight = undefined; });
  }

  private async loadDiscovery(): Promise<Discovery> {
    try {
      const url = new URL(`${RAMP_DEMO_API}/host-api/v3/assets`);
      url.searchParams.set("currencyCode", "USD"); url.searchParams.set("hostApiKey", this.config.hostApiKey!);
      const data = discoverySchema.parse(await this.readJson(url));
      const asset = data.assets.find((a) => `${a.chain}_${a.symbol}` === this.config.sandboxAsset && a.enabled && !a.hidden && a.currencyCode === "USD");
      // Only the reviewed Base test asset is supported. Never silently choose another network.
      if (!asset || this.config.sandboxAsset !== "BASE_USDC" || !sameAsset({ ...asset, address: asset.address ?? null }, DEMO_ASSET)) return { options: this.unavailable("asset_unavailable") };
      const min = providerUsd(Math.max(data.minPurchaseAmount, asset.minPurchaseAmount < 0 ? 0 : asset.minPurchaseAmount));
      const max = providerUsd(Math.min(data.maxPurchaseAmount, asset.maxPurchaseAmount < 0 ? data.maxPurchaseAmount : asset.maxPurchaseAmount));
      if (min <= 0n || max < min) throw new Error("Invalid provider limits");
      return { asset: { chain: asset.chain, symbol: asset.symbol, type: asset.type, decimals: asset.decimals, address: asset.address! },
        options: { provider: "ramp", environment: "sandbox", available: true, country: "US", currency: "USD", minAmount: min.toString(), maxAmount: max.toString(), message: "Try a Ramp demo checkout. It will not add money to your balance." } };
    } catch { return { options: this.unavailable("provider_unavailable") }; }
  }

  private unavailable(reason: NonNullable<FundingOptions["unavailableReason"]>): FundingOptions {
    const message = reason === "not_configured" ? "Demo checkout isn't configured yet. No money will be added to your balance." : reason === "asset_unavailable" ? "This demo checkout is currently unavailable. Please try again later." : "Ramp's demo service is unavailable. Please try again later.";
    return { provider: "ramp", environment: "sandbox", available: false, unavailableReason: reason, message, country: "US", currency: "USD", minAmount: "0", maxAmount: "0" };
  }

  private async readJson(url: URL): Promise<unknown> {
    const response = await this.fetcher(url, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8_000) });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) throw new Error("Provider unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Provider response missing");
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > MAX_RESPONSE_BYTES) throw new Error("Provider response too large"); chunks.push(value); }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private validReturnUrl(raw: string): string {
    let url: URL;
    try { url = new URL(raw); } catch { throw errors.invalidRequest("Use the app's checkout return link."); }
    if (url.search || url.hash || url.username || url.password) throw errors.invalidRequest("Use the app's checkout return link.");
    const native = url.protocol === "bilbypay:" && !url.port && this.config.returnOrigins.includes("bilbypay://") &&
      ((url.hostname === "funding" && !url.pathname) || (!url.hostname && url.pathname === "/funding"));
    const web = ["https:", "http:"].includes(url.protocol) && this.config.returnOrigins.includes(url.origin) && url.pathname === "/funding";
    if (!native && !web) throw errors.invalidRequest("Use the app's checkout return link.");
    return url.href;
  }

  private sandboxRecipient(id: string): Address {
    // Domain separation makes these recoverable sandbox recipients unrelated to account/session keys.
    for (let counter = 0; counter < 10; counter++) {
      const derived = createHmac("sha256", this.receiverSecret).update(`bilbypay.ramp.sandbox.receiver.v1:${id}:${counter}`).digest("hex");
      try { return privateKeyToAccount(`0x${derived}` as Hex).address; } catch { /* Extremely unlikely invalid secp256k1 scalar. */ }
    }
    throw new Error("Could not create a sandbox recipient");
  }
  private isConfigured() { return this.config.mode === "sandbox" && !!this.config.hostApiKey && !!this.config.hostLogoUrl && !!this.config.webhookBaseUrl && this.config.returnOrigins.length > 0; }
  private assertSandbox() { if (this.config.mode !== "sandbox") throw new ApiError(503, "FUNDING_UNAVAILABLE", "Demo checkout isn't configured yet.", { unavailableReason: "not_configured" }); }
  private row(id: string): SessionRow | undefined { return this.db.prepare("SELECT * FROM ramp_sessions WHERE id = ?").get(id) as SessionRow | undefined; }
  private expire(row: SessionRow): SessionRow {
    if (!row.provider_purchase_id && !terminal.has(row.status) && this.now() >= row.expires_at) {
      this.db.prepare("UPDATE ramp_sessions SET status='expired',updated_at=? WHERE id=?").run(new Date(this.now()).toISOString(), row.id);
      return this.row(row.id)!;
    }
    return row;
  }
  private view(row: SessionRow): FundingSession {
    const message = row.status === "completed" ? "Demo checkout completed. Your balance has not changed." : row.status === "failed" ? "The demo payment was returned. Your balance has not changed." : row.status === "cancelled" ? "Demo checkout cancelled. Your balance has not changed." : row.status === "expired" ? "Demo checkout expired. Start again when you're ready." : row.status === "processing" ? "Ramp is processing this demo checkout. It will not add money to your balance." : "Complete the demo checkout with Ramp. It will not add money to your balance.";
    return { id: row.id, environment: "sandbox", status: row.status, amount: row.amount, currency: "USD", createdAt: row.created_at, updatedAt: row.updated_at, message,
      ...(!terminal.has(row.status) && this.config.mode === "sandbox" ? { checkoutUrl: row.checkout_url } : {}), ...(row.fee ? { fee: row.fee } : {}) };
  }
}
