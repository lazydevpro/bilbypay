import { describe, expect, it } from "vitest";
import { classifyTransfer, type TransferInput } from "../src/lib/classify.js";
import {
  addToHistogram,
  average,
  claimRate,
  dayDate,
  dayIndex,
  emptyHistogram,
  histogramQuantile,
  holderDelta,
  latencyBucket,
  positionValue,
  sharePriceWad,
  WAD,
} from "../src/lib/stats.js";

describe("days", () => {
  it("buckets by UTC day", () => {
    expect(dayIndex(0)).toBe(0);
    expect(dayIndex(86_399)).toBe(0);
    expect(dayIndex(86_400)).toBe(1);
    expect(dayDate(dayIndex(1_790_000_000))).toBe("2026-09-21");
  });
});

describe("time-to-claim histogram", () => {
  it("assigns buckets by inclusive upper bound", () => {
    expect([0, 60, 61, 300, 3_600, 86_400, 31 * 86_400].map(latencyBucket)).toEqual([0, 0, 1, 1, 3, 5, 9]);
  });

  it("estimates quantiles by interpolating inside the bucket", () => {
    let h = emptyHistogram();
    expect(histogramQuantile(h, 0.5)).toBe(0);
    for (const s of [30, 45, 200, 250, 4_000]) h = addToHistogram(h, s);
    // 2 in (0,60], 2 in (60,300], 1 in (3600,21600]
    expect(h.slice(0, 5)).toEqual([2, 2, 0, 0, 1]);
    expect(histogramQuantile(h, 0.5)).toBe(120); // 2.5th of 5 -> a quarter into (60,300]
    expect(histogramQuantile(h, 0.9)).toBe(12_600); // halfway into (3600,21600]
    expect(histogramQuantile(addToHistogram(emptyHistogram(), 90 * 86_400), 0.5)).toBe(30 * 86_400);
  });

  it("repairs a stored histogram of the wrong size", () => {
    expect(addToHistogram([1, 2], 10)).toEqual([2, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("claim rate and averages", () => {
    expect(claimRate(0, 0, 0)).toBe(0);
    expect(claimRate(3, 1, 0)).toBe(0.75);
    expect(average(0n, 0)).toBe(0);
    expect(average(900n, 2)).toBe(450);
  });
});

describe("Burrow math", () => {
  it("prices shares and values positions", () => {
    expect(sharePriceWad(1_060_000n, 1_000_000n)).toBe(1_060_000_000_000_000_000n);
    expect(sharePriceWad(5n, 0n, 7n)).toBe(7n);
    expect(positionValue(10_000_000n, 10_460_000n, 1_060_000_000_000_000_000n)).toEqual({
      value: 10_600_000n,
      earned: 140_000n,
    });
    expect(positionValue(1n, 0n, WAD / 2n)).toEqual({ value: 0n, earned: 0n }); // rounds down
  });

  it("counts holders on 0 <-> positive transitions only", () => {
    expect([holderDelta(0n, 5n), holderDelta(5n, 0n), holderDelta(5n, 6n), holderDelta(0n, 0n)]).toEqual([1, -1, 0, 0]);
  });
});

describe("classifyTransfer", () => {
  const system = { escrow: "0xe5", router: "0x70", stata: "0x5a" };
  const base: TransferInput = {
    from: "0xa1",
    to: "0xb2",
    system,
    fromIsAccount: false,
    toIsAccount: false,
    toHasBurrowWithdrawalInTx: false,
  };
  const kind = (patch: Partial<TransferInput>) => classifyTransfer({ ...base, ...patch });

  it("payments between and around accounts", () => {
    expect(kind({ fromIsAccount: true, toIsAccount: true })).toEqual({ kind: "direct", fromUser: true, toUser: true });
    expect(kind({ fromIsAccount: true }).kind).toBe("external_out");
    expect(kind({ toIsAccount: true }).kind).toBe("external_in");
    expect(kind({ from: "0x0000000000000000000000000000000000000000", toIsAccount: true }).kind).toBe("external_in");
  });

  it("contract legs, even before the Account row exists", () => {
    expect(kind({ to: "0xE5" })).toEqual({ kind: "escrow_in", fromUser: true, toUser: false });
    expect(kind({ from: "0xe5" })).toEqual({ kind: "escrow_out", fromUser: false, toUser: true });
    expect(kind({ to: "0x70" }).kind).toBe("burrow_in");
    expect(kind({ to: "0x5a" }).kind).toBe("burrow_in");
    expect(kind({ from: "0x70" }).kind).toBe("burrow_out");
  });

  it("Aave payout after a share burn in the same tx is a Burrow withdrawal", () => {
    expect(kind({ toIsAccount: true, toHasBurrowWithdrawalInTx: true }).kind).toBe("burrow_out");
  });

  it("unattributed when neither side is known", () => {
    expect(kind({})).toEqual({ kind: "unattributed", fromUser: false, toUser: false });
  });

  it("a zero stata address (testnet) is not a contract", () => {
    const testnet = { ...system, stata: "0x0000000000000000000000000000000000000000" };
    expect(classifyTransfer({ ...base, system: testnet, to: testnet.stata, fromIsAccount: true }).kind).toBe("external_out");
  });
});
