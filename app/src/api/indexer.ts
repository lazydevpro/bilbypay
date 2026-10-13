// Activity feed from the BilbyPay Envio HyperIndex indexer (indexer/), with the API as the fallback.
//
// When EXPO_PUBLIC_INDEXER_URL points at the indexer's GraphQL endpoint (Envio Cloud or `envio dev`),
// the Activity screen reads the account's on-chain feed from Envio. The server's own feed is still
// fetched for the first page, and an indexed row whose tx matches a server row is replaced by that
// server row: it knows names, notes, claim links and the activity id that "cancel" needs. Any
// indexer error (or no URL, or the in-app demo API) falls back to the API, so the screen never
// depends on the indexer being up.
import type { ActivityItem, ActivityPage, Hex } from "./types";

/** `ActivityFeed` from indexer/queries/activity.graphql, verbatim (a test keeps the two in sync). */
export const ACTIVITY_FEED_QUERY = `query ActivityFeed($chainId: Int!, $account: String!, $limit: Int!, $beforeBlock: Int!, $beforeLog: Int!) {
  ActivityItem(
    where: {
      chainId: { _eq: $chainId }
      account_id: { _eq: $account }
      _or: [
        { blockNumber: { _lt: $beforeBlock } }
        { blockNumber: { _eq: $beforeBlock }, logIndex: { _lt: $beforeLog } }
      ]
    }
    order_by: [{ blockNumber: desc }, { logIndex: desc }]
    limit: $limit
  ) {
    id
    kind
    status
    amount
    counterparty
    counterpartyAccount_id
    counterpartyPhoneKey
    deposit_id
    giftId
    expiresAt
    createdAt
    updatedAt
    blockNumber
    logIndex
    txHash
  }
}`;

/** One `ActivityItem` row as Hasura returns it (BigInt as string, timestamps in unix seconds). */
export type IndexedActivityRow = {
  id: string;
  kind: "sent" | "received" | "gift_sent" | "gift_received" | "burrow_in" | "burrow_out" | "refund";
  status: "completed" | "waiting" | "refunded" | "cancelled";
  amount: string;
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

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type IndexerOptions = { url: string; chainId: number; fetch?: FetchLike; limit?: number };

/** Indexer cursors are tagged so a page never continues from the other source's cursor. */
const CURSOR_PREFIX = "envio:";
const FIRST_PAGE = { block: 2_147_483_647, log: 2_147_483_647 };

export const isIndexerCursor = (cursor: string | undefined): boolean => !!cursor?.startsWith(CURSOR_PREFIX);

function decodeCursor(cursor: string | undefined): { block: number; log: number } {
  if (!cursor) return FIRST_PAGE;
  const match = /^envio:(\d+)\.(\d+)$/.exec(cursor);
  if (!match) throw new Error(`Invalid indexer cursor: ${cursor}`);
  return { block: Number(match[1]), log: Number(match[2]) };
}

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** The same explorers the server links to by default (viem's chain definitions). */
function explorerTxUrl(chainId: number, txHash: string): string {
  return (chainId === 10143 ? "https://testnet.monadexplorer.com/tx/" : "https://monadscan.com/tx/") + txHash;
}

/**
 * Maps an indexed row to the app's `ActivityItem`. The chain has addresses and HMAC phone keys, not
 * names, so the counterparty is a short address (or "a phone number" for a send that is not claimed
 * yet). `canCancel` stays false: cancelling needs the server's activity id (see mergeServerItems).
 */
export function toAppActivity(row: IndexedActivityRow, chainId: number): ActivityItem {
  const name = row.counterparty
    ? shortAddress(row.counterparty)
    : row.counterpartyPhoneKey
      ? "A phone number"
      : undefined;
  return {
    id: `envio-${row.id}`,
    kind: row.kind,
    status: row.status,
    amount: row.amount,
    counterparty: name ? { name } : undefined,
    canCancel: false,
    expiresAt: row.expiresAt !== null ? iso(row.expiresAt) : undefined,
    createdAt: iso(row.createdAt),
    receipt: {
      reference: row.txHash.slice(2, 10).toUpperCase(),
      amount: row.amount,
      counterparty: name ? { name } : undefined,
      at: iso(row.updatedAt),
      technical: { txHash: row.txHash as Hex, explorerUrl: explorerTxUrl(chainId, row.txHash) },
    },
  };
}

/** One page of `account`'s feed from the indexer, newest first. Throws on any transport/GraphQL error. */
export async function fetchIndexedActivity(account: string, cursor: string | undefined, opts: IndexerOptions): Promise<ActivityPage> {
  const limit = opts.limit ?? 20;
  const before = decodeCursor(cursor);
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const response = await doFetch(opts.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: ACTIVITY_FEED_QUERY,
      operationName: "ActivityFeed",
      variables: { chainId: opts.chainId, account: account.toLowerCase(), limit, beforeBlock: before.block, beforeLog: before.log },
    }),
  });
  if (!response.ok) throw new Error(`indexer: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { ActivityItem?: IndexedActivityRow[] }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`indexer: ${body.errors.map((e) => e.message).join("; ")}`);
  const rows = body.data?.ActivityItem;
  if (!Array.isArray(rows)) throw new Error("indexer: malformed response");
  const last = rows[rows.length - 1];
  return {
    items: rows.map((row) => toAppActivity(row, opts.chainId)),
    nextCursor: rows.length === limit && last ? `${CURSOR_PREFIX}${last.blockNumber}.${last.logIndex}` : undefined,
  };
}

/**
 * Replaces indexed rows with the server's row for the same tx and kind (names, notes, cancel). Server
 * rows the chain cannot show (gift card purchases, failed actions) are not added: the indexed feed is
 * the list, the server only enriches it.
 */
export function mergeServerItems(indexed: ActivityItem[], server: ActivityItem[]): ActivityItem[] {
  const byTx = new Map<string, ActivityItem[]>();
  for (const it of server) {
    const tx = it.receipt?.technical?.txHash?.toLowerCase();
    if (tx) byTx.set(tx, [...(byTx.get(tx) ?? []), it]);
  }
  const used = new Set<string>();
  return indexed.map((it) => {
    const tx = it.receipt?.technical?.txHash?.toLowerCase();
    const match = tx ? byTx.get(tx)?.find((s) => !used.has(s.id) && s.kind === it.kind) : undefined;
    if (!match) return it;
    used.add(match.id);
    return match;
  });
}

export type ActivitySource = "indexer" | "api";

/**
 * The Activity screen's loader. Uses the indexer when `indexerUrl` and `account` are set, otherwise
 * (and on any indexer error) `apiActivity`. A server-cursor page stays on the API; an indexer-cursor
 * page whose indexer request fails rethrows, so "load more" shows an error instead of duplicating.
 */
export async function loadActivity(args: {
  cursor?: string;
  account: string | null;
  indexerUrl?: string;
  chainId: number;
  apiActivity: (cursor?: string) => Promise<ActivityPage>;
  fetch?: FetchLike;
  onFallback?: (error: unknown) => void;
}): Promise<ActivityPage & { source: ActivitySource }> {
  const { cursor, account, indexerUrl, apiActivity } = args;
  const useIndexer = !!indexerUrl && !!account && (cursor === undefined || isIndexerCursor(cursor));
  if (!useIndexer) return { ...(await apiActivity(cursor)), source: "api" };
  try {
    const opts = { url: indexerUrl, chainId: args.chainId, fetch: args.fetch };
    if (cursor) return { ...(await fetchIndexedActivity(account, cursor, opts)), source: "indexer" };
    // First page: enrich with the server's feed; the indexer alone is enough if the server is down.
    const [page, server] = await Promise.all([fetchIndexedActivity(account, undefined, opts), apiActivity().catch(() => null)]);
    return { items: server ? mergeServerItems(page.items, server.items) : page.items, nextCursor: page.nextCursor, source: "indexer" };
  } catch (error) {
    if (cursor) throw error;
    args.onFallback?.(error);
    return { ...(await apiActivity()), source: "api" };
  }
}
