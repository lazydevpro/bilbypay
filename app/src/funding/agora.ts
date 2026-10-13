import type { AgoraMetrics } from "../api/types";

/** 187_063_472_246_883n (6-decimal base units) → "$187.1 million". Whole dollars below a million. */
export function compactDollars(base: string): string | null {
  let v: bigint;
  try { v = BigInt(base); } catch { return null; }
  if (v <= 0n) return null;
  const dollars = v / 1_000_000n;
  const scaled = (unit: bigint, word: string) => {
    const tenths = (dollars * 10n) / unit;
    const whole = tenths / 10n;
    const frac = tenths % 10n;
    return `$${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""} ${word}`;
  };
  if (dollars >= 1_000_000_000n) return scaled(1_000_000_000n, "billion");
  if (dollars >= 1_000_000n) return scaled(1_000_000n, "million");
  return `$${dollars.toLocaleString("en-US")}`;
}

/**
 * One quiet line for Add money: where BilbyPay dollars come from, fed by Agora's public supply figures.
 * Returns null (show nothing) when the figures are missing, so the screen never shows a made-up number.
 */
export function agoraLine(m: AgoraMetrics | null | undefined): string | null {
  if (!m || m.source !== "agora") return null;
  const amount = compactDollars(m.circulatingSupply ?? m.home?.circulatingSupply ?? "");
  if (!amount) return null;
  return m.circulatingSupply
    ? `Your dollars are issued by Agora, with ${amount} in use worldwide.`
    : `Your dollars are issued by Agora, with ${amount} in use on BilbyPay's network.`;
}
