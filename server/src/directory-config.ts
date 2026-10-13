import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress } from "viem";
import type { Config } from "./config";
import { type Db, kvGet, kvSet, tx } from "./db";

const SCOPE_KEY = "directory-config:v2";
const PEPPER_SENTINEL = "BilbyPay directory phone derivation configuration v2";
type Scope = { version: 2; chainId: number; directory: string; escrow: string; pepperCheck: string };

/**
 * Bind one database to one directory/escrow deployment and one phone derivation secret.
 * Run immediately after openDb, before services start. This is a refusal guard, not a v1
 * migration: old claims must remain with their original contracts and original database.
 */
export function assertDirectoryConfig(db: Db, config: Pick<Config, "chainId" | "deployment" | "phonePepper">): void {
  if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0 || config.deployment.chainId !== config.chainId || !config.phonePepper) {
    throw new Error("Invalid directory database configuration");
  }
  const expected: Scope = {
    version: 2,
    chainId: config.chainId,
    directory: getAddress(config.deployment.directory).toLowerCase(),
    escrow: getAddress(config.deployment.escrow).toLowerCase(),
    // A private, domain-separated consistency check. Never store the pepper or any phone here.
    pepperCheck: createHmac("sha256", config.phonePepper).update(PEPPER_SENTINEL).digest("hex"),
  };
  tx(db, () => {
    const stored = kvGet(db, SCOPE_KEY);
    if (stored) {
      let scope: Partial<Scope>;
      try { scope = JSON.parse(stored) as Partial<Scope>; }
      catch { throw new Error("Invalid directory database scope; restore the matching database configuration"); }
      if (!scope || scope.version !== 2 || scope.chainId !== expected.chainId || scope.directory !== expected.directory || scope.escrow !== expected.escrow) {
        throw new Error("This database belongs to a different directory deployment. Keep its original configuration and use a new DATABASE_PATH for v2.");
      }
      if (typeof scope.pepperCheck !== "string" || !/^[a-f0-9]{64}$/.test(scope.pepperCheck) ||
        !timingSafeEqual(Buffer.from(scope.pepperCheck, "hex"), Buffer.from(expected.pepperCheck, "hex"))) {
        throw new Error("PHONE_PEPPER differs from this database's identity configuration. Restore the original secret; rotation requires an explicit migration plan.");
      }
      return;
    }

    // Treat every application row as evidence of an existing deployment. Merely adding the
    // latest SQLite schema does not migrate on-chain bindings or pending escrow payments.
    // Skips platform/internal tables: "_bilby_meta" (Durable Object adapter) and Cloudflare's unreadable "__cf_kv".
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'").all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      if (db.prepare(`SELECT 1 AS present FROM ${quoted} LIMIT 1`).get()) {
        throw new Error("Populated database has no directory v2 scope. Keep the v1 database and deployment to drain existing payments; use a new DATABASE_PATH for v2.");
      }
    }
    kvSet(db, SCOPE_KEY, JSON.stringify(expected));
  });
}
