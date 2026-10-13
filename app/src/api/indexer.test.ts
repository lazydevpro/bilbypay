import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ACTIVITY_FEED_QUERY, fetchIndexedActivity, loadActivity, mergeServerItems, toAppActivity, type IndexedActivityRow } from "./indexer";
import type { ActivityItem, ActivityPage } from "./types";

const URL = "https://indexer.dev.hyperindex.xyz/abc1234/v1/graphql";
const ACCOUNT = "0xAbCdEf0000000000000000000000000000000001";
const TX = "0x" + "ab".repeat(32);

const row = (over: Partial<IndexedActivityRow> = {}): IndexedActivityRow => ({
  id: "0xtx-3-sent",
  kind: "sent",
  status: "completed",
  amount: "20000000",
  counterparty: "0x1111111111111111111111111111111111112222",
  counterpartyAccount_id: "0x1111111111111111111111111111111111112222",
  counterpartyPhoneKey: null,
  deposit_id: null,
  giftId: null,
  expiresAt: null,
  createdAt: 1_790_000_000,
  updatedAt: 1_790_000_060,
  blockNumber: 67217605,
  logIndex: 3,
  txHash: TX,
  ...over,
});

const graphql = (rows: IndexedActivityRow[]) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { ActivityItem: rows } }) }));
const apiPage = (items: ActivityItem[] = []): ActivityPage => ({ items, nextCursor: "server-cursor" });

describe("indexer activity", () => {
  it("sends the ActivityFeed document from indexer/queries verbatim", () => {
    const file = readFileSync(join(__dirname, "../../../indexer/queries/activity.graphql"), "utf8");
    expect(file).toContain(ACTIVITY_FEED_QUERY);
  });

  it("queries by chain and lowercase account and tags the next cursor", async () => {
    const fetch = graphql([row()]);
    const page = await fetchIndexedActivity(ACCOUNT, undefined, { url: URL, chainId: 10143, fetch, limit: 1 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe(URL);
    expect(JSON.parse(init.body)).toMatchObject({
      operationName: "ActivityFeed",
      variables: { chainId: 10143, account: ACCOUNT.toLowerCase(), limit: 1, beforeBlock: 2147483647, beforeLog: 2147483647 },
    });
    expect(page.nextCursor).toBe("envio:67217605.3");

    await fetchIndexedActivity(ACCOUNT, "envio:67217605.3", { url: URL, chainId: 10143, fetch, limit: 1 });
    expect(JSON.parse((fetch.mock.calls[1] as unknown as [string, { body: string }])[1].body).variables).toMatchObject({ beforeBlock: 67217605, beforeLog: 3 });
  });

  it("maps rows to app items with a receipt and explorer link", () => {
    const item = toAppActivity(row({ status: "waiting", counterparty: null, counterpartyAccount_id: null, counterpartyPhoneKey: "0x" + "aa".repeat(32), expiresAt: 1_790_600_000 }), 10143);
    expect(item).toMatchObject({
      id: "envio-0xtx-3-sent",
      kind: "sent",
      status: "waiting",
      amount: "20000000",
      counterparty: { name: "A phone number" },
      canCancel: false,
      createdAt: new Date(1_790_000_000_000).toISOString(),
      expiresAt: new Date(1_790_600_000_000).toISOString(),
    });
    expect(item.receipt?.technical).toEqual({ txHash: TX, explorerUrl: `https://testnet.monadexplorer.com/tx/${TX}` });
    expect(toAppActivity(row(), 10143).counterparty?.name).toBe("0x1111…2222");
  });

  it("prefers the server's row for the same tx and kind", () => {
    const indexed = [toAppActivity(row(), 10143), toAppActivity(row({ id: "other", txHash: "0x" + "cd".repeat(32) }), 10143)];
    const server: ActivityItem = { id: "srv-1", kind: "sent", status: "completed", amount: "20000000", counterparty: { name: "Mia Chen" }, createdAt: "2026-10-01T00:00:00.000Z", receipt: { reference: "R", amount: "20000000", at: "x", technical: { txHash: TX.toUpperCase().replace("0X", "0x") as `0x${string}`, explorerUrl: "e" } } };
    const merged = mergeServerItems(indexed, [server]);
    expect(merged.map((i) => i.id)).toEqual(["srv-1", "envio-other"]);
  });
});

describe("loadActivity", () => {
  it("uses the API when no indexer URL or account is set", async () => {
    const apiActivity = vi.fn(async () => apiPage());
    expect((await loadActivity({ account: ACCOUNT, chainId: 10143, apiActivity })).source).toBe("api");
    expect((await loadActivity({ account: null, indexerUrl: URL, chainId: 10143, apiActivity })).source).toBe("api");
  });

  it("reads the indexer and enriches the first page from the API", async () => {
    const apiActivity = vi.fn(async () => apiPage());
    const page = await loadActivity({ account: ACCOUNT, indexerUrl: URL, chainId: 10143, apiActivity, fetch: graphql([row()]) });
    expect(page.source).toBe("indexer");
    expect(page.items[0]?.id).toBe("envio-0xtx-3-sent");
    expect(page.nextCursor).toBeUndefined();
  });

  it("still serves the indexed feed if the API is down", async () => {
    const page = await loadActivity({ account: ACCOUNT, indexerUrl: URL, chainId: 10143, apiActivity: async () => { throw new Error("offline"); }, fetch: graphql([row()]) });
    expect(page.source).toBe("indexer");
    expect(page.items).toHaveLength(1);
  });

  it("falls back to the API on any indexer error", async () => {
    const apiActivity = vi.fn(async () => apiPage([{ id: "srv", kind: "received", status: "completed", amount: "1", createdAt: "x" }]));
    const onFallback = vi.fn();
    const failures = [
      vi.fn(async () => { throw new Error("network"); }),
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: "field not found" }] }) })),
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })),
    ];
    for (const fetch of failures) {
      const page = await loadActivity({ account: ACCOUNT, indexerUrl: URL, chainId: 10143, apiActivity, fetch, onFallback });
      expect(page.source).toBe("api");
      expect(page.items[0]?.id).toBe("srv");
    }
    expect(onFallback).toHaveBeenCalledTimes(failures.length);
  });

  it("keeps each source's pagination on that source", async () => {
    const apiActivity = vi.fn(async () => apiPage());
    const fetch = graphql([]);
    await loadActivity({ cursor: "server-cursor", account: ACCOUNT, indexerUrl: URL, chainId: 10143, apiActivity, fetch });
    expect(apiActivity).toHaveBeenCalledWith("server-cursor");
    expect(fetch).not.toHaveBeenCalled();

    const broken = vi.fn(async () => { throw new Error("network"); });
    await expect(loadActivity({ cursor: "envio:5.1", account: ACCOUNT, indexerUrl: URL, chainId: 10143, apiActivity, fetch: broken })).rejects.toThrow("network");
  });
});
