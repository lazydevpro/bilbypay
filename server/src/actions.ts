import {
  type Authorization,
  authorizationTypedData,
  bilbyEscrowAbi,
  bilbyRouterAbi,
  cancelTypedData,
  DepositKind,
  eip3009Abi,
  type EscrowTerms,
  escrowDepositId,
  escrowTermsNonce,
  formatUsd,
  hydrateTypedData,
  newAuthorization,
  permitTypedData,
  type RouterPermit,
  serializeTypedData,
  setAutoSaveTypedData,
  toSignedAuthorization,
  type TypedDataJson,
  ZERO_BYTES32,
} from "@bilbypay/core";
import { type Address, encodeFunctionData, type Hex, isHex, maxUint256, parseSignature, recoverTypedDataAddress } from "viem";
import type { AccountService } from "./accounts";
import { type ActivityRepo, claimLink } from "./activity";
import type { ChainService } from "./chain";
import type { ClaimService } from "./claims";
import type { Config } from "./config";
import type { Db } from "./db";
import { ApiError, errors, humanizeRevert } from "./errors";
import type { GiftCardService } from "./giftcards/service";
import type { GiftBrand, GiftQuote } from "./giftcards/types";
import type { Keeper } from "./keeper";
import { maskPhone, normalizePhone, regionOf } from "./phone";
import type { Sent, TxSender } from "./relayer";
import type { Treasury } from "./treasury";
import type { ActionResult, ActionType, PreparedAction } from "./types";
import { fromJson, isoFromUnix, KeyedMutex, newClaimCode, newId, randomBytes32, toJson } from "./util";

/** Server-private details of a prepared action, needed to submit it. */
type Funding = { shortfall: bigint; permit?: { value: bigint; deadline: bigint } };

type State =
  | {
      type: "send";
      amount: bigint;
      note?: string;
      funding: Funding;
      auth: Authorization;
      recipient:
        | { kind: "registered"; address: Address; name: string; phoneMasked: string }
        | { kind: "invite"; phoneMasked: string; terms: EscrowTerms };
    }
  | {
      type: "gift_send";
      amount: bigint;
      faceValue: bigint;
      funding: Funding;
      auth: Authorization;
      terms: EscrowTerms;
      phoneMasked: string;
      gift: { brandId: string | null; brandName?: string; brandLogoUrl?: string; design?: string; message?: string };
    }
  | { type: "gift_buy"; price: bigint; faceValue: bigint; funding: Funding; auth: Authorization; brandId: string; giftId: Hex; quote: GiftQuote }
  | { type: "cancel"; activityId: string; claimCode: string; depositId: Hex; deadline: bigint; amount: bigint }
  | { type: "burrow_autosave"; enabled: boolean; threshold: bigint; deadline: bigint; permitValue: bigint }
  | { type: "burrow_add"; amount: bigint; auth: Authorization }
  | { type: "burrow_withdraw"; amount: bigint; permit: { value: bigint; deadline: bigint } };

type ActionRow = {
  id: string;
  address: string;
  type: ActionType;
  status: "prepared" | "submitting" | "completed" | "waiting" | "failed";
  prepared: string;
  state: string;
  result: string | null;
  tx_hash: string | null;
  expires_at: number;
};

type Draft = {
  state: State;
  summary: PreparedAction["summary"];
  toSign: PreparedAction["toSign"];
  expect: PreparedAction["expect"];
};

type Sigs = Record<string, Hex>;

const bps = (x: bigint, n: bigint) => (x * n) / 10_000n;

export type ActionDeps = {
  db: Db;
  config: Config;
  chain: ChainService;
  relayer: TxSender;
  accounts: AccountService;
  activity: ActivityRepo;
  claims: ClaimService;
  gifts: GiftCardService;
  treasury: Treasury;
  keeper: Keeper;
  userLocks: KeyedMutex;
};

/**
 * Every money movement is prepare → sign (one Face ID) → submit. Prepare does all the checks
 * that could fail (balance, Burrow liquidity, gift availability) so nothing fails after Face ID;
 * submit is idempotent per action id.
 */
export class ActionService {
  private inflight = new Map<string, Promise<ActionResult>>();

  constructor(private readonly x: ActionDeps) {}

  private get cfg() {
    return this.x.config;
  }

  // ------------------------------------------------------------------ prepare

  async prepare(user: Address, type: ActionType, params: Record<string, unknown>): Promise<PreparedAction> {
    const me = this.x.accounts.requireRegistered(user);
    // Same lock as the keeper's sweep, so a sweep can't move money between our balance read and the insert.
    return this.x.userLocks.run(user, async () => {
      const now = BigInt(await this.x.chain.now());
      const deadline = now + BigInt(this.cfg.actionTtlSeconds);
      const ctx = { user, me, now, deadline };
      let draft: Draft;
      switch (type) {
        case "send":
          draft = await this.prepareSend(ctx, params);
          break;
        case "gift_send":
          draft = await this.prepareGiftSend(ctx, params);
          break;
        case "gift_buy":
          draft = await this.prepareGiftBuy(ctx, params);
          break;
        case "cancel":
          draft = await this.prepareCancel(ctx, params);
          break;
        case "burrow_autosave":
          draft = await this.prepareAutoSave(ctx, params);
          break;
        case "burrow_add":
          draft = await this.prepareBurrowAdd(ctx, params);
          break;
        case "burrow_withdraw":
          draft = await this.prepareBurrowWithdraw(ctx, params);
          break;
        default:
          throw errors.invalidRequest();
      }
      const id = newId("pa");
      const expiresAtMs = Date.now() + this.cfg.actionTtlSeconds * 1000;
      const prepared: PreparedAction = {
        id,
        type,
        expiresAt: new Date(expiresAtMs).toISOString(),
        summary: draft.summary,
        toSign: draft.toSign,
        expect: draft.expect,
      };
      this.x.db
        .prepare(
          "INSERT INTO actions (id, address, type, status, prepared, state, created_at, expires_at) VALUES (?, ?, ?, 'prepared', ?, ?, ?, ?)",
        )
        .run(id, user, type, JSON.stringify(prepared), toJson(draft.state), new Date().toISOString(), expiresAtMs);
      return prepared;
    });
  }

  private amountParam(params: Record<string, unknown>, key = "amount"): bigint {
    const raw = params[key];
    if (typeof raw !== "string" || !/^\d{1,30}$/.test(raw)) throw errors.invalidRequest("Enter an amount.");
    const amount = BigInt(raw);
    if (amount <= 0n) throw errors.invalidRequest("Enter an amount more than $0.");
    if (amount >= 2n ** 96n) throw errors.invalidRequest("That amount is too large.");
    return amount;
  }

  private optString(params: Record<string, unknown>, key: string, max: number): string | undefined {
    const v = params[key];
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || v.length > max) throw errors.invalidRequest(`That ${key} is too long.`);
    return v;
  }

  /**
   * Decides how a payment of `total` is funded. If the balance is short, it plans taking the
   * shortfall out of Burrow inside the same payment — or refuses now, before Face ID.
   */
  private async fund(user: Address, total: bigint, deadline: bigint): Promise<{ funding: Funding; toSign: Draft["toSign"]; balance: bigint }> {
    const [balance, burrow] = await Promise.all([this.x.chain.ausdBalance(user), this.x.chain.burrow(user)]);
    if (balance >= total) return { funding: { shortfall: 0n }, toSign: [], balance };
    const shortfall = total - balance;
    if (burrow.assets < shortfall) throw errors.insufficientFunds();
    if (burrow.maxWithdraw < shortfall) {
      const availableNow = balance + burrow.maxWithdraw;
      throw errors.burrowBusy(availableNow, `Some of your Burrow money is busy right now. You can pay up to ${formatUsd(availableNow)} now.`);
    }
    const permit = await this.burrowPermit(user, shortfall, deadline);
    return { funding: { shortfall, permit: permit.permit }, toSign: [permit.entry], balance };
  }

  /** stataAUSD permit to the router, sized previewWithdraw(assets) + 0.1% headroom for rounding/accrual. */
  private async burrowPermit(user: Address, assets: bigint, deadline: bigint) {
    const [shares, nonce] = await Promise.all([this.x.chain.previewWithdraw(assets), this.x.chain.stataNonce(user)]);
    const value = shares + bps(shares, 10n) + 1n;
    const typed = permitTypedData(this.cfg.stata, this.cfg.chainId, { owner: user, spender: this.cfg.deployment.router, value, nonce, deadline });
    return { permit: { value, deadline }, entry: { key: "burrowPermit", typedData: serializeTypedData(typed) } };
  }

  private fundingLines(funding: Funding, total: bigint) {
    if (funding.shortfall === 0n) return [];
    return [
      { label: "From balance", value: formatUsd(total - funding.shortfall) },
      { label: "From Burrow", value: formatUsd(funding.shortfall) },
    ];
  }

  private authEntry(kind: "TransferWithAuthorization" | "ReceiveWithAuthorization", auth: Authorization) {
    return { key: "payment", typedData: serializeTypedData(authorizationTypedData(kind, this.cfg.ausd, this.cfg.chainId, auth)) };
  }

  private recipientPhone(me: { phone_e164: string }, params: Record<string, unknown>) {
    const raw = params.phone;
    if (typeof raw !== "string") throw errors.phoneInvalid();
    const parsed = normalizePhone(raw, regionOf(me.phone_e164));
    if (!parsed) throw errors.phoneInvalid();
    if (parsed.e164 === me.phone_e164) throw errors.invalidRequest("That's your own number. Pick someone else.");
    return parsed.e164;
  }

  private escrowTerms(phoneKey: Hex, now: bigint, kind: DepositKind, giftId: Hex): EscrowTerms {
    return { phoneKey, expiry: Number(now) + this.cfg.escrowExpiryDays * 86_400, kind, giftId, salt: randomBytes32() };
  }

  private async prepareSend(ctx: Ctx, params: Record<string, unknown>): Promise<Draft> {
    const amount = this.amountParam(params);
    const note = this.optString(params, "note", 140);
    const e164 = this.recipientPhone(ctx.me, params);
    const key = this.x.accounts.phoneKeyOf(e164);
    const phoneMasked = maskPhone(e164);
    // The directory is the source of truth for where money goes; our DB only supplies the name.
    const { account } = await this.x.chain.resolve(key);
    const { funding, toSign } = await this.fund(ctx.user, amount, ctx.deadline);
    const warnings: Draft["summary"]["warnings"] = [];

    if (account && account !== ctx.user) {
      const name = this.x.accounts.get(account)?.display_name ?? phoneMasked;
      if (this.x.accounts.recentlyChanged(this.x.accounts.binding(key))) {
        warnings.push({
          code: "RECIPIENT_RECENTLY_CHANGED",
          message: `This number moved to a new account recently. Make sure it's still ${name} before you send.`,
        });
      }
      const auth = newAuthorization({ from: ctx.user, to: account, value: amount, ttlSeconds: this.cfg.actionTtlSeconds, now: Number(ctx.now) });
      return {
        state: { type: "send", amount, note, funding, auth, recipient: { kind: "registered", address: account, name, phoneMasked } },
        summary: {
          title: `Send ${formatUsd(amount)} to ${name}`,
          lines: [{ label: "To", value: name }, { label: "Amount", value: formatUsd(amount) }, ...this.fundingLines(funding, amount), ...(note ? [{ label: "Note", value: note }] : [])],
          total: amount.toString(),
          fromBurrow: funding.shortfall.toString(),
          warnings,
        },
        toSign: [this.authEntry("TransferWithAuthorization", auth), ...toSign],
        expect: { payer: ctx.user, amount: amount.toString(), payee: account },
      };
    }
    if (account === ctx.user) throw errors.invalidRequest("That number is linked to your own account.");

    const terms = this.escrowTerms(key, ctx.now, DepositKind.TRANSFER, ZERO_BYTES32);
    const auth = this.escrowAuth(ctx, amount, terms);
    return {
      state: { type: "send", amount, note, funding, auth, recipient: { kind: "invite", phoneMasked, terms } },
      summary: {
        title: `Send ${formatUsd(amount)} to ${phoneMasked}`,
        lines: [
          { label: "To", value: phoneMasked },
          { label: "Amount", value: formatUsd(amount) },
          ...this.fundingLines(funding, amount),
          ...(note ? [{ label: "Note", value: note }] : []),
          { label: "If not opened", value: `Comes back to you on ${shortDate(terms.expiry)}` },
        ],
        total: amount.toString(),
        fromBurrow: funding.shortfall.toString(),
        warnings,
      },
      toSign: [this.authEntry("ReceiveWithAuthorization", auth), ...toSign],
      expect: { payer: ctx.user, amount: amount.toString() },
    };
  }

  /** ReceiveWithAuthorization to the escrow whose nonce commits to the deposit terms. */
  private escrowAuth(ctx: Ctx, amount: bigint, terms: EscrowTerms): Authorization {
    const base = newAuthorization({ from: ctx.user, to: this.cfg.deployment.escrow, value: amount, ttlSeconds: this.cfg.actionTtlSeconds, now: Number(ctx.now) });
    return { ...base, nonce: escrowTermsNonce(terms) };
  }

  private async prepareGiftSend(ctx: Ctx, params: Record<string, unknown>): Promise<Draft> {
    const faceValue = this.amountParam(params);
    const message = this.optString(params, "message", 280);
    const design = this.optString(params, "design", 40);
    const brandId = this.optString(params, "brandId", 80) ?? null;
    const e164 = this.recipientPhone(ctx.me, params);
    const key = this.x.accounts.phoneKeyOf(e164);
    const phoneMasked = maskPhone(e164);

    let brand: GiftBrand | undefined;
    let price: bigint;
    if (brandId) {
      const checked = await this.x.gifts.checkAvailable(brandId, faceValue);
      brand = checked.brand;
      price = checked.quote.price;
    } else {
      // Recipient's choice: cover the priciest fee in the catalog; anything left over goes to them.
      const brands = await this.x.gifts.brands(regionOf(e164) ?? "US");
      if (!brands.length) throw errors.giftUnavailable("Gift cards aren't available for that number's country yet.");
      const maxFee = Math.max(...brands.map((b) => b.feePercent));
      price = faceValue + (faceValue * BigInt(Math.round(maxFee * 100)) + 9_999n) / 10_000n;
    }
    const { funding, toSign } = await this.fund(ctx.user, price, ctx.deadline);
    const terms = this.escrowTerms(key, ctx.now, DepositKind.GIFT, randomBytes32());
    const auth = this.escrowAuth(ctx, price, terms);
    const what = brand ? `${formatUsd(faceValue)} ${brand.name} gift card` : `${formatUsd(faceValue)} gift card`;
    return {
      state: {
        type: "gift_send",
        amount: price,
        faceValue,
        funding,
        auth,
        terms,
        phoneMasked,
        gift: { brandId, brandName: brand?.name, brandLogoUrl: brand?.logoUrl, design, message },
      },
      summary: {
        title: `Send a ${what} to ${phoneMasked}`,
        lines: [
          { label: "To", value: phoneMasked },
          { label: "Gift card", value: brand ? brand.name : "Their choice" },
          { label: "Card value", value: formatUsd(faceValue) },
          ...(price !== faceValue ? [{ label: "Price", value: formatUsd(price) }] : []),
          ...this.fundingLines(funding, price),
          { label: "If not opened", value: `Comes back to you on ${shortDate(terms.expiry)}` },
        ],
        total: price.toString(),
        fromBurrow: funding.shortfall.toString(),
        warnings: [],
      },
      toSign: [this.authEntry("ReceiveWithAuthorization", auth), ...toSign],
      expect: { payer: ctx.user, amount: price.toString() },
    };
  }

  private async prepareGiftBuy(ctx: Ctx, params: Record<string, unknown>): Promise<Draft> {
    const faceValue = this.amountParam(params);
    const brandId = this.optString(params, "brandId", 80);
    if (!brandId) throw errors.invalidRequest("Pick a gift card first.");
    const { brand, quote } = await this.x.gifts.checkAvailable(brandId, faceValue);
    const price = quote.price;
    const { funding, toSign } = await this.fund(ctx.user, price, ctx.deadline);
    const auth = newAuthorization({ from: ctx.user, to: this.x.treasury.address, value: price, ttlSeconds: this.cfg.actionTtlSeconds, now: Number(ctx.now) });
    return {
      state: { type: "gift_buy", price, faceValue, funding, auth, brandId, giftId: randomBytes32(), quote },
      summary: {
        title: `Buy a ${formatUsd(faceValue)} ${brand.name} gift card`,
        lines: [
          { label: "Gift card", value: brand.name },
          { label: "Card value", value: formatUsd(faceValue) },
          { label: "Price", value: formatUsd(price) },
          ...this.fundingLines(funding, price),
        ],
        total: price.toString(),
        fromBurrow: funding.shortfall.toString(),
        warnings: [],
      },
      toSign: [this.authEntry("TransferWithAuthorization", auth), ...toSign],
      expect: { payer: ctx.user, amount: price.toString(), payee: this.x.treasury.address },
    };
  }

  private async prepareCancel(ctx: Ctx, params: Record<string, unknown>): Promise<Draft> {
    const activityId = this.optString(params, "activityId", 64);
    const row = activityId ? this.x.activity.getRow(activityId) : undefined;
    if (!row || row.address !== ctx.user || !row.claim_code) throw errors.notFound();
    const claim = this.x.claims.get(row.claim_code);
    if (!claim || claim.status !== "waiting" || row.status !== "waiting") {
      throw new ApiError(409, "ALREADY_CLAIMED", "This can't be taken back anymore. It was already opened or returned.");
    }
    const deposit = await this.x.chain.deposit(claim.deposit_id as Hex);
    if (deposit.statusName !== "Pending") throw new ApiError(409, "ALREADY_CLAIMED", "This can't be taken back anymore. It was already opened or returned.");
    const amount = BigInt(claim.amount);
    const typed = cancelTypedData(this.cfg.deployment, { depositId: claim.deposit_id as Hex, deadline: ctx.deadline });
    return {
      state: { type: "cancel", activityId: row.id, claimCode: claim.code, depositId: claim.deposit_id as Hex, deadline: ctx.deadline, amount },
      summary: {
        title: `Take back ${formatUsd(amount)}`,
        lines: [
          { label: "Sent to", value: claim.phone_masked },
          { label: "Back to your balance", value: formatUsd(amount) },
        ],
        total: "0",
        fromBurrow: "0",
        warnings: [],
      },
      toSign: [{ key: "cancel", typedData: serializeTypedData(typed) }],
      expect: { payer: ctx.user, amount: amount.toString() },
    };
  }

  private async prepareAutoSave(ctx: Ctx, params: Record<string, unknown>): Promise<Draft> {
    if (typeof params.enabled !== "boolean") throw errors.invalidRequest();
    const enabled = params.enabled;
    const threshold = enabled ? this.thresholdParam(params.threshold) : 0n;
    const [routerNonce, ausdNonce] = await Promise.all([this.x.chain.routerNonce(ctx.user), this.x.chain.ausdNonce(ctx.user)]);
    const permitValue = enabled ? maxUint256 : 0n;
    const autoSave = setAutoSaveTypedData(this.cfg.deployment, { user: ctx.user, enabled, threshold, nonce: routerNonce, deadline: ctx.deadline });
    const permit = permitTypedData(this.cfg.ausd, this.cfg.chainId, {
      owner: ctx.user,
      spender: this.cfg.deployment.router,
      value: permitValue,
      nonce: ausdNonce,
      deadline: ctx.deadline,
    });
    return {
      state: { type: "burrow_autosave", enabled, threshold, deadline: ctx.deadline, permitValue },
      summary: enabled
        ? {
            title: `Keep ${formatUsd(threshold)} in your balance`,
            lines: [{ label: `Above ${formatUsd(threshold)}`, value: "Moves into Burrow automatically" }],
            total: "0",
            fromBurrow: "0",
            warnings: [],
          }
        : { title: "Turn off auto-save", lines: [{ label: "Burrow", value: "Stays as it is. Move it any time." }], total: "0", fromBurrow: "0", warnings: [] },
      toSign: [
        { key: "autoSave", typedData: serializeTypedData(autoSave) },
        { key: "ausdPermit", typedData: serializeTypedData(permit) },
      ],
      expect: { payer: ctx.user, amount: "0" },
    };
  }

  private thresholdParam(raw: unknown): bigint {
    if (typeof raw !== "string" || !/^\d{1,30}$/.test(raw)) throw errors.invalidRequest("Enter how much to keep in your balance.");
    const t = BigInt(raw);
    if (t >= 2n ** 128n) throw errors.invalidRequest("That amount is too large.");
    return t;
  }

  private async prepareBurrowAdd(ctx: Ctx, params: Record<string, unknown>): Promise<Draft> {
    const amount = this.amountParam(params);
    const balance = await this.x.chain.ausdBalance(ctx.user);
    if (balance < amount) throw errors.insufficientFunds();
    const auth = newAuthorization({ from: ctx.user, to: this.cfg.deployment.router, value: amount, ttlSeconds: this.cfg.actionTtlSeconds, now: Number(ctx.now) });
    return {
      state: { type: "burrow_add", amount, auth },
      summary: { title: `Add ${formatUsd(amount)} to Burrow`, lines: [{ label: "From balance", value: formatUsd(amount) }], total: amount.toString(), fromBurrow: "0", warnings: [] },
      toSign: [this.authEntry("ReceiveWithAuthorization", auth)],
      expect: { payer: ctx.user, amount: amount.toString() },
    };
  }

  private async prepareBurrowWithdraw(ctx: Ctx, params: Record<string, unknown>): Promise<Draft> {
    const amount = this.amountParam(params);
    const burrow = await this.x.chain.burrow(ctx.user);
    if (burrow.assets < amount) throw errors.invalidRequest(`You have ${formatUsd(burrow.assets)} in Burrow. Try that amount or less.`);
    if (burrow.maxWithdraw < amount) {
      throw errors.burrowBusy(burrow.maxWithdraw, `Some of your Burrow money is busy right now. You can move up to ${formatUsd(burrow.maxWithdraw)} now.`);
    }
    const { permit, entry } = await this.burrowPermit(ctx.user, amount, ctx.deadline);
    return {
      state: { type: "burrow_withdraw", amount, permit },
      summary: { title: `Move ${formatUsd(amount)} to your balance`, lines: [{ label: "From Burrow", value: formatUsd(amount) }], total: amount.toString(), fromBurrow: amount.toString(), warnings: [] },
      toSign: [entry],
      expect: { payer: ctx.user, amount: amount.toString() },
    };
  }

  // ------------------------------------------------------------------- submit

  private row(id: string): ActionRow | undefined {
    return this.x.db.prepare("SELECT * FROM actions WHERE id = ?").get(id) as ActionRow | undefined;
  }

  /** Users with a prepared (unexpired) or in-flight action — the keeper won't sweep them. */
  hasOpenAction(user: Address): boolean {
    const r = this.x.db
      .prepare("SELECT 1 FROM actions WHERE address = ? AND ((status = 'prepared' AND expires_at > ?) OR status = 'submitting') LIMIT 1")
      .get(user, Date.now());
    return !!r;
  }

  async submit(user: Address, id: string, signatures: Record<string, unknown>): Promise<ActionResult> {
    const row = this.row(id);
    if (!row || row.address !== user) throw errors.notFound();
    if (row.result) return JSON.parse(row.result) as ActionResult;
    const running = this.inflight.get(id);
    if (running) return running;
    if (row.status !== "prepared") throw errors.internal();
    if (row.expires_at < Date.now()) throw errors.actionExpired();

    const prepared = JSON.parse(row.prepared) as PreparedAction;
    const sigs = await this.checkSignatures(user, prepared.toSign, signatures);
    // Claim the action; a concurrent submit of the same id awaits this one's result.
    const claimed = this.x.db.prepare("UPDATE actions SET status = 'submitting', submitted_at = ? WHERE id = ? AND status = 'prepared'").run(new Date().toISOString(), id);
    if (claimed.changes !== 1) {
      const again = this.inflight.get(id);
      if (again) return again;
      const r = this.row(id);
      if (r?.result) return JSON.parse(r.result) as ActionResult;
      throw errors.internal();
    }
    const promise = this.x.userLocks
      .run(user, () => this.execute(user, id, fromJson<State>(row.state), sigs))
      .then(
        (result) => this.finish(id, result),
        (err) => {
          const e = humanizeRevert(err);
          if (e.code === "INTERNAL") console.error(`action ${id} failed`, err instanceof Error ? err.message : err);
          return this.finish(id, { id, status: "failed", error: { code: e.code, message: e.message } });
        },
      )
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, promise);
    return promise;
  }

  private finish(id: string, result: ActionResult): ActionResult {
    this.x.db.prepare("UPDATE actions SET status = ?, result = ? WHERE id = ?").run(result.status, JSON.stringify(result), id);
    return result;
  }

  private async checkSignatures(user: Address, toSign: PreparedAction["toSign"], signatures: Record<string, unknown>): Promise<Sigs> {
    const out: Sigs = {};
    for (const { key, typedData } of toSign) {
      const sig = signatures[key];
      if (typeof sig !== "string" || !isHex(sig)) throw errors.badSignature();
      let signer: Address;
      try {
        signer = await recoverTypedDataAddress({ ...hydrateTypedData(typedData as TypedDataJson), signature: sig } as Parameters<typeof recoverTypedDataAddress>[0]);
      } catch {
        throw errors.badSignature();
      }
      if (signer !== user) throw errors.badSignature();
      out[key] = sig;
    }
    return out;
  }

  private async execute(user: Address, id: string, state: State, sigs: Sigs): Promise<ActionResult> {
    const onSent = (hash: Hex) => this.x.db.prepare("UPDATE actions SET tx_hash = ? WHERE id = ?").run(hash, id);
    switch (state.type) {
      case "send":
        return this.submitSend(user, id, state, sigs, onSent);
      case "gift_send":
        return this.submitGiftSend(user, id, state, sigs, onSent);
      case "gift_buy":
        return this.submitGiftBuy(user, id, state, sigs, onSent);
      case "cancel":
        return this.submitCancel(user, id, state, sigs, onSent);
      case "burrow_autosave":
        return this.submitAutoSave(user, id, state, sigs, onSent);
      case "burrow_add":
        return this.submitBurrowAdd(user, id, state, sigs, onSent);
      case "burrow_withdraw":
        return this.submitBurrowWithdraw(user, id, state, sigs, onSent);
    }
  }

  private transferCall(auth: Authorization, sig: Hex): Hex {
    const s = toSignedAuthorization(auth, sig);
    return encodeFunctionData({
      abi: eip3009Abi,
      functionName: "transferWithAuthorization",
      args: [s.from, s.to, s.value, s.validAfter, s.validBefore, s.nonce, s.v, s.r, s.s],
    });
  }

  private depositCall(auth: Authorization, terms: EscrowTerms, sig: Hex): Hex {
    const s = toSignedAuthorization(auth, sig);
    return encodeFunctionData({
      abi: bilbyEscrowAbi,
      functionName: "depositWithAuthorization",
      args: [s.from, s.value, s.validAfter, s.validBefore, terms, s.v, s.r, s.s],
    });
  }

  private routerPermit(p: { value: bigint; deadline: bigint }, sig: Hex): RouterPermit {
    const { r, s, v, yParity } = parseSignature(sig);
    return { value: p.value, deadline: p.deadline, v: Number(v ?? BigInt(27 + (yParity ?? 0))), r, s };
  }

  /**
   * Relays a signed payment. If the balance is short now, the same tx first breaks exactly the
   * shortfall out of Burrow (router.topUpAndCall) — one transaction, one Face ID.
   */
  private async pay(user: Address, total: bigint, funding: Funding, target: Address, data: Hex, sigs: Sigs, label: string, onSent: (h: Hex) => void) {
    const balance = await this.x.chain.ausdBalance(user);
    const need = total > balance ? total - balance : 0n;
    if (need === 0n) return { sent: await this.x.relayer.send({ to: target, data, label }, onSent), fromBurrow: 0n };
    if (!funding.permit || !sigs.burrowPermit) throw errors.insufficientFunds();
    const call = encodeFunctionData({
      abi: bilbyRouterAbi,
      functionName: "topUpAndCall",
      args: [user, need, this.routerPermit(funding.permit, sigs.burrowPermit), target, data],
    });
    const sent = await this.x.relayer.send({ to: this.cfg.deployment.router, data: call, label: `${label} via router` }, onSent);
    this.x.accounts.adjustBurrowPrincipal(user, -need);
    this.x.activity.add({ address: user, kind: "burrow_out", status: "completed", amount: need, note: "Used for a payment", txHash: sent.hash });
    return { sent, fromBurrow: need };
  }

  private async submitSend(user: Address, id: string, st: Extract<State, { type: "send" }>, sigs: Sigs, onSent: (h: Hex) => void): Promise<ActionResult> {
    const me = this.x.accounts.requireRegistered(user);
    if (st.recipient.kind === "registered") {
      const r = st.recipient;
      const { sent } = await this.pay(user, st.amount, st.funding, this.cfg.ausd.address, this.transferCall(st.auth, sigs.payment!), sigs, "send", onSent);
      const mine = this.x.activity.add({
        address: user,
        kind: "sent",
        status: "completed",
        amount: st.amount,
        counterparty: { name: r.name, phoneMasked: r.phoneMasked },
        note: st.note,
        txHash: sent.hash,
        actionId: id,
      });
      this.x.activity.add({
        address: r.address,
        kind: "received",
        status: "completed",
        amount: st.amount,
        counterparty: { name: me.display_name, phoneMasked: maskPhone(me.phone_e164) },
        note: st.note,
        txHash: sent.hash,
      });
      return { id, status: "completed", receipt: this.x.activity.receipt(this.x.activity.getRow(mine.id)!) };
    }

    const terms = st.recipient.terms;
    const { sent } = await this.pay(user, st.amount, st.funding, this.cfg.deployment.escrow, this.depositCall(st.auth, terms, sigs.payment!), sigs, "escrow deposit", onSent);
    const link = this.recordEscrowSend(user, id, {
      kind: "money",
      activityKind: "sent",
      amount: st.amount,
      terms,
      phoneMasked: st.recipient.phoneMasked,
      senderName: me.display_name,
      note: st.note,
      txHash: sent.hash,
    });
    return { id, status: "waiting", claimLink: link.claimLink, receipt: link.receipt };
  }

  private recordEscrowSend(
    user: Address,
    actionId: string,
    a: {
      kind: "money" | "gift";
      activityKind: "sent" | "gift_sent";
      amount: bigint;
      terms: EscrowTerms;
      phoneMasked: string;
      senderName: string;
      note?: string;
      gift?: Record<string, unknown>;
      txHash: Hex;
    },
  ) {
    const code = newClaimCode();
    const nonce = escrowTermsNonce(a.terms);
    const depositId = escrowDepositId(user, nonce);
    const act = this.x.activity.add({
      address: user,
      kind: a.activityKind,
      status: "waiting",
      amount: a.amount,
      counterparty: { name: a.phoneMasked, phoneMasked: a.phoneMasked },
      note: a.note,
      claimCode: code,
      expiresAt: isoFromUnix(a.terms.expiry),
      txHash: a.txHash,
      actionId,
    });
    this.x.claims.create({
      code,
      depositId,
      kind: a.kind,
      amount: a.amount,
      sender: user,
      senderName: a.senderName,
      phoneKey: a.terms.phoneKey,
      phoneMasked: a.phoneMasked,
      note: a.note,
      gift: a.gift,
      giftId: a.terms.giftId === ZERO_BYTES32 ? undefined : a.terms.giftId,
      expiry: a.terms.expiry,
      senderActivityId: act.id,
    });
    return { claimLink: claimLink(this.cfg.publicBaseUrl, code), receipt: this.x.activity.receipt(this.x.activity.getRow(act.id)!) };
  }

  private async submitGiftSend(user: Address, id: string, st: Extract<State, { type: "gift_send" }>, sigs: Sigs, onSent: (h: Hex) => void): Promise<ActionResult> {
    const me = this.x.accounts.requireRegistered(user);
    const { sent } = await this.pay(user, st.amount, st.funding, this.cfg.deployment.escrow, this.depositCall(st.auth, st.terms, sigs.payment!), sigs, "gift deposit", onSent);
    const link = this.recordEscrowSend(user, id, {
      kind: "gift",
      activityKind: "gift_sent",
      amount: st.amount,
      terms: st.terms,
      phoneMasked: st.phoneMasked,
      senderName: me.display_name,
      note: st.gift.message,
      gift: { ...st.gift, faceValue: st.faceValue.toString() },
      txHash: sent.hash,
    });
    return { id, status: "waiting", claimLink: link.claimLink, receipt: link.receipt };
  }

  private async submitGiftBuy(user: Address, id: string, st: Extract<State, { type: "gift_buy" }>, sigs: Sigs, onSent: (h: Hex) => void): Promise<ActionResult> {
    const brand = await this.x.gifts.findBrand(st.brandId);
    if (!brand) throw errors.giftUnavailable();
    const { sent } = await this.pay(user, st.price, st.funding, this.cfg.ausd.address, this.transferCall(st.auth, sigs.payment!), sigs, "gift purchase", onSent);
    // Money is in the treasury: from here on, failure means an automatic refund, never a loss.
    const act = this.x.activity.add({
      address: user,
      kind: "gift_bought",
      status: "completed",
      amount: st.price,
      counterparty: { name: brand.name },
      note: `${formatUsd(st.faceValue)} ${brand.name} gift card`,
      txHash: sent.hash,
      actionId: id,
    });
    const order = await this.x.gifts.fulfil({
      giftId: st.giftId,
      owner: user,
      source: "buy",
      brand,
      faceValue: st.faceValue,
      paid: st.price,
      refundTo: user,
      activityId: act.id,
      quote: st.quote,
    });
    this.x.activity.update(act.id, { giftCardId: order.id });
    const receipt = this.x.activity.receipt(this.x.activity.getRow(act.id)!);
    if (order.status === "failed") {
      return {
        id,
        status: "failed",
        giftCardId: order.id,
        receipt,
        error: {
          code: "GIFT_UNAVAILABLE",
          message: `${brand.name} cards are unavailable right now, so your ${formatUsd(st.price)} is back in your balance. Pick another brand?`,
        },
      };
    }
    return { id, status: "completed", giftCardId: order.id, receipt };
  }

  private async submitCancel(user: Address, id: string, st: Extract<State, { type: "cancel" }>, sigs: Sigs, onSent: (h: Hex) => void): Promise<ActionResult> {
    const data = encodeFunctionData({ abi: bilbyEscrowAbi, functionName: "cancel", args: [st.depositId, st.deadline, sigs.cancel!] });
    const sent = await this.x.relayer.send({ to: this.cfg.deployment.escrow, data, label: "escrow.cancel" }, onSent);
    this.x.claims.markReturned(st.claimCode, "cancelled", sent.hash);
    return { id, status: "completed", receipt: this.x.activity.receipt(this.x.activity.getRow(st.activityId)!) };
  }

  private async submitAutoSave(user: Address, id: string, st: Extract<State, { type: "burrow_autosave" }>, sigs: Sigs, onSent: (h: Hex) => void): Promise<ActionResult> {
    const data = encodeFunctionData({
      abi: bilbyRouterAbi,
      functionName: "setAutoSave",
      args: [user, st.enabled, st.threshold, st.deadline, sigs.autoSave!, this.routerPermit({ value: st.permitValue, deadline: st.deadline }, sigs.ausdPermit!)],
    });
    const sent = await this.x.relayer.send({ to: this.cfg.deployment.router, data, label: "router.setAutoSave" }, onSent);
    this.x.accounts.setAutoSave(user, st.enabled, st.threshold);
    // Turning it on tucks away what's already above the threshold straight away.
    if (st.enabled) await this.x.keeper.sweepLocked(user).catch((e) => console.error("immediate sweep failed", e instanceof Error ? e.message : e));
    return { id, status: "completed", receipt: { reference: `BP-${id.slice(-8).toUpperCase()}`, amount: "0", at: new Date().toISOString(), technical: this.technical(sent) } };
  }

  private technical(sent: Sent) {
    const explorerUrl = this.x.chain.explorerTxUrl(sent.hash);
    return explorerUrl ? { txHash: sent.hash, explorerUrl } : undefined;
  }

  private async submitBurrowAdd(user: Address, id: string, st: Extract<State, { type: "burrow_add" }>, sigs: Sigs, onSent: (h: Hex) => void): Promise<ActionResult> {
    const s = toSignedAuthorization(st.auth, sigs.payment!);
    const data = encodeFunctionData({
      abi: bilbyRouterAbi,
      functionName: "addWithAuthorization",
      args: [user, s.value, s.validAfter, s.validBefore, s.nonce, s.v, s.r, s.s],
    });
    const sent = await this.x.relayer.send({ to: this.cfg.deployment.router, data, label: "router.add" }, onSent);
    this.x.accounts.adjustBurrowPrincipal(user, st.amount);
    const act = this.x.activity.add({ address: user, kind: "burrow_in", status: "completed", amount: st.amount, txHash: sent.hash, actionId: id });
    return { id, status: "completed", receipt: this.x.activity.receipt(this.x.activity.getRow(act.id)!) };
  }

  private async submitBurrowWithdraw(user: Address, id: string, st: Extract<State, { type: "burrow_withdraw" }>, sigs: Sigs, onSent: (h: Hex) => void): Promise<ActionResult> {
    const maxWithdraw = (await this.x.chain.burrow(user)).maxWithdraw;
    if (maxWithdraw < st.amount) {
      throw errors.burrowBusy(maxWithdraw, `Some of your Burrow money is busy right now. You can move up to ${formatUsd(maxWithdraw)} now.`);
    }
    const data = encodeFunctionData({
      abi: bilbyRouterAbi,
      functionName: "breakToBalance",
      args: [user, st.amount, this.routerPermit(st.permit, sigs.burrowPermit!)],
    });
    const sent = await this.x.relayer.send({ to: this.cfg.deployment.router, data, label: "router.break" }, onSent);
    this.x.accounts.adjustBurrowPrincipal(user, -st.amount);
    const act = this.x.activity.add({ address: user, kind: "burrow_out", status: "completed", amount: st.amount, txHash: sent.hash, actionId: id });
    return { id, status: "completed", receipt: this.x.activity.receipt(this.x.activity.getRow(act.id)!) };
  }
}

type Ctx = { user: Address; me: { phone_e164: string; display_name: string }; now: bigint; deadline: bigint };

/** "Oct 9" */
function shortDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

