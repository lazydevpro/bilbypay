import { formatUnits, parseUnits } from "viem";
import type { IdempotencyStore } from "./types";

export const USD_DECIMALS = 6;

/**
 * Converts a provider decimal (number or string, e.g. 5, "5.03", 5.03) to USD base units.
 * Numbers are rounded to 6 decimals first so float noise (5.0300000001) can't throw.
 */
export function toUnits(value: number | string): bigint {
  const text = typeof value === "number" ? value.toFixed(USD_DECIMALS) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Not a decimal amount: ${String(value)}`);
  const [whole, frac = ""] = text.split(".");
  return parseUnits(`${whole}.${frac.slice(0, USD_DECIMALS) || "0"}`, USD_DECIMALS);
}

/** 5_250_000n → "5.25", 5_000_000n → "5". What providers expect in query strings / JSON. */
export function fromUnits(amount: bigint): string {
  return formatUnits(amount, USD_DECIMALS);
}

/** ceil(amount * (100 + percent) / 100) in base units; percent may have up to 4 decimals. */
export function addPercent(amount: bigint, percent: number): bigint {
  const bps = BigInt(Math.round(percent * 10_000)); // 1% = 10_000
  return (amount * (1_000_000n + bps) + 999_999n) / 1_000_000n;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<unknown | undefined> {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  }
  async set(key: string, value: unknown): Promise<void> {
    // Round-trip through JSON so callers can't rely on non-serialisable values.
    this.map.set(key, JSON.stringify(value));
  }
}

/** Serialises async work per key inside one process. */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

/** Thrown for transport/5xx problems where nothing was paid; safe for the caller to retry. */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderUnavailableError";
  }
}

export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Picks a short, code-free error message out of a provider error body. */
export function errorText(body: unknown): string | undefined {
  if (typeof body === "string") return body.slice(0, 200) || undefined;
  if (!isRecord(body)) return undefined;
  for (const k of ["message", "error", "errorMessage", "detail", "errorReason"]) {
    const v = body[k];
    if (typeof v === "string" && v) return v.slice(0, 200);
    if (isRecord(v) && typeof v.message === "string") return v.message.slice(0, 200);
  }
  return undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
