import type { Db } from "../db";

/** The slice of Durable Object SQLite storage this adapter uses (see cloudflare:workers DurableObjectStorage). */
export type SqlCursor = { toArray(): Record<string, unknown>[] };
export type DoStorage = {
  sql: { exec(query: string, ...bindings: unknown[]): SqlCursor };
  transactionSync<T>(fn: () => T): T;
};

const META = "_bilby_meta";
const USER_VERSION = /^\s*PRAGMA\s+user_version\s*(?:=\s*(\d+))?\s*;?\s*$/i;

/** node:sqlite accepts bigint and Uint8Array bindings; Durable Object SQL wants numbers/strings/ArrayBuffers. */
function bind(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (value instanceof Uint8Array) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return value;
}

function row(r: Record<string, unknown>): Record<string, unknown> {
  for (const k in r) if (r[k] instanceof ArrayBuffer) r[k] = new Uint8Array(r[k] as ArrayBuffer);
  return r;
}

/**
 * node:sqlite's DatabaseSync API (prepare().run/get/all, exec) on top of a Durable Object's SQLite storage, so the
 * server's repositories run unchanged. PRAGMA user_version (not available to Durable Objects) lives in a meta
 * table, and transactions go through storage.transactionSync (BEGIN/COMMIT statements are rejected there).
 */
export function durableObjectDb(storage: DoStorage): Db {
  const sql = storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS ${META} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const exec = (query: string, params: unknown[]) => sql.exec(query, ...params.map(bind));

  const userVersion = () =>
    Number((sql.exec(`SELECT value FROM ${META} WHERE key = 'user_version'`).toArray()[0]?.value as string) ?? 0);

  const db = {
    exec(query: string) {
      const pragma = USER_VERSION.exec(query);
      if (pragma?.[1] !== undefined) {
        sql.exec(`INSERT INTO ${META} (key, value) VALUES ('user_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, pragma[1]);
        return;
      }
      if (/^\s*PRAGMA\s+(journal_mode|foreign_keys|busy_timeout)\b/i.test(query)) return; // managed by the platform
      sql.exec(query);
    },
    prepare(query: string) {
      if (USER_VERSION.test(query)) return { get: () => ({ user_version: userVersion() }), all: () => [{ user_version: userVersion() }], run: () => ({ changes: 0, lastInsertRowid: 0 }) };
      return {
        get: (...params: unknown[]) => {
          const r = exec(query, params).toArray()[0];
          return r ? row(r) : undefined;
        },
        all: (...params: unknown[]) => exec(query, params).toArray().map(row),
        run: (...params: unknown[]) => {
          exec(query, params).toArray();
          const info = sql.exec("SELECT changes() AS changes, last_insert_rowid() AS id").toArray()[0]!;
          return { changes: Number(info.changes), lastInsertRowid: Number(info.id) };
        },
      };
    },
    transactionSync<T>(fn: () => T): T {
      return storage.transactionSync(fn);
    },
  };
  return db as unknown as Db;
}
