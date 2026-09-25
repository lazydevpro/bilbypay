import type { Address, Hex } from "viem";
import type { ChainService } from "./chain";
import type { Db } from "./db";
import type { ActivityItem, ActivityKind, ActivityStatus, Counterparty, Receipt } from "./types";
import { newId, newReference, nowIso } from "./util";

type Row = {
  seq: number;
  id: string;
  address: string;
  kind: ActivityKind;
  status: ActivityStatus;
  amount: string;
  counterparty_name: string | null;
  counterparty_phone_masked: string | null;
  note: string | null;
  gift_card_id: string | null;
  claim_code: string | null;
  expires_at: string | null;
  reference: string | null;
  tx_hash: string | null;
  action_id: string | null;
  created_at: string;
  updated_at: string;
};

export type NewActivity = {
  address: Address;
  kind: ActivityKind;
  status: ActivityStatus;
  amount: bigint;
  counterparty?: Counterparty;
  note?: string;
  giftCardId?: string;
  claimCode?: string;
  expiresAt?: string;
  txHash?: Hex;
  actionId?: string;
};

const PAGE_SIZE = 30;

/** Each user's feed. A payment between two users is two rows, one per feed. */
export class ActivityRepo {
  constructor(
    private readonly db: Db,
    private readonly chain: ChainService,
    private readonly publicBaseUrl: string,
  ) {}

  add(a: NewActivity): { id: string; reference: string } {
    const id = newId("act");
    const reference = newReference();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO activity (id, address, kind, status, amount, counterparty_name, counterparty_phone_masked, note,
          gift_card_id, claim_code, expires_at, reference, tx_hash, action_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        a.address,
        a.kind,
        a.status,
        a.amount.toString(),
        a.counterparty?.name ?? null,
        a.counterparty?.phoneMasked ?? null,
        a.note ?? null,
        a.giftCardId ?? null,
        a.claimCode ?? null,
        a.expiresAt ?? null,
        reference,
        a.txHash ?? null,
        a.actionId ?? null,
        now,
        now,
      );
    return { id, reference };
  }

  update(id: string, patch: { status?: ActivityStatus; giftCardId?: string; txHash?: Hex }) {
    this.db
      .prepare(
        `UPDATE activity SET status = COALESCE(?, status), gift_card_id = COALESCE(?, gift_card_id),
          tx_hash = COALESCE(?, tx_hash), updated_at = ? WHERE id = ?`,
      )
      .run(patch.status ?? null, patch.giftCardId ?? null, patch.txHash ?? null, nowIso(), id);
  }

  getRow(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM activity WHERE id = ?").get(id) as Row | undefined;
  }

  get(id: string): ActivityItem | undefined {
    const row = this.getRow(id);
    return row && this.toItem(row);
  }

  list(address: Address, cursor?: string): { items: ActivityItem[]; nextCursor?: string } {
    const before = cursor && /^\d+$/.test(cursor) ? Number(cursor) : Number.MAX_SAFE_INTEGER;
    const rows = this.db
      .prepare("SELECT * FROM activity WHERE address = ? AND seq < ? ORDER BY seq DESC LIMIT ?")
      .all(address, before, PAGE_SIZE + 1) as Row[];
    const page = rows.slice(0, PAGE_SIZE);
    return {
      items: page.map((r) => this.toItem(r)),
      nextCursor: rows.length > PAGE_SIZE ? String(page[page.length - 1]!.seq) : undefined,
    };
  }

  receipt(row: Row): Receipt {
    const explorerUrl = row.tx_hash ? this.chain.explorerTxUrl(row.tx_hash as Hex) : undefined;
    return {
      reference: row.reference ?? row.id,
      amount: row.amount,
      counterparty: this.counterparty(row),
      at: row.updated_at,
      technical: row.tx_hash && explorerUrl ? { txHash: row.tx_hash as Hex, explorerUrl } : undefined,
    };
  }

  private counterparty(row: Row): Counterparty | undefined {
    if (!row.counterparty_name) return undefined;
    return { name: row.counterparty_name, phoneMasked: row.counterparty_phone_masked ?? undefined };
  }

  toItem(row: Row): ActivityItem {
    const waiting = row.status === "waiting" && !!row.claim_code;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      amount: row.amount,
      counterparty: this.counterparty(row),
      note: row.note ?? undefined,
      giftCardId: row.gift_card_id ?? undefined,
      claimLink: waiting ? claimLink(this.publicBaseUrl, row.claim_code!) : undefined,
      canCancel: waiting && (row.kind === "sent" || row.kind === "gift_sent") ? true : undefined,
      expiresAt: waiting ? (row.expires_at ?? undefined) : undefined,
      receipt: row.status === "completed" || row.status === "refunded" || row.status === "cancelled" ? this.receipt(row) : undefined,
      createdAt: row.created_at,
    };
  }
}

export const claimLink = (base: string, code: string) => `${base}/c/${code}`;
