import { bilbyEscrowAbi, formatUsd } from "@bilbypay/core";
import { type Address, encodeFunctionData, type Hex } from "viem";
import type { AccountService } from "./accounts";
import type { ActivityRepo } from "./activity";
import { bindingActive, type ChainService } from "./chain";
import type { Config } from "./config";
import { kvGet, kvSet, type Db } from "./db";
import { errors, humanizeRevert } from "./errors";
import type { GiftCardService } from "./giftcards/service";
import type { GiftBrand, GiftQuote } from "./giftcards/types";
import { maskPhone } from "./phone";
import type { TxSender } from "./relayer";
import type { Treasury } from "./treasury";
import type { Receipt } from "./types";
import { isoFromUnix, KeyedMutex, nowIso } from "./util";
import type { Verifier } from "./verifier";

export type ClaimRow = {
  code: string;
  deposit_id: string;
  kind: "money" | "gift";
  status: "waiting" | "claiming" | "opened" | "returned";
  amount: string;
  sender_address: string;
  sender_name: string;
  phone_key: string;
  phone_epoch: string;
  phone_masked: string;
  note: string | null;
  gift: string | null;
  gift_id: string | null;
  expiry: number;
  sender_activity_id: string;
  claimed_by: string | null;
  result: string | null;
};

export type GiftInfo = {
  brandId: string | null;
  brandName?: string;
  brandLogoUrl?: string;
  brandArtworkUrl?: string;
  design?: string;
  message?: string;
  faceValue: string;
};

export type AcceptResult = {
  status: "completed";
  amount: string;
  giftCardId?: string;
  receipt: Receipt;
  error?: { code: string; message: string };
};

const CLAIM_TTL_SECONDS = 600n;

/** Money and gifts waiting in escrow for a number that hadn't joined when they were sent. */
export class ClaimService {
  private readonly locks = new KeyedMutex();

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly chain: ChainService,
    private readonly verifier: Verifier,
    private readonly relayer: TxSender,
    private readonly accounts: AccountService,
    private readonly activity: ActivityRepo,
    private readonly gifts: GiftCardService,
    private readonly treasury: Treasury,
  ) {}

  create(c: {
    code: string;
    depositId: Hex;
    kind: "money" | "gift";
    amount: bigint;
    sender: Address;
    senderName: string;
    phoneKey: Hex;
    phoneEpoch: bigint;
    phoneMasked: string;
    note?: string;
    gift?: Record<string, unknown>;
    giftId?: Hex;
    expiry: number;
    senderActivityId: string;
  }) {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO claims (code, deposit_id, kind, status, amount, sender_address, sender_name, phone_key, phone_epoch, phone_masked, note,
          gift, gift_id, expiry, sender_activity_id, created_at, updated_at)
         VALUES (?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.code,
        c.depositId,
        c.kind,
        c.amount.toString(),
        c.sender,
        c.senderName,
        c.phoneKey,
        c.phoneEpoch.toString(),
        c.phoneMasked,
        c.note ?? null,
        c.gift ? JSON.stringify(c.gift) : null,
        c.giftId ?? null,
        c.expiry,
        c.senderActivityId,
        now,
        now,
      );
  }

  get(code: string): ClaimRow | undefined {
    return this.db.prepare("SELECT * FROM claims WHERE code = ?").get(code) as ClaimRow | undefined;
  }

  giftInfo(row: ClaimRow): GiftInfo | undefined {
    return row.gift ? (JSON.parse(row.gift) as GiftInfo) : undefined;
  }

  /** Public view for the claim screen and the share page. */
  view(code: string) {
    const row = this.get(code);
    if (!row) throw errors.notFound("We couldn't find this link. Ask the sender to share it again.");
    const gift = this.giftInfo(row);
    return {
      code: row.code,
      kind: row.kind,
      amount: gift ? gift.faceValue : row.amount,
      senderName: row.sender_name,
      note: row.kind === "money" ? (row.note ?? undefined) : undefined,
      gift: gift
        ? { brandId: gift.brandId, brandName: gift.brandName, brandLogoUrl: gift.brandLogoUrl, brandArtworkUrl: gift.brandArtworkUrl, design: gift.design, message: gift.message }
        : undefined,
      status: row.status === "opened" ? ("opened" as const) : row.status === "returned" ? ("returned" as const) : ("waiting" as const),
      expiresAt: isoFromUnix(row.expiry),
      phoneMasked: row.phone_masked,
    };
  }

  async accept(code: string, recipient: Address, phoneToken: string, brandIdParam?: string): Promise<AcceptResult> {
    const phone = await this.accounts.tokens.verifyPhoneToken(phoneToken);
    const first = this.get(code);
    if (!first) throw errors.notFound("We couldn't find this link. Ask the sender to share it again.");
    if (phone.phoneKey !== first.phone_key) throw errors.wrongPhone(first.phone_masked);

    return this.locks.run(code, async () => {
      const row = this.get(code)!;
      if (row.status === "opened") {
        // Retry-safe: the same person opening twice gets the first result back.
        if (row.claimed_by === recipient && row.result) return JSON.parse(row.result) as AcceptResult;
        throw errors.alreadyClaimed();
      }
      if (row.status === "returned") throw errors.claimExpired();
      const now = await this.chain.now();
      if (now >= row.expiry) throw errors.claimExpired();
      const deposit = await this.chain.deposit(row.deposit_id as Hex);
      if (deposit.statusName === "Claimed") throw errors.alreadyClaimed();
      if (deposit.statusName !== "Pending") {
        this.markReturned(code, deposit.statusName === "Cancelled" ? "cancelled" : "refunded");
        throw errors.claimExpired();
      }
      const binding = await this.accounts.refreshBinding(row.phone_key as Hex);
      if (binding.binding.phoneEpoch !== deposit.phoneEpoch) throw errors.claimRecipientChanged();
      if (!bindingActive(binding) || binding.binding.account.toLowerCase() !== recipient.toLowerCase()) throw errors.phoneUnavailable();

      // Gifts: settle brand and price before moving any money, so an unavailable brand changes nothing.
      const gift = this.giftInfo(row);
      let giftPlan: { brand: GiftBrand; quote: GiftQuote } | undefined;
      if (row.kind === "gift" && gift) {
        const brandId = gift.brandId ?? brandIdParam;
        if (!brandId) throw errors.invalidRequest("Pick a gift card to open your gift.");
        giftPlan = await this.gifts.checkAvailable(brandId, BigInt(gift.faceValue));
        if (giftPlan.quote.price > BigInt(row.amount)) {
          throw errors.giftUnavailable(`${giftPlan.brand.name} cards cost a bit more right now. Please pick another brand.`);
        }
      }

      const deadline = BigInt(now) + CLAIM_TTL_SECONDS;
      const attestation = await this.verifier.signClaim({ depositId: row.deposit_id as Hex, phoneKey: row.phone_key as Hex, recipient, deadline });
      const data = encodeFunctionData({ abi: bilbyEscrowAbi, functionName: "claim", args: [row.deposit_id as Hex, recipient, deadline, attestation] });
      this.db.prepare("UPDATE claims SET status = 'claiming', updated_at = ? WHERE code = ?").run(nowIso(), code);
      let hash: Hex;
      try {
        hash = (await this.relayer.send({ to: this.config.deployment.escrow, data, label: "escrow.claim" })).hash;
      } catch (err) {
        this.db.prepare("UPDATE claims SET status = 'waiting', updated_at = ? WHERE code = ?").run(nowIso(), code);
        throw humanizeRevert(err);
      }
      this.db.prepare("UPDATE claims SET status = 'opened', claimed_by = ?, updated_at = ? WHERE code = ?").run(recipient, nowIso(), code);
      this.activity.update(row.sender_activity_id, { status: "completed" });

      const amount = BigInt(row.amount);
      const sender = { name: row.sender_name, phoneMasked: senderPhoneMasked(this.accounts, row.sender_address as Address) };
      let result: AcceptResult;
      if (row.kind === "money" || !gift || !giftPlan) {
        const act = this.activity.add({ address: recipient, kind: "received", status: "completed", amount, counterparty: sender, note: row.note ?? undefined, txHash: hash });
        result = { status: "completed", amount: row.amount, receipt: this.activity.receipt(this.activity.getRow(act.id)!) };
      } else {
        result = await this.fulfilGift(row, gift, giftPlan, recipient, sender, hash);
      }
      this.db.prepare("UPDATE claims SET result = ? WHERE code = ?").run(JSON.stringify(result), code);
      return result;
    });
  }

  /** The escrowed money is now in the treasury: buy the card, pass any change to the recipient. */
  private async fulfilGift(
    row: ClaimRow,
    gift: GiftInfo,
    plan: { brand: GiftBrand; quote: GiftQuote },
    recipient: Address,
    sender: { name: string; phoneMasked?: string },
    hash: Hex,
  ): Promise<AcceptResult> {
    const escrowed = BigInt(row.amount);
    const price = plan.quote.price;
    const faceValue = BigInt(gift.faceValue);
    const act = this.activity.add({
      address: recipient,
      kind: "gift_received",
      status: "completed",
      amount: faceValue,
      counterparty: sender,
      note: gift.message,
      txHash: hash,
    });
    const change = escrowed - price;
    if (change > 0n) {
      try {
        const sent = await this.treasury.pay(recipient, change, `gift change ${row.code}`);
        this.activity.add({
          address: recipient,
          kind: "received",
          status: "completed",
          amount: change,
          counterparty: sender,
          note: `Left over from your ${plan.brand.name} gift card`,
          txHash: sent.hash,
        });
      } catch (err) {
        console.error(`claim ${row.code}: change payout failed`, err instanceof Error ? err.message : err);
      }
    }
    const order = await this.gifts.fulfil({
      giftId: row.gift_id as Hex,
      owner: recipient,
      source: "gift",
      brand: plan.brand,
      faceValue,
      paid: price,
      refundTo: recipient,
      fromName: row.sender_name,
      activityId: act.id,
      quote: plan.quote,
    });
    this.activity.update(act.id, { giftCardId: order.id });
    const receipt = this.activity.receipt(this.activity.getRow(act.id)!);
    if (order.status === "failed") {
      return {
        status: "completed",
        amount: row.amount,
        giftCardId: order.id,
        receipt,
        error: {
          code: "GIFT_UNAVAILABLE",
          message: `${plan.brand.name} cards are unavailable right now, so the ${formatUsd(price)} is in your balance instead.`,
        },
      };
    }
    return { status: "completed", amount: row.amount, giftCardId: order.id, receipt };
  }

  /** Cancelled by the sender or refunded after expiry: the money is back with the sender. */
  markReturned(code: string, how: "cancelled" | "refunded", txHash?: Hex) {
    const row = this.get(code);
    if (!row || row.status === "returned") return;
    this.db.prepare("UPDATE claims SET status = 'returned', updated_at = ? WHERE code = ?").run(nowIso(), code);
    this.activity.update(row.sender_activity_id, { status: how, txHash });
  }

  pendingOut(sender: Address): bigint {
    const rows = this.db
      .prepare("SELECT amount FROM claims WHERE sender_address = ? AND status IN ('waiting', 'claiming')")
      .all(sender) as { amount: string }[];
    return rows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  }

  /** Waiting deposits whose expiry has passed on chain (the keeper refunds them). */
  expired(chainNow: number): ClaimRow[] {
    return this.db.prepare("SELECT * FROM claims WHERE status = 'waiting' AND expiry <= ?").all(chainNow) as ClaimRow[];
  }

  /** Rotate through pending deposits so reassigned numbers refund without waiting for expiry. */
  async refundable(chainNow: number): Promise<ClaimRow[]> {
    const expired = this.expired(chainNow);
    const cursor = Number(kvGet(this.db, "claims:reassignment-scan") ?? "0");
    const rows = this.db.prepare("SELECT rowid AS scan_id, * FROM claims WHERE status = 'waiting' AND expiry > ? AND rowid > ? ORDER BY rowid LIMIT 100").all(chainNow, cursor) as (ClaimRow & { scan_id: number })[];
    kvSet(this.db, "claims:reassignment-scan", rows.length === 100 ? String(rows.at(-1)!.scan_id) : "0");
    const epochs = new Map<string, bigint>();
    for (const row of rows) {
      let epoch = epochs.get(row.phone_key);
      if (epoch === undefined) {
        epoch = (await this.chain.directoryState(row.phone_key as Hex)).binding.phoneEpoch;
        epochs.set(row.phone_key, epoch);
      }
      if (epoch !== BigInt(row.phone_epoch)) expired.push(row);
    }
    return expired;
  }
}

function senderPhoneMasked(accounts: AccountService, sender: Address): string | undefined {
  const e164 = accounts.get(sender)?.phone_e164;
  return e164 ? maskPhone(e164) : undefined;
}
