import { randomBytes, randomInt } from "node:crypto";
import { formatUsd } from "@bilbypay/core";
import { bytesToHex, type Hex } from "viem";

// Crockford-style alphabet: no 0/O, 1/I/L, so references read cleanly over the phone.
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

function randomString(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export const newId = (prefix: string) => `${prefix}_${randomString(CODE_ALPHABET, 20)}`;
/** Claim codes are in public links: ~70 bits, unguessable, short enough for a URL preview. */
export const newClaimCode = () => randomString(CODE_ALPHABET, 12);
/** Human receipt reference, e.g. "BP-7K2Q-9XMA". */
export const newReference = () => `BP-${randomString(REF_ALPHABET, 4)}-${randomString(REF_ALPHABET, 4)}`;
export const randomBytes32 = (): Hex => bytesToHex(randomBytes(32));

export const nowIso = () => new Date().toISOString();
export const isoFromUnix = (seconds: number | bigint) => new Date(Number(seconds) * 1000).toISOString();

/** "$20" for whole dollars, "$20.50" otherwise — for share previews. */
export function formatUsdShort(amount: bigint): string {
  const s = formatUsd(amount);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

/** JSON that keeps bigints (tagged), for server-private state stored in SQLite. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v));
}

export function fromJson<T>(text: string): T {
  return JSON.parse(text, (_k, v) => (v && typeof v === "object" && typeof v.$big === "string" ? BigInt(v.$big) : v)) as T;
}

export const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
export const minBig = (a: bigint, b: bigint) => (a < b ? a : b);

/** Serializes async work per key (e.g. per user) inside this process. */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.tails.set(key, next);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }

  isLocked(key: string): boolean {
    return this.tails.has(key);
  }
}
