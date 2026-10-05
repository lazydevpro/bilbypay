import { afterEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { DirectoryCache, type DirectorySource } from "../src/directory-cache";
import { openDb, type Db } from "../src/db";

const DIRECTORY = `0x${"11".repeat(20)}` as Address;
const KEY = `0x${"22".repeat(32)}` as Hex;
const hash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const databases: Db[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const db = openDb(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE mirror (phone_key TEXT PRIMARY KEY, account TEXT NOT NULL, observed_block TEXT NOT NULL)");
  let head = 250n;
  let fork = 0n;
  let applyError = false;
  let resetCount = 0;
  const windows: Array<[bigint, bigint]> = [];
  const readBlocks: bigint[] = [];
  const source: DirectorySource<{ account: string }> = {
    finalizedBlock: async () => ({ number: head, hash: hash(head + fork), timestamp: 1_800_000_000n + head }),
    block: async (number) => ({ number, hash: hash(number + fork), timestamp: 1_800_000_000n + number }),
    changedPhoneKeys: async (from, to) => { windows.push([from, to]); return [KEY, KEY.toUpperCase().replace("0X", "0x") as Hex]; },
    bindingAt: async (_key, number) => { readBlocks.push(number); return { account: `account-${fork}-${number}` }; },
  };
  const options = {
    chainId: 10143,
    directory: DIRECTORY,
    startBlock: 100n,
    blockRange: 100,
    maxWindows: 1,
    applySnapshot: (snapshot: { phoneKey: Hex; binding: { account: string }; blockNumber: bigint }) => {
      db.prepare("INSERT INTO mirror VALUES (?, ?, ?) ON CONFLICT(phone_key) DO UPDATE SET account = excluded.account, observed_block = excluded.observed_block")
        .run(snapshot.phoneKey, snapshot.binding.account, snapshot.blockNumber.toString());
      if (applyError) throw new Error("simulated database failure");
    },
    resetMirror: () => { resetCount++; db.exec("DELETE FROM mirror"); },
  };
  return {
    db, source, options, windows, readBlocks,
    create: () => new DirectoryCache(db, source, options),
    head: (n: bigint) => { head = n; },
    fork: () => { fork += 1000n; },
    failApply: (value: boolean) => { applyError = value; },
    resets: () => resetCount,
    row: () => db.prepare("SELECT * FROM mirror").get(),
  };
}

describe("finalized directory reconciliation", () => {
  it("bounds inclusive windows, deduplicates keys and resumes after restart", async () => {
    const f = fixture();
    expect(await f.create().runOnce()).toEqual({ windows: 1, snapshots: 1, reset: false, caughtUp: false, nextBlock: 200n });
    expect(f.windows).toEqual([[100n, 199n]]);
    expect(f.readBlocks).toEqual([199n]);
    expect(await f.create().runOnce()).toEqual({ windows: 1, snapshots: 1, reset: false, caughtUp: true, nextBlock: 251n });
    expect(f.windows).toEqual([[100n, 199n], [200n, 250n]]);
    expect(f.row()).toMatchObject({ phone_key: KEY, observed_block: "250" });
    expect((await f.create().runOnce()).windows).toBe(0);
  });

  it("commits the mirror and cursor atomically, then safely retries", async () => {
    const f = fixture();
    f.failApply(true);
    await expect(f.create().runOnce()).rejects.toThrow("database failure");
    expect(f.row()).toBeUndefined();
    expect(f.db.prepare("SELECT * FROM kv").all()).toEqual([]);
    f.failApply(false);
    expect((await f.create().runOnce()).nextBlock).toBe(200n);
    expect(f.windows).toEqual([[100n, 199n], [100n, 199n]]);
  });

  it("detects a changed checkpoint and rebuilds only the directory mirror", async () => {
    const f = fixture();
    await f.create().runOnce();
    f.db.prepare("INSERT INTO accounts(address, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(DIRECTORY, "Keeps their balance", "now", "now");
    f.fork();
    const result = await f.create().runOnce();
    expect(result.reset).toBe(true);
    expect(f.resets()).toBe(1);
    expect(f.windows).toEqual([[100n, 199n], [100n, 199n]]);
    expect(f.row()).toMatchObject({ account: "account-1000-199" });
    expect(f.db.prepare("SELECT display_name FROM accounts").get()).toMatchObject({ display_name: "Keeps their balance" });
  });

  it("clears stale cache when finalized head regresses below deployment", async () => {
    const f = fixture();
    await f.create().runOnce();
    f.head(90n);
    expect(await f.create().runOnce()).toMatchObject({ reset: true, windows: 0, caughtUp: true, nextBlock: 100n });
    expect(f.row()).toBeUndefined();
  });

  it("rejects an unstable window before updating either mirror or cursor", async () => {
    const f = fixture();
    const original = f.source.bindingAt;
    f.source.bindingAt = async (...args) => { const binding = await original(...args); f.fork(); return binding; };
    await expect(f.create().runOnce()).rejects.toThrow("chain changed");
    expect(f.row()).toBeUndefined();
    expect(f.db.prepare("SELECT * FROM kv").all()).toEqual([]);
  });

  it("fails closed when finalized reads are unavailable and shares overlapping runs", async () => {
    const f = fixture();
    f.source.finalizedBlock = async () => { throw new Error("unsupported finalized tag"); };
    const cache = f.create();
    const run = cache.runOnce();
    expect(cache.runOnce()).toBe(run);
    await expect(run).rejects.toThrow("unsupported finalized");
    expect(f.windows).toEqual([]);
    expect(f.row()).toBeUndefined();
  });
});
