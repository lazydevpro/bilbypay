import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderQueriesModule } from "../scripts/embed-queries.mjs";
import {
  burrowSummary,
  createIndexerClient,
  decodeCursor,
  directoryStatus,
  encodeCursor,
  recentlyChanged,
  toActivityItem,
  type ActivityRow,
  type PhoneRow,
} from "../src/client.js";
import { INDEXER_QUERIES } from "../src/queries.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const graphql = readFileSync(join(root, "queries/activity.graphql"), "utf8");
const schema = readFileSync(join(root, "schema.graphql"), "utf8");

describe("queries", () => {
  it("src/queries.ts is generated from queries/activity.graphql (run `pnpm queries`)", () => {
    expect(readFileSync(join(root, "src/queries.ts"), "utf8")).toBe(renderQueriesModule(graphql));
  });

  // Offline stand-in for running the documents against Hasura: every field selected on an
  // entity must exist in schema.graphql (entity references are exposed as <field>_id).
  it("selects only fields that exist on the schema entities", () => {
    const fieldsOf = new Map<string, Set<string>>();
    for (const [, name, body] of schema.matchAll(/^type (\w+)[^{]*\{([^}]*)\}/gm)) {
      const fields = new Set<string>(["chainId"]);
      for (const [, field, type] of body!.matchAll(/^\s+(\w+):\s*\[?(\w+)/gm)) {
        fields.add(field!);
        if (/^[A-Z]/.test(type!) && !["ID", "String", "Int", "BigInt", "Float", "Boolean"].includes(type!)) fields.add(`${field}_id`);
      }
      fieldsOf.set(name!, fields);
    }

    const unknown: string[] = [];
    const checked: string[] = [];
    // Top-level selections look like `Entity(args) {` followed by one field per line.
    for (const match of INDEXER_QUERIES.matchAll(/^ {2}(\w+)(?:\([^()]*\))? \{\n([^]*?)\n {2}\}/gm)) {
      const [, entity, selection] = match;
      checked.push(entity!);
      if (entity === "_meta") continue;
      const known = fieldsOf.get(entity!);
      if (!known) {
        unknown.push(entity!);
        continue;
      }
      for (const line of selection!.split("\n")) {
        const field = line.trim();
        if (field && !known.has(field)) unknown.push(`${entity}.${field}`);
      }
    }
    expect(unknown).toEqual([]);
    expect(checked).toEqual([
      "ActivityItem",
      "Account",
      "BurrowPosition",
      "GlobalStats",
      "ContactEdge",
      "Phone",
      "DirectoryChange",
      "GlobalStats",
      "DailyStats",
      "_meta",
    ]);
    expect([...INDEXER_QUERIES.matchAll(/^query (\w+)/gm)].map((m) => m[1])).toEqual([
      "ActivityFeed",
      "AccountSummary",
      "RecentContacts",
      "PhoneStatus",
      "DirectoryChanges",
      "ProtocolStats",
    ]);
  });
});

const row = (patch: Partial<ActivityRow>): ActivityRow => ({
  id: "dep-0x01",
  kind: "sent",
  status: "waiting",
  amount: "5000000",
  counterparty: null,
  counterpartyAccount_id: null,
  counterpartyPhoneKey: "0xbb",
  deposit_id: "0x01",
  giftId: null,
  expiresAt: 1_790_086_400,
  createdAt: 1_790_000_000,
  updatedAt: 1_790_000_000,
  blockNumber: 12,
  logIndex: 3,
  txHash: "0xabc",
  ...patch,
});

describe("mapping to docs/api.md ActivityItem", () => {
  it("waiting escrow send: cancellable, with expiry and the phone it went to", () => {
    expect(toActivityItem(row({}))).toEqual({
      id: "dep-0x01",
      kind: "sent",
      status: "waiting",
      amount: "5000000",
      counterparty: { address: undefined, isBilbyUser: false, phoneKey: "0xbb" },
      depositId: "0x01",
      giftId: undefined,
      canCancel: true,
      expiresAt: "2026-09-22T14:13:20.000Z",
      createdAt: "2026-09-21T14:13:20.000Z",
      txHash: "0xabc",
    });
  });

  it("completed receive from another user", () => {
    const item = toActivityItem(
      row({ kind: "received", status: "completed", counterparty: "0xa11c", counterpartyAccount_id: "0xa11c", counterpartyPhoneKey: null, expiresAt: null }),
    );
    expect([item.canCancel, item.counterparty, item.expiresAt]).toEqual([
      false,
      { address: "0xa11c", isBilbyUser: true, phoneKey: undefined },
      undefined,
    ]);
  });

  it("cursors", () => {
    expect(encodeCursor({ blockNumber: 12, logIndex: 3 })).toBe("12.3");
    expect(decodeCursor("12.3")).toEqual({ block: 12, log: 3 });
    expect(decodeCursor(undefined).block).toBe(2_147_483_647);
    expect(() => decodeCursor("nope")).toThrow();
  });

  it("burrow summary and rebind warning", () => {
    const price = 1_060_000_000_000_000_000n;
    expect(burrowSummary({ shares: "10000000", netDeposited: "10460000" } as never, price)).toMatchObject({
      amount: 10_600_000n,
      earned: 140_000n,
    });
    expect(burrowSummary({ shares: "1000000", netDeposited: "2000000" } as never, price).earned).toBe(0n);
    expect(burrowSummary(undefined, price).amount).toBe(0n);

    const phone = { id: "0xbb", account_id: "0xca01", boundAt: 1_000, rebindCount: 1, lastReboundAt: 1_000 };
    expect(recentlyChanged(phone, 1_000 + 3_600, 86_400)).toBe(true);
    expect(recentlyChanged(phone, 1_000 + 90_000, 86_400)).toBe(false);
    expect(recentlyChanged({ ...phone, lastReboundAt: null }, 1_100, 86_400)).toBe(false);
  });
});

describe("client", () => {
  it("treats expiry and live recovery as non-resolving without requiring another event", () => {
    const phone = { account_id: "0xa11c", revision: "5", validUntil: 2000, revoked: false, pendingAccount: null, pendingExpiresAt: null } as PhoneRow;
    expect(directoryStatus(undefined, 1000)).toBe("unregistered");
    expect(directoryStatus(phone, 1999)).toBe("active");
    expect(directoryStatus(phone, 2000)).toBe("expired");
    expect(directoryStatus({ ...phone, revoked: true }, 1000)).toBe("revoked");
    const pending = { ...phone, pendingAccount: "0xb0b", pendingExpiresAt: 1500 };
    expect(directoryStatus(pending, 1500)).toBe("pending");
    expect(directoryStatus(pending, 1501)).toBe("active");
  });

  it("queries lifecycle changes with bounded ascending cursor and configured authentication", async () => {
    let observed: { headers: Record<string, string>; body: string } | undefined;
    const client = createIndexerClient({
      url: "https://indexer.test/v1/graphql", chainId: 10143, headers: { authorization: "Bearer test-only" },
      fetch: async (_url, init) => { observed = init; return { ok: true, status: 200, json: async () => ({ data: { DirectoryChange: [] } }) }; },
    });
    expect(await client.directoryChanges({ afterBlock: 100, afterLog: 3, toBlock: 150, limit: 20 })).toEqual([]);
    expect(JSON.parse(observed!.body)).toMatchObject({ operationName: "DirectoryChanges", variables: { chainId: 10143, afterBlock: 100, afterLog: 3, toBlock: 150, limit: 20 } });
    expect(observed!.headers.authorization).toBe("Bearer test-only");
  });

  it("sends the named operation with chainId and paginates", async () => {
    const calls: Array<{ url: string; body: { operationName: string; variables: Record<string, unknown>; query: string } }> = [];
    const client = createIndexerClient({
      url: "http://indexer.test/v1/graphql",
      chainId: 143,
      fetch: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { ActivityItem: [row({}), row({ id: "x", blockNumber: 10, logIndex: 0 })] } }),
        };
      },
    });

    const page = await client.activity("0xA11C", { limit: 2 });
    expect(page.items.map((i) => i.id)).toEqual(["dep-0x01", "x"]);
    expect(page.nextCursor).toBe("10.0");
    expect(calls[0]!.body.operationName).toBe("ActivityFeed");
    expect(calls[0]!.body.variables).toEqual({
      chainId: 143,
      account: "0xa11c",
      limit: 2,
      beforeBlock: 2_147_483_647,
      beforeLog: 2_147_483_647,
    });
    expect(calls[0]!.body.query).toBe(INDEXER_QUERIES);
  });

  it("surfaces GraphQL errors", async () => {
    const client = createIndexerClient({
      url: "http://indexer.test/v1/graphql",
      chainId: 143,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: "field not found" }] }) }),
    });
    await expect(client.phone("0xbb")).rejects.toThrow(/PhoneStatus: field not found/);
  });
});
