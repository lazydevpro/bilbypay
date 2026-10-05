import { afterEach, describe, expect, it } from "vitest";
import type { Deployment } from "@bilbypay/core";
import { assertDirectoryConfig } from "../src/directory-config";
import { openDb, type Db } from "../src/db";

const directory = "0x0000000000000000000000000000000000000011";
const escrow = "0x0000000000000000000000000000000000000022";
const deployment: Deployment = { chainId: 10143, directory, escrow, router: directory, ausd: directory, stata: directory };
const config = { chainId: 10143, deployment, phonePepper: "test-only-private-pepper" };
const databases: Db[] = [];
const fresh = () => { const db = openDb(":memory:"); databases.push(db); return db; };
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("directory database deployment guard", () => {
  it("scopes an empty database and accepts matching restarts without storing the secret", () => {
    const db = fresh();
    assertDirectoryConfig(db, config);
    assertDirectoryConfig(db, config);
    const rows = db.prepare("SELECT * FROM kv").all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(config.phonePepper);
    db.prepare("INSERT INTO accounts(address, created_at, updated_at) VALUES (?, ?, ?)").run(directory, "now", "now");
    expect(() => assertDirectoryConfig(db, config)).not.toThrow();
  });

  it.each(["chain", "directory", "escrow"] as const)("rejects changed %s without modifying the original scope", (field) => {
    const db = fresh();
    assertDirectoryConfig(db, config);
    const before = db.prepare("SELECT value FROM kv").get();
    const changed = field === "chain"
      ? { ...config, chainId: 143, deployment: { ...deployment, chainId: 143 } }
      : { ...config, deployment: { ...deployment, [field]: "0x0000000000000000000000000000000000000033" } };
    expect(() => assertDirectoryConfig(db, changed)).toThrow("different directory deployment");
    expect(db.prepare("SELECT value FROM kv").get()).toEqual(before);
  });

  it("refuses pepper changes even when no user has enrolled yet", () => {
    const db = fresh();
    assertDirectoryConfig(db, config);
    expect(() => assertDirectoryConfig(db, { ...config, phonePepper: "different-private-value" })).toThrow("PHONE_PEPPER differs");
  });

  it("refuses a populated unscoped v1 database without deleting accounts", () => {
    const db = fresh();
    db.prepare("INSERT INTO accounts(address, created_at, updated_at) VALUES (?, ?, ?)").run(directory, "now", "now");
    expect(() => assertDirectoryConfig(db, config)).toThrow("drain existing payments");
    expect(db.prepare("SELECT address FROM accounts").get()).toMatchObject({ address: directory });
    expect(db.prepare("SELECT * FROM kv").all()).toEqual([]);
  });

  it("rejects existing reconciliation/checkpoint metadata without a deployment scope", () => {
    const db = fresh();
    db.prepare("INSERT INTO kv VALUES (?, ?)").run("old-checkpoint", "1000");
    expect(() => assertDirectoryConfig(db, config)).toThrow("no directory v2 scope");
    expect(db.prepare("SELECT * FROM kv").all()).toHaveLength(1);
  });
});
