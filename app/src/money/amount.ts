import { formatUsd, parseUsd } from "@bilbypay/core";

/** Base-unit string ("12500000") → "$12.50". Bad input shows $0.00 rather than crashing a screen. */
export function usd(base: string | bigint | undefined | null): string {
  if (base === undefined || base === null || base === "") return "$0.00";
  try {
    const v = typeof base === "bigint" ? base : BigInt(base);
    return v < 0n ? `-${formatUsd(-v)}` : formatUsd(v);
  } catch {
    return "$0.00";
  }
}

/** Like `usd` but drops ".00" for round amounts: "$20", "$20.50". */
export function usdShort(base: string | bigint): string {
  const s = usd(base);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

/** Never show a negative "earned". */
export function clampZero(base: string | undefined): string {
  try {
    return base && BigInt(base) > 0n ? base : "0";
  } catch {
    return "0";
  }
}

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

export const MAX_WHOLE_DIGITS = 7;

/**
 * Applies one keypad press to the typed amount ("" means nothing typed).
 * Dollars and cents only: at most 2 decimals, no leading zeros, at most 7 whole digits.
 */
export function pressKey(current: string, key: KeypadKey): string {
  if (key === "back") return current.slice(0, -1);
  if (key === ".") {
    if (current.includes(".")) return current;
    return current === "" ? "0." : `${current}.`;
  }
  const [whole = "", frac] = current.split(".");
  if (frac !== undefined) return frac.length >= 2 ? current : `${current}${key}`;
  if (whole === "0") return key;
  if (whole.length >= MAX_WHOLE_DIGITS) return current;
  return `${current}${key}`;
}

/** Typed amount → base-unit string; "0" for empty or partial input like "0.". */
export function typedToBase(typed: string): string {
  if (!typed || typed === ".") return "0";
  const clean = typed.endsWith(".") ? typed.slice(0, -1) : typed;
  try {
    return parseUsd(clean || "0").toString();
  } catch {
    return "0";
  }
}

/** Base units → keypad string ("12500000" → "12.5"), for prefilling the keypad. */
export function baseToTyped(base: string): string {
  const s = usd(base).replace(/[$,]/g, "");
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** "$1,234.5" style rendering of what the user is typing (keeps a trailing "." or "0"). */
export function displayTyped(typed: string): string {
  if (!typed) return "$0";
  const [whole = "0", frac] = typed.split(".");
  const grouped = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? `$${grouped}` : `$${grouped}.${frac}`;
}

export function isPositive(base: string): boolean {
  try {
    return BigInt(base) > 0n;
  } catch {
    return false;
  }
}
