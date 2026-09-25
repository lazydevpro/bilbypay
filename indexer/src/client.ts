// Typed client for the BilbyPay indexer's GraphQL API, for the server (GET /v1/activity,
// /v1/balance Burrow numbers, /v1/resolve "recently changed" warnings, stats) or the app.
// Dependency-free (global fetch), no envio imports, safe to bundle into React Native.
import { INDEXER_QUERIES } from "./queries.js";

type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type IndexerClientOptions = {
  /** e.g. http://localhost:8080/v1/graphql (envio dev) or the Envio Cloud endpoint. */
  url: string;
  /** 143 Monad mainnet, 10143 testnet. */
  chainId: number;
  headers?: Record<string, string>;
  fetch?: Fetch;
};

// ------------------------------------------------------------------ raw rows

/** BigInt columns come back from Hasura as strings. */
type BigIntString = string;

export type ActivityRow = {
  id: string;
  kind: "sent" | "received" | "gift_sent" | "gift_received" | "burrow_in" | "burrow_out" | "refund";
  status: "completed" | "waiting" | "refunded" | "cancelled";
  amount: BigIntString;
  counterparty: string | null;
  counterpartyAccount_id: string | null;
  counterpartyPhoneKey: string | null;
  deposit_id: string | null;
  giftId: string | null;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  blockNumber: number;
  logIndex: number;
  txHash: string;
};

export type AccountRow = {
  id: string;
  phoneKey: string | null;
  isBound: boolean;
  boundAt: number | null;
  reboundAt: number | null;
  ausdIn: BigIntString;
  ausdOut: BigIntString;
  ausdNetFlow: BigIntString;
  sentCount: number;
  sentVolume: BigIntString;
  receivedCount: number;
  receivedVolume: BigIntString;
  giftsSentCount: number;
  giftsReceivedCount: number;
  pendingOutgoing: BigIntString;
  autoSaveEnabled: boolean;
  autoSaveThreshold: BigIntString;
  firstSeenAt: number;
  lastActiveAt: number;
};

export type BurrowRow = {
  shares: BigIntString;
  depositedAssets: BigIntString;
  withdrawnAssets: BigIntString;
  netDeposited: BigIntString;
  sweepCount: number;
  sweptAssets: BigIntString;
  addCount: number;
  breakCount: number;
};

export type ContactRow = { to_id: string; count: number; volume: BigIntString; lastAt: number };

export type PhoneRow = {
  id: string;
  account_id: string | null;
  boundAt: number | null;
  rebindCount: number;
  lastReboundAt: number | null;
};

export type GlobalStatsRow = {
  accounts: number;
  boundPhones: number;
  rebinds: number;
  paymentsCount: number;
  paymentsVolume: BigIntString;
  directTransferCount: number;
  directTransferVolume: BigIntString;
  externalInVolume: BigIntString;
  externalOutVolume: BigIntString;
  escrowDepositCount: number;
  escrowDepositVolume: BigIntString;
  escrowPendingCount: number;
  escrowPendingValue: BigIntString;
  escrowClaimCount: number;
  escrowRefundCount: number;
  escrowCancelCount: number;
  claimRate: number;
  giftCount: number;
  giftVolume: BigIntString;
  avgTimeToClaim: number;
  medianTimeToClaim: number;
  p90TimeToClaim: number;
  timeToClaimHistogram: number[];
  burrowAccounts: number;
  burrowShares: BigIntString;
  burrowNetDeposited: BigIntString;
  burrowTvlEstimate: BigIntString;
  autoSaveEnabledCount: number;
  sharePriceWad: BigIntString;
  updatedAt: number;
};

export type DailyStatsRow = {
  date: string;
  activeAccounts: number;
  newAccounts: number;
  paymentsCount: number;
  paymentsVolume: BigIntString;
  escrowDepositCount: number;
  escrowClaimCount: number;
  giftVolume: BigIntString;
  timeToClaimSum: BigIntString;
  timeToClaimCount: number;
  burrowInVolume: BigIntString;
  burrowOutVolume: BigIntString;
};

// ------------------------------------------------------- app-facing shapes

/**
 * docs/api.md `ActivityItem`, minus what only the server knows: the counterparty's display name
 * and masked phone (resolve `counterparty.address` / `counterparty.phoneKey` from the server DB),
 * notes, claim links, gift card ids, and `gift_bought` (a "sent" to the treasury address) or
 * `failed` items (never reach the chain).
 */
export type IndexedActivityItem = {
  id: string;
  kind: ActivityRow["kind"];
  status: ActivityRow["status"];
  amount: string; // AUSD base units
  counterparty?: { address?: string; isBilbyUser: boolean; phoneKey?: string };
  depositId?: string;
  giftId?: string;
  canCancel: boolean;
  expiresAt?: string; // ISO
  createdAt: string; // ISO
  txHash: string;
};

export type ActivityPage = { items: IndexedActivityItem[]; nextCursor?: string };

export type BurrowSummary = {
  shares: bigint;
  amount: bigint; // shares at the latest indexed share price
  netDeposited: bigint;
  earned: bigint; // clamped at 0, as the app shows it
  sweepCount: number;
  breakCount: number;
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const WAD = 10n ** 18n;
const FIRST_PAGE_CURSOR = { block: 2_147_483_647, log: 2_147_483_647 };

export function encodeCursor(row: Pick<ActivityRow, "blockNumber" | "logIndex">): string {
  return `${row.blockNumber}.${row.logIndex}`;
}

export function decodeCursor(cursor: string | undefined): { block: number; log: number } {
  if (!cursor) return FIRST_PAGE_CURSOR;
  const match = /^(\d+)\.(\d+)$/.exec(cursor);
  if (!match) throw new Error(`Invalid activity cursor: ${cursor}`);
  return { block: Number(match[1]), log: Number(match[2]) };
}

export function toActivityItem(row: ActivityRow): IndexedActivityItem {
  const counterparty =
    row.counterparty || row.counterpartyPhoneKey
      ? {
          address: row.counterparty ?? undefined,
          isBilbyUser: row.counterpartyAccount_id !== null,
          phoneKey: row.counterpartyPhoneKey ?? undefined,
        }
      : undefined;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    amount: row.amount,
    counterparty,
    depositId: row.deposit_id ?? undefined,
    giftId: row.giftId ?? undefined,
    canCancel: row.status === "waiting" && (row.kind === "sent" || row.kind === "gift_sent"),
    expiresAt: row.expiresAt !== null ? iso(row.expiresAt) : undefined,
    createdAt: iso(row.createdAt),
    txHash: row.txHash,
  };
}

export function burrowSummary(row: BurrowRow | undefined, sharePriceWad: bigint): BurrowSummary {
  const shares = BigInt(row?.shares ?? "0");
  const netDeposited = BigInt(row?.netDeposited ?? "0");
  const amount = (shares * sharePriceWad) / WAD;
  const earned = amount - netDeposited;
  return {
    shares,
    amount,
    netDeposited,
    earned: earned > 0n ? earned : 0n,
    sweepCount: row?.sweepCount ?? 0,
    breakCount: row?.breakCount ?? 0,
  };
}

/** docs/api.md `recentlyChanged`: the number moved to its current account within `cooldownSeconds`. */
export function recentlyChanged(phone: PhoneRow | undefined, nowSeconds: number, cooldownSeconds: number): boolean {
  if (!phone?.lastReboundAt || !phone.account_id) return false;
  return nowSeconds - phone.lastReboundAt < cooldownSeconds;
}

// ------------------------------------------------------------------- client

export class IndexerError extends Error {}

export function createIndexerClient(options: IndexerClientOptions) {
  const doFetch: Fetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
  const lower = (s: string) => s.toLowerCase();

  async function run<T>(operationName: string, variables: Record<string, unknown>): Promise<T> {
    const response = await doFetch(options.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: JSON.stringify({ query: INDEXER_QUERIES, operationName, variables: { chainId: options.chainId, ...variables } }),
    });
    if (!response.ok) throw new IndexerError(`indexer ${operationName}: HTTP ${response.status}`);
    const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) throw new IndexerError(`indexer ${operationName}: ${body.errors.map((e) => e.message).join("; ")}`);
    if (!body.data) throw new IndexerError(`indexer ${operationName}: empty response`);
    return body.data;
  }

  return {
    /** One page of an account's feed, newest first. Pass `nextCursor` back for the next page. */
    async activity(account: string, opts: { limit?: number; cursor?: string } = {}): Promise<ActivityPage> {
      const limit = opts.limit ?? 20;
      const before = decodeCursor(opts.cursor);
      const data = await run<{ ActivityItem: ActivityRow[] }>("ActivityFeed", {
        account: lower(account),
        limit,
        beforeBlock: before.block,
        beforeLog: before.log,
      });
      const rows = data.ActivityItem;
      const last = rows[rows.length - 1];
      return {
        items: rows.map(toActivityItem),
        nextCursor: rows.length === limit && last ? encodeCursor(last) : undefined,
      };
    },

    async account(account: string) {
      const data = await run<{ Account: AccountRow[]; BurrowPosition: BurrowRow[]; GlobalStats: Array<{ sharePriceWad: string }> }>(
        "AccountSummary",
        { account: lower(account) },
      );
      const price = BigInt(data.GlobalStats[0]?.sharePriceWad ?? WAD.toString());
      const row = data.Account[0];
      return {
        account: row,
        pendingOut: BigInt(row?.pendingOutgoing ?? "0"),
        autoSave: { enabled: row?.autoSaveEnabled ?? false, threshold: BigInt(row?.autoSaveThreshold ?? "0") },
        burrow: burrowSummary(data.BurrowPosition[0], price),
      };
    },

    async recentContacts(account: string, limit = 10): Promise<ContactRow[]> {
      return (await run<{ ContactEdge: ContactRow[] }>("RecentContacts", { account: lower(account), limit })).ContactEdge;
    },

    async phone(phoneKey: string): Promise<PhoneRow | undefined> {
      return (await run<{ Phone: PhoneRow[] }>("PhoneStatus", { phoneKey: lower(phoneKey) })).Phone[0];
    },

    async stats(days = 30) {
      const data = await run<{
        GlobalStats: GlobalStatsRow[];
        DailyStats: DailyStatsRow[];
        _meta: Array<{ chainId: number; isReady: boolean }>;
      }>("ProtocolStats", { days });
      return {
        global: data.GlobalStats[0],
        daily: data.DailyStats,
        synced: data._meta.find((m) => m.chainId === options.chainId)?.isReady ?? false,
      };
    },
  };
}

export type IndexerClient = ReturnType<typeof createIndexerClient>;
