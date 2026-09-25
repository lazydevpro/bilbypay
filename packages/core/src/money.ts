import { formatUnits, parseUnits } from "viem";

export const USD_DECIMALS = 6;

/** "12.5" → 12_500_000n. Throws on more than 6 decimals or negative input. */
export function parseUsd(input: string): bigint {
  const trimmed = input.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{0,6})?$/.test(trimmed)) throw new Error(`Invalid dollar amount: ${input}`);
  return parseUnits(trimmed, USD_DECIMALS);
}

/** 12_500_000n → "$12.50". Rounds down to cents for display. */
export function formatUsd(amount: bigint): string {
  const cents = amount / 10_000n;
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${frac}`;
}

export { formatUnits };
