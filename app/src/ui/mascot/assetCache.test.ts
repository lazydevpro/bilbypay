import { describe, expect, it, vi } from "vitest";
import { assetSourceKey, assetSourceUri, createAssetPrefetcher } from "./assetCache";

describe("mascot asset identity", () => {
  it("keeps a loaded URI ready when Fast Refresh recreates its source object", () => {
    const original = { uri: "/assets/wave.png", width: 2560, height: 2560 };
    const refreshed = { ...original };
    expect(refreshed).not.toBe(original);
    expect(assetSourceKey(refreshed)).toBe(assetSourceKey(original));
    expect(assetSourceKey({ ...original, uri: "/assets/wave-v2.png" })).not.toBe(assetSourceKey(original));
  });

  it("uses the resolved URI rather than a transient native registry number", () => {
    const resolver = vi.fn(() => ({ uri: "file:///bundle/run.png" }));
    expect(assetSourceKey(17, resolver)).toBe(assetSourceKey(28, resolver));
    expect(assetSourceUri(17, resolver)).toBe("file:///bundle/run.png");
    expect(assetSourceKey(17)).toBe("asset:17");
  });
});

describe("mascot asset prefetch", () => {
  it("deduplicates concurrent visits and reuses a successful request", async () => {
    const load = vi.fn(async () => true);
    const prefetch = createAssetPrefetcher(load);
    const first = prefetch("/run.png");
    expect(prefetch("/run.png")).toBe(first);
    await expect(first).resolves.toBe(true);
    await expect(prefetch("/run.png")).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("handles network failure without rejecting and retries on the next visit", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(true);
    const prefetch = createAssetPrefetcher(load);
    await expect(prefetch("/run.png")).resolves.toBe(false);
    await expect(prefetch("/run.png")).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("also retries when the platform reports an unsuccessful prefetch", async () => {
    const load = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const prefetch = createAssetPrefetcher(load);
    await expect(prefetch("/run.png")).resolves.toBe(false);
    await expect(prefetch("/run.png")).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
