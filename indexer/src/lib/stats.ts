// Pure aggregation helpers shared by the handlers. No envio imports, so they are unit-tested
// directly (test/stats.test.ts).

export const SECONDS_PER_DAY = 86_400;
export const WAD = 10n ** 18n;

/** Days since the unix epoch (UTC) for a unix-seconds timestamp. */
export function dayIndex(timestamp: number): number {
  return Math.floor(timestamp / SECONDS_PER_DAY);
}

/** "YYYY-MM-DD" (UTC) for a day index. Used as the DailyStats id. */
export function dayDate(day: number): string {
  return new Date(day * SECONDS_PER_DAY * 1000).toISOString().slice(0, 10);
}

// ------------------------------------------------------------ time to claim

/**
 * Upper bounds (inclusive, seconds) of the time-to-claim histogram buckets. The last bucket is
 * open-ended. Log-ish spacing: a claim link is usually opened in minutes, sometimes in days,
 * and the escrow's maximum expiry is 180 days.
 */
export const LATENCY_BUCKETS_SECONDS = [
  60, // 1 min
  300, // 5 min
  900, // 15 min
  3_600, // 1 h
  6 * 3_600, // 6 h
  SECONDS_PER_DAY, // 1 d
  3 * SECONDS_PER_DAY, // 3 d
  7 * SECONDS_PER_DAY, // 7 d
  30 * SECONDS_PER_DAY, // 30 d
] as const;

export const HISTOGRAM_SIZE = LATENCY_BUCKETS_SECONDS.length + 1;

export function emptyHistogram(): number[] {
  return new Array<number>(HISTOGRAM_SIZE).fill(0);
}

export function latencyBucket(seconds: number): number {
  const s = Math.max(0, seconds);
  const i = LATENCY_BUCKETS_SECONDS.findIndex((bound) => s <= bound);
  return i === -1 ? LATENCY_BUCKETS_SECONDS.length : i;
}

/** Returns a new histogram with one more observation. Tolerates a stored array of the wrong size. */
export function addToHistogram(histogram: readonly number[], seconds: number): number[] {
  const next = emptyHistogram();
  for (let i = 0; i < HISTOGRAM_SIZE; i++) next[i] = histogram[i] ?? 0;
  const bucket = latencyBucket(seconds);
  next[bucket] = (next[bucket] ?? 0) + 1;
  return next;
}

/**
 * Estimates the q-quantile (0..1) of the observations in a histogram by linear interpolation
 * inside the bucket that contains it. The open-ended last bucket reports its lower bound.
 * Returns 0 for an empty histogram.
 */
export function histogramQuantile(histogram: readonly number[], q: number): number {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const target = Math.min(Math.max(q, 0), 1) * total;
  let seen = 0;
  for (let i = 0; i < HISTOGRAM_SIZE; i++) {
    const count = histogram[i] ?? 0;
    if (count === 0) continue;
    if (seen + count >= target) {
      const lower = i === 0 ? 0 : LATENCY_BUCKETS_SECONDS[i - 1]!;
      const upper = LATENCY_BUCKETS_SECONDS[i];
      if (upper === undefined) return lower;
      const fraction = (target - seen) / count;
      return Math.round(lower + fraction * (upper - lower));
    }
    seen += count;
  }
  return LATENCY_BUCKETS_SECONDS[LATENCY_BUCKETS_SECONDS.length - 1]!;
}

/** claimed / (claimed + refunded + cancelled); 0 until something is resolved. */
export function claimRate(claimed: number, refunded: number, cancelled: number): number {
  const resolved = claimed + refunded + cancelled;
  return resolved === 0 ? 0 : claimed / resolved;
}

/** sum / count as a float; exact enough for seconds (sum is a BigInt to never overflow). */
export function average(sum: bigint, count: number): number {
  return count === 0 ? 0 : Number(sum) / count;
}

// -------------------------------------------------------------- Burrow math

/** assets per share scaled by 1e18. Keeps `fallback` when shares is zero. */
export function sharePriceWad(assets: bigint, shares: bigint, fallback: bigint = WAD): bigint {
  if (shares <= 0n) return fallback;
  return (assets * WAD) / shares;
}

/** Share -> AUSD at a WAD price, rounded down. */
export function sharesToAssets(shares: bigint, priceWad: bigint): bigint {
  return (shares * priceWad) / WAD;
}

/** Value and yield of a Burrow position at a price. */
export function positionValue(shares: bigint, netDeposited: bigint, priceWad: bigint) {
  const value = sharesToAssets(shares, priceWad);
  return { value, earned: value - netDeposited };
}

/** 0 -> positive / positive -> 0 transitions of a share balance, for "accounts with a Burrow". */
export function holderDelta(before: bigint, after: bigint): -1 | 0 | 1 {
  if (before <= 0n && after > 0n) return 1;
  if (before > 0n && after <= 0n) return -1;
  return 0;
}
