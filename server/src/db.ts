import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/** Ordered migrations; PRAGMA user_version records how many have run. Append only. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    address TEXT PRIMARY KEY,               -- checksummed
    display_name TEXT,
    phone_e164 TEXT,
    phone_key TEXT,
    autosave_enabled INTEGER NOT NULL DEFAULT 0,
    autosave_threshold TEXT NOT NULL DEFAULT '0',
    burrow_net_deposited TEXT NOT NULL DEFAULT '0',  -- for "earned" = assets − net deposited
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Mirrors BilbyDirectory (we submit every bind) so resolve doesn't hit the chain per contact.
  CREATE TABLE phone_bindings (
    phone_key TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    bound_at TEXT NOT NULL,
    rebound_at TEXT,                        -- set when the number moved from another account
    previous_address TEXT
  );
  CREATE INDEX phone_bindings_address ON phone_bindings(address);

  CREATE TABLE otp_sessions (
    phone_e164 TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,            -- unix ms
    expires_at INTEGER NOT NULL
  );

  -- Sliding-window rate limits: one row per event.
  CREATE TABLE rate_events (
    bucket TEXT NOT NULL,                   -- e.g. "otp_start:phone:+1555…"
    at INTEGER NOT NULL,                    -- unix ms
    weight INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX rate_events_bucket ON rate_events(bucket, at);

  CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,                   -- prepared | submitting | completed | waiting | failed
    prepared TEXT NOT NULL,                 -- PreparedAction JSON (what the app got)
    state TEXT NOT NULL,                    -- server-private JSON (authorizations, terms, quote)
    result TEXT,                            -- ActionResult JSON, set once
    tx_hash TEXT,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,            -- unix ms
    submitted_at TEXT
  );
  CREATE INDEX actions_address_status ON actions(address, status);

  CREATE TABLE activity (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL,                  -- whose feed this is in
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    amount TEXT NOT NULL,
    counterparty_name TEXT,
    counterparty_phone_masked TEXT,
    note TEXT,
    gift_card_id TEXT,
    claim_code TEXT,
    expires_at TEXT,
    reference TEXT,
    tx_hash TEXT,
    action_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX activity_feed ON activity(address, seq);
  CREATE INDEX activity_claim ON activity(claim_code);

  CREATE TABLE claims (
    code TEXT PRIMARY KEY,
    deposit_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,                     -- money | gift
    status TEXT NOT NULL,                   -- waiting | claiming | opened | returned
    amount TEXT NOT NULL,                   -- what sits in escrow
    sender_address TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    phone_key TEXT NOT NULL,
    phone_masked TEXT NOT NULL,
    note TEXT,
    gift TEXT,                              -- JSON { brandId, brandName, brandLogoUrl, design, message, faceValue }
    gift_id TEXT,
    expiry INTEGER NOT NULL,                -- unix s, as committed in the escrow terms
    sender_activity_id TEXT NOT NULL,
    claimed_by TEXT,
    result TEXT,                            -- accept response JSON, for idempotent re-accepts
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX claims_status_expiry ON claims(status, expiry);
  CREATE INDEX claims_sender ON claims(sender_address, status);

  CREATE TABLE gift_orders (
    id TEXT PRIMARY KEY,                    -- giftCardId shown to the app
    gift_id TEXT NOT NULL UNIQUE,           -- one purchase per giftId, ever
    owner_address TEXT NOT NULL,
    source TEXT NOT NULL,                   -- buy | gift
    brand_id TEXT NOT NULL,
    brand_name TEXT NOT NULL,
    logo_url TEXT NOT NULL,
    face_value TEXT NOT NULL,
    paid TEXT NOT NULL,                     -- what the user (or sender) paid into the treasury
    provider TEXT NOT NULL,
    provider_order_id TEXT,
    status TEXT NOT NULL,                   -- processing | ready | failed
    redemption_enc TEXT,                    -- AES-256-GCM, see secrets.ts
    from_name TEXT,
    failure_reason TEXT,
    refund_to TEXT,
    refund_tx TEXT,                         -- 'sending' while in flight, then the hash
    activity_id TEXT,                       -- the owner's feed item for this card
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX gift_orders_owner ON gift_orders(owner_address, created_at);

  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function kvGet(db: Db, key: string): string | undefined {
  return (db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export function kvSet(db: Db, key: string, value: string) {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/**
 * Sliding-window limiter backed by SQLite. Returns false (and records nothing) when over `limit`.
 */
export function rateLimit(db: Db, bucket: string, limit: number, windowMs: number, weight = 1): boolean {
  const now = Date.now();
  return tx(db, () => {
    db.prepare("DELETE FROM rate_events WHERE bucket = ? AND at < ?").run(bucket, now - windowMs);
    const { used } = db.prepare("SELECT COALESCE(SUM(weight), 0) AS used FROM rate_events WHERE bucket = ?").get(bucket) as {
      used: number;
    };
    if (used + weight > limit) return false;
    db.prepare("INSERT INTO rate_events (bucket, at, weight) VALUES (?, ?, ?)").run(bucket, now, weight);
    return true;
  });
}
