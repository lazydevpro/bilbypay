/**
 * Laso Finance gift cards, paid per order in USDC on Base via x402.
 *
 * API shapes come from the LasoFinance/docs GitHub repo (commit 58b14f2, 2026-09-25):
 * api-reference/openapi.json, guides/order-gift-card.mdx, guides/authentication.mdx, auth.md,
 * skills/laso-finance/references/gift-cards.md, llms-full.txt. laso.finance itself was not reachable
 * from the build container, so NOTHING here has been exercised against the live API yet. Run
 * scripts/laso-smoke.ts (spends ~$5.25) before relying on it. Things to check live are marked
 * "VERIFY".
 *
 * Flow:
 *   GET  /auth                     402 + SIWX challenge → sign → GET /auth with SIGN-IN-WITH-X → {auth:{id_token,...}}
 *   POST /auth                     {grant_type:"refresh_token", refresh_token} → new pair
 *   GET  /search-gift-cards        Bearer id_token → {gift_cards:[{laso_server_id,name,currency,country,min,max,increment,denominations,product_image_url,...}]}
 *   GET  /order-gift-card?amount=&laso_server_id=&country=
 *        no payment  → 402, body {}, PAYMENT-REQUIRED header = x402 v2 challenge (price = face + fee, USDC atomic)
 *        with payment→ 200 {gift_card:{card_id, redemption_code, pin_code, redemption_url, status:"completed"}}
 *                   → 402 {success:false, errorReason, errorMessage} if settlement failed (docs: nothing charged)
 *        404 {code:"unknown_laso_server_id"} before any payment; 400 bad params; 403 frozen account.
 *
 * Idempotency: Laso documents no idempotency key for /order-gift-card (Idempotency-Key only exists
 * on some POST routes) and has no "get gift card by id" endpoint. So we:
 *   1. sign ONE EIP-3009 authorization per idempotency key and persist it (store) BEFORE sending;
 *   2. on any retry, resend that same signed header while it's valid — USDC's authorization nonce
 *      means it can settle at most once, so resending can never pay twice;
 *   3. once it's expired, ask the chain (authorizationState) whether it settled: unused → safe to
 *      report failed; used-but-no-card → "pending" for a human to reconcile with Laso support.
 * Completed purchases (with codes) are kept in the store so getPurchase() can answer from it.
 */
import { type Address, createPublicClient, http, type LocalAccount } from "viem";
import { base } from "viem/chains";
import { eip3009Abi } from "@bilbypay/core";
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
  str,
  toUnits,
} from "./util";
import { BASE_NETWORK, BASE_USDC, createExactEvmPayment, parsePaymentRequired, parseSettlementResponse, selectRequirement } from "./x402";
import { createSiwxHeader, parseSiwxChallenge } from "./siwx";

export const LASO_BASE_URL = "https://laso.finance";
/**
 * Laso's Base payTo for /order-gift-card, from openapi.json `x-x402` (2026-09-25). We refuse to sign
 * a payment to any other address unless configured. VERIFY against the live 402 before first use.
 */
export const LASO_BASE_PAY_TO: Address = "0x3291e96b3bff7ed56e3ca8364273c5b4654b2b37";
/** Laso documents "up to 4.8%". Used for catalog estimates only; quote() reads the real price. */
export const LASO_FEE_PERCENT = 4.8;

type ReadClient = { readContract(args: any): Promise<unknown> };

export type LasoProviderOptions = {
  /** The Base float wallet. Signs SIWX logins and USDC payments. */
  account: LocalAccount;
  baseUrl?: string;
  fetch?: FetchLike;
  /** Persist purchase state across restarts. Defaults to in-memory (fine for tests, NOT production). */
  store?: IdempotencyStore;
  /** Base RPC (for float balance + checking whether an authorization settled). */
  rpcUrl?: string;
  /** Alternative to rpcUrl, e.g. a viem PublicClient or a test double. */
  publicClient?: ReadClient;
  /** Addresses we're willing to pay. Default [LASO_BASE_PAY_TO]; null disables the check. */
  allowedPayTo?: Address[] | null;
  /** Hard cap on price vs face value, percent. Default 6 (Laso documents ≤ 4.8%). */
  maxFeePercent?: number;
  catalogTtlMs?: number;
  /** Clock, ms. Injectable for tests. */
  now?: () => number;
};

type Token = { idToken: string; refreshToken?: string; expiresAt: number };

type SentRecord = {
  phase: "sent";
  url: string;
  headerName: string;
  headerValue: string;
  from: Address;
  nonce: `0x${string}`;
  validBefore: number;
  price: string;
};
type ReviewRecord = { phase: "review"; from: Address; nonce: `0x${string}`; price: string; reason: string };
type DoneRecord = { phase: "done"; purchase: GiftPurchase };
type PurchaseRecord = SentRecord | ReviewRecord | DoneRecord;

const PENDING_PREFIX = "pending:";

const REASONS = {
  unavailable: "This gift card isn't available right now.",
  badAmount: "That amount isn't available for this gift card.",
  priceChanged: "The price of this gift card just changed. Please try again.",
  paymentFailed: "We couldn't complete this gift card purchase right now.",
  timedOut: "The gift card provider didn't respond in time, so the purchase was cancelled.",
  review: "Your gift card is taking longer than usual. We're checking with the provider.",
};

export class LasoProvider implements GiftCardProvider {
  readonly name = "laso";
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly store: IdempotencyStore;
  private readonly client?: ReadClient;
  private readonly mutex = new KeyedMutex();
  private readonly now: () => number;
  private token?: Token;
  private readonly catalogCache = new Map<string, { at: number; brands: GiftBrand[] }>();

  constructor(private readonly options: LasoProviderOptions) {
    this.baseUrl = (options.baseUrl ?? LASO_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.store = options.store ?? new MemoryIdempotencyStore();
    this.client = options.publicClient ?? (options.rpcUrl ? createPublicClient({ chain: base, transport: http(options.rpcUrl) }) : undefined);
    this.now = options.now ?? Date.now;
  }

  get address(): Address {
    return this.options.account.address;
  }

  // ---------------------------------------------------------------- auth

  private async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new ProviderUnavailableError(this.name, `network error on ${path.split("?")[0]}: ${(err as Error).message}`);
    }
  }

  private setToken(auth: unknown) {
    if (!isRecord(auth) || typeof auth.id_token !== "string") throw new ProviderUnavailableError(this.name, "auth response had no id_token");
    const ttl = Number(auth.expires_in ?? 3600);
    this.token = {
      idToken: auth.id_token,
      refreshToken: str(auth.refresh_token) ?? this.token?.refreshToken,
      // Refresh 5 minutes early, as Laso's docs suggest.
      expiresAt: this.now() + (Number.isFinite(ttl) ? ttl : 3600) * 1000 - 5 * 60_000,
    };
  }

  private async signIn(): Promise<void> {
    const first = await this.request("/auth");
    const firstBody = await readJson(first);
    if (first.ok && isRecord(firstBody)) return this.setToken(firstBody.auth);
    if (first.status !== 402) throw new ProviderUnavailableError(this.name, `GET /auth → ${first.status}`, first.status);
    const challenge = parseSiwxChallenge(parsePaymentRequired(first, firstBody)?.extensions);
    if (!challenge) throw new ProviderUnavailableError(this.name, "GET /auth 402 carried no sign-in-with-x challenge");
    const header = await createSiwxHeader(challenge, this.options.account, BASE_NETWORK);
    const res = await this.request("/auth", { headers: { "SIGN-IN-WITH-X": header } });
    const body = await readJson(res);
    // A second 402 means the signature was rejected (docs: never resend the same payload).
    if (!res.ok || !isRecord(body)) throw new ProviderUnavailableError(this.name, `sign-in rejected (${res.status})`, res.status);
    this.setToken(body.auth);
  }

  private async refresh(): Promise<boolean> {
    if (!this.token?.refreshToken) return false;
    const res = await this.request("/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: this.token.refreshToken }),
    });
    const body = await readJson(res);
    if (!res.ok || !isRecord(body)) return false;
    this.setToken(body);
    return true;
  }

  private async idToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.idToken;
    if (!(await this.refresh().catch(() => false))) await this.signIn();
    return this.token!.idToken;
  }

  private async authedGet(path: string): Promise<{ res: Response; body: unknown }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.request(path, { headers: { authorization: `Bearer ${await this.idToken()}` } });
      const body = await readJson(res);
      if (res.status === 401 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      return { res, body };
    }
    throw new Error("unreachable");
  }

  // ---------------------------------------------------------------- catalog / quote

  async catalog(country: string): Promise<GiftBrand[]> {
    const cc = country.toUpperCase();
    const cached = this.catalogCache.get(cc);
    if (cached && this.now() - cached.at < (this.options.catalogTtlMs ?? 10 * 60_000)) return cached.brands;
    // Our amounts are USD, so we only list USD-denominated products. Non-USD cards would need an FX
    // rate we don't have (Laso converts; the 402 shows the USD price) — a later extension.
    const { res, body } = await this.authedGet(`/search-gift-cards?country=${encodeURIComponent(cc)}&currency=USD`);
    if (!res.ok || !isRecord(body) || !Array.isArray(body.gift_cards)) {
      throw new ProviderUnavailableError(this.name, `search-gift-cards → ${res.status} ${errorText(body) ?? ""}`, res.status);
    }
    const brands: GiftBrand[] = [];
    for (const p of body.gift_cards) {
      if (!isRecord(p) || typeof p.laso_server_id !== "string" || typeof p.name !== "string") continue;
      if (p.currency !== "USD") continue;
      // Country null = borderless product (openapi GiftCardProduct.country).
      if (p.country != null && String(p.country).toUpperCase() !== cc) continue;
      try {
        const denominations = Array.isArray(p.denominations) ? p.denominations.map((d) => toUnits(d as string)) : undefined;
        const min = toUnits(p.min as number);
        const max = toUnits(p.max as number);
        brands.push({
          id: lasoBrandId(p.laso_server_id, cc),
          name: p.name,
          logoUrl: str(p.product_image_url) ?? "",
          artworkUrl: str(p.product_image_url),
          country: cc,
          ...(str(p.category) ? { category: p.category as string } : {}),
          // Laso's order floor is $5 whatever the product says.
          minAmount: min < 5_000_000n ? 5_000_000n : min,
          maxAmount: max,
          ...(denominations?.length ? { denominations } : {}),
          feePercent: LASO_FEE_PERCENT,
        });
      } catch {
        // Malformed amounts: skip the product rather than fail the whole catalog.
      }
    }
    this.catalogCache.set(cc, { at: this.now(), brands });
    return brands;
  }

  /** Fetches the free 402 challenge for this order: that IS Laso's quote (face value + fee, in USDC). */
  async quote(brandId: string, amount: bigint): Promise<GiftQuote> {
    const { serverId, country } = parseLasoBrandId(brandId);
    const brand = (await this.catalog(country)).find((b) => b.id === brandId);
    if (brand) assertAmount(brand, amount);
    const outcome = await this.challenge(orderPath(serverId, country, amount));
    if (!outcome.ok) throw new Error(outcome.failed);
    const req = outcome.requirement;
    this.assertPayable(req.payTo, req.amount, amount);
    return {
      brandId,
      amount,
      price: req.amount,
      // The price is dynamic (FX + fee); treat it as good for about a minute.
      expiresAt: new Date(this.now() + Math.min(60, req.maxTimeoutSeconds) * 1000),
    };
  }

  private async challenge(path: string) {
    const res = await this.request(path);
    const body = await readJson(res);
    if (res.status === 402) {
      const pr = parsePaymentRequired(res, body);
      const requirement = pr && selectRequirement(pr, { network: BASE_NETWORK, asset: BASE_USDC });
      if (!pr || !requirement) return { ok: false, failed: REASONS.paymentFailed, detail: "no USDC-on-Base option in 402" } as const;
      return { ok: true, requirement, pr } as const;
    }
    if (res.status === 404) return { ok: false, failed: REASONS.unavailable, detail: errorText(body) } as const;
    if (res.status === 400) return { ok: false, failed: REASONS.badAmount, detail: errorText(body) } as const;
    if (res.status === 403) return { ok: false, failed: REASONS.unavailable, detail: "account frozen" } as const;
    throw new ProviderUnavailableError(this.name, `order challenge → ${res.status} ${errorText(body) ?? ""}`, res.status);
  }

  private assertPayable(payTo: Address, price: bigint, faceValue: bigint) {
    const allowed = this.options.allowedPayTo === undefined ? [LASO_BASE_PAY_TO] : this.options.allowedPayTo;
    if (allowed && !allowed.some((a) => a.toLowerCase() === payTo.toLowerCase())) {
      throw new Error(`Refusing to pay unexpected address ${payTo}`);
    }
    const cap = addPercent(faceValue, this.options.maxFeePercent ?? 6);
    if (price > cap) throw new Error(`Price ${fromUnits(price)} exceeds cap ${fromUnits(cap)} for face value ${fromUnits(faceValue)}`);
  }

  // ---------------------------------------------------------------- purchase

  async purchase(input: { brandId: string; amount: bigint; idempotencyKey: string; quote?: GiftQuote }): Promise<GiftPurchase> {
    return this.mutex.run(input.idempotencyKey, async () => {
      const existing = (await this.store.get(recordKey(input.idempotencyKey))) as PurchaseRecord | undefined;
      if (existing) return this.resume(input.idempotencyKey, existing);

      const { serverId, country } = parseLasoBrandId(input.brandId);
      const url = orderPath(serverId, country, input.amount);
      const pendingId = `${PENDING_PREFIX}${input.idempotencyKey}`;
      const fail = (failureReason: string) => this.finish(input.idempotencyKey, { providerOrderId: pendingId, status: "failed", failureReason });

      const outcome = await this.challenge(url);
      if (!outcome.ok) return fail(outcome.failed);
      const { requirement: req, pr } = outcome;
      try {
        this.assertPayable(req.payTo, req.amount, input.amount);
      } catch {
        return fail(REASONS.paymentFailed);
      }
      if (input.quote && req.amount > input.quote.price) return fail(REASONS.priceChanged);

      const payment = await createExactEvmPayment({
        account: this.options.account,
        requirement: req,
        x402Version: pr.x402Version,
        resource: pr.resource,
        now: Math.floor(this.now() / 1000),
      });
      const sent: SentRecord = {
        phase: "sent",
        url,
        headerName: payment.headerName,
        headerValue: payment.headerValue,
        from: payment.authorization.from,
        nonce: payment.authorization.nonce,
        validBefore: Number(payment.authorization.validBefore),
        price: req.amount.toString(),
      };
      // Persist BEFORE sending: from here on, the only way to pay is this exact authorization.
      await this.store.set(recordKey(input.idempotencyKey), sent);
      return this.send(input.idempotencyKey, sent);
    });
  }

  private async finish(key: string, purchase: GiftPurchase): Promise<GiftPurchase> {
    await this.store.set(recordKey(key), { phase: "done", purchase } satisfies DoneRecord);
    if (purchase.status === "completed") await this.store.set(orderKey(purchase.providerOrderId), purchase);
    return purchase;
  }

  private async review(key: string, rec: SentRecord | ReviewRecord, reason: string): Promise<GiftPurchase> {
    const r: ReviewRecord = { phase: "review", from: rec.from, nonce: rec.nonce, price: rec.price, reason };
    await this.store.set(recordKey(key), r);
    return { providerOrderId: `${PENDING_PREFIX}${key}`, status: "pending", failureReason: REASONS.review };
  }

  private pending(key: string): GiftPurchase {
    return { providerOrderId: `${PENDING_PREFIX}${key}`, status: "pending", failureReason: REASONS.review };
  }

  /** Sends (or re-sends) the persisted payment. Never signs anything new. */
  private async send(key: string, rec: SentRecord): Promise<GiftPurchase> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${rec.url}`, { headers: { [rec.headerName]: rec.headerValue } });
    } catch {
      return this.pending(key); // Unknown whether it settled; resume() will resend the same header.
    }
    const body = await readJson(res);

    if (res.ok) {
      const gc = isRecord(body) && isRecord(body.gift_card) ? body.gift_card : undefined;
      const redemption = gc && toRedemption(gc);
      if (gc && typeof gc.card_id === "string" && redemption && (gc.status === undefined || gc.status === "completed")) {
        return this.finish(key, { providerOrderId: gc.card_id, status: "completed", redemption });
      }
      // Paid (200) but no usable card in the body. VERIFY: whether Laso ever returns this.
      return this.review(key, rec, `200 without redemption details (status ${String(gc?.status)})`);
    }

    if (res.status === 429 || res.status >= 500) return this.pending(key);

    // Definitive refusal (402 settlement failure, 402 re-challenge, 400/403/404). Laso says nothing is
    // charged on these, but a RESEND of an already-settled authorization also lands here — so if we
    // can, check the chain before calling it failed.
    const used = await this.authorizationUsed(rec.from, rec.nonce);
    if (used === true) {
      const s = parseSettlementResponse(res, body);
      return this.review(key, rec, `authorization settled but order refused (${res.status} ${s?.errorReason ?? errorText(body) ?? ""})`);
    }
    const reason = res.status === 404 ? REASONS.unavailable : res.status === 400 ? REASONS.badAmount : REASONS.paymentFailed;
    return this.finish(key, { providerOrderId: `${PENDING_PREFIX}${key}`, status: "failed", failureReason: reason });
  }

  private async resume(key: string, rec: PurchaseRecord): Promise<GiftPurchase> {
    if (rec.phase === "done") return rec.purchase;
    if (rec.phase === "review") return this.pending(key);
    const nowSec = Math.floor(this.now() / 1000);
    if (nowSec < rec.validBefore - 5) return this.send(key, rec);
    // Expired: it can never settle from now on, so the chain gives a final answer.
    const used = await this.authorizationUsed(rec.from, rec.nonce);
    if (used === false) {
      return this.finish(key, { providerOrderId: `${PENDING_PREFIX}${key}`, status: "failed", failureReason: REASONS.timedOut });
    }
    if (used === true) return this.review(key, rec, "authorization settled but no card received");
    return this.pending(key); // No RPC configured: can't tell. Configure BASE_RPC_URL.
  }

  private async authorizationUsed(from: Address, nonce: `0x${string}`): Promise<boolean | undefined> {
    if (!this.client) return undefined;
    try {
      return (await this.client.readContract({
        address: BASE_USDC,
        abi: eip3009Abi,
        functionName: "authorizationState",
        args: [from, nonce],
      })) as boolean;
    } catch {
      return undefined;
    }
  }

  async getPurchase(providerOrderId: string): Promise<GiftPurchase> {
    if (providerOrderId.startsWith(PENDING_PREFIX)) {
      const key = providerOrderId.slice(PENDING_PREFIX.length);
      return this.mutex.run(key, async () => {
        const rec = (await this.store.get(recordKey(key))) as PurchaseRecord | undefined;
        if (!rec) throw new Error(`Unknown Laso purchase ${providerOrderId}`);
        return this.resume(key, rec);
      });
    }
    // Laso has no "get gift card" endpoint (VERIFY), so completed cards are served from our store.
    const stored = (await this.store.get(orderKey(providerOrderId))) as GiftPurchase | undefined;
    if (!stored) throw new Error(`Unknown Laso order ${providerOrderId}`);
    return stored;
  }

  async floatAvailable(): Promise<bigint> {
    if (!this.client) throw new Error("LasoProvider needs rpcUrl (BASE_RPC_URL) or publicClient to read the float");
    return (await this.client.readContract({
      address: BASE_USDC,
      abi: eip3009Abi,
      functionName: "balanceOf",
      args: [this.options.account.address],
    })) as bigint;
  }
}

// ------------------------------------------------------------------ helpers

/** Laso ids aren't country-suffixed (Amazon is "amazon" everywhere), so ours carry the country. */
export function lasoBrandId(serverId: string, country: string): string {
  return `${serverId}:${country.toUpperCase()}`;
}

export function parseLasoBrandId(brandId: string): { serverId: string; country: string } {
  const i = brandId.lastIndexOf(":");
  if (i <= 0) return { serverId: brandId, country: "US" };
  return { serverId: brandId.slice(0, i), country: brandId.slice(i + 1).toUpperCase() };
}

function orderPath(serverId: string, country: string, amount: bigint): string {
  const q = new URLSearchParams({ amount: fromUnits(amount), laso_server_id: serverId, country });
  return `/order-gift-card?${q}`;
}

function recordKey(key: string) {
  return `laso:purchase:${key}`;
}
function orderKey(id: string) {
  return `laso:order:${id}`;
}

function toRedemption(gc: Record<string, unknown>): GiftRedemption | undefined {
  const r: GiftRedemption = {};
  const code = str(gc.redemption_code);
  const pin = str(gc.pin_code);
  const url = str(gc.redemption_url);
  if (code) r.code = code;
  if (pin) r.pin = pin;
  if (url) r.url = url;
  // Laso returns no barcode field (research notes / openapi GiftCardOrder).
  return code || url ? r : undefined;
}

function assertAmount(brand: GiftBrand, amount: bigint) {
  if (amount < brand.minAmount || amount > brand.maxAmount) {
    throw new Error(`${brand.name} cards are between ${fromUnits(brand.minAmount)} and ${fromUnits(brand.maxAmount)} USD`);
  }
  if (brand.denominations && !brand.denominations.includes(amount)) throw new Error(`${brand.name} cards come in fixed amounts only`);
  if (amount % 10_000n !== 0n) throw new Error("Amount must be whole cents");
}

