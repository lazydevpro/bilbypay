import { describe, expect, it } from "vitest";
import { BitrefillProvider, createGiftCardProvider, LasoProvider, MockGiftCardProvider } from "../src";
import type { GiftCardProvider } from "../src";

describe("MockGiftCardProvider", () => {
  it("has a deterministic US catalog with the demo brands and no Amazon", async () => {
    const p = new MockGiftCardProvider();
    const us = await p.catalog("us");
    const names = us.map((b) => b.name);
    for (const n of ["Starbucks", "Uber", "DoorDash", "Netflix", "Spotify", "Airbnb"]) expect(names).toContain(n);
    expect(names.some((n) => /amazon/i.test(n))).toBe(false);
    expect(us.length).toBeGreaterThanOrEqual(12);
    expect(us.every((b) => b.country === "US" && b.minAmount > 0n && b.maxAmount >= b.minAmount && b.logoUrl.startsWith("https://"))).toBe(true);
    expect(await new MockGiftCardProvider().catalog("US")).toEqual(us);
    expect((await p.catalog("IN")).map((b) => b.id)).toEqual(["uber", "netflix", "google-play"]);
  });

  it("quotes face value + fee and enforces amounts", async () => {
    const p = new MockGiftCardProvider();
    expect((await p.quote("starbucks", 25_000_000n)).price).toBe(25_000_000n);
    expect((await p.quote("uber", 25_000_000n)).price).toBe(25_500_000n);
    await expect(p.quote("netflix", 26_000_000n)).rejects.toThrow(/fixed amounts/);
    await expect(p.quote("uber", 5_000_000n)).rejects.toThrow(/between/);
    await expect(p.quote("amazon", 5_000_000n)).rejects.toThrow(/Unknown/);
  });

  it("purchases are idempotent and deterministic, with fake codes, PINs and barcodes", async () => {
    const p = new MockGiftCardProvider();
    const a = await p.purchase({ brandId: "starbucks", amount: 25_000_000n, idempotencyKey: "gift-1" });
    const b = await p.purchase({ brandId: "starbucks", amount: 25_000_000n, idempotencyKey: "gift-1" });
    expect(b).toEqual(a);
    expect(a.status).toBe("completed");
    expect(a.redemption?.pin).toMatch(/^\d{8}$/);
    expect(a.redemption?.barcode).toEqual({ format: "PDF417", value: a.redemption?.code });
    expect(await p.floatAvailable()).toBe(10_000_000_000n - 25_000_000n);
    const other = await new MockGiftCardProvider().purchase({ brandId: "starbucks", amount: 25_000_000n, idempotencyKey: "gift-1" });
    expect(other).toEqual(a);
    const netflix = await p.purchase({ brandId: "netflix", amount: 25_000_000n, idempotencyKey: "gift-2" });
    expect(netflix.redemption?.code).toMatch(/^DEMO-/);
    expect(netflix.redemption?.url).toContain("https://example.com/redeem/netflix");
    expect(await p.getPurchase(a.providerOrderId)).toEqual(a);
  });

  it("fails brand ids ending in -fail (configurable) without touching the float", async () => {
    const p = new MockGiftCardProvider({ includeFailBrand: true });
    expect((await p.catalog("US")).some((b) => b.id === "test-card-fail")).toBe(true);
    const f = await p.purchase({ brandId: "starbucks-fail", amount: 5_000_000n, idempotencyKey: "x" });
    expect(f.status).toBe("failed");
    expect(f.failureReason).toBeTruthy();
    expect(f.redemption).toBeUndefined();
    expect(await p.floatAvailable()).toBe(10_000_000_000n);
    const custom = new MockGiftCardProvider({ shouldFail: (id) => id === "uber" });
    expect((await custom.purchase({ brandId: "uber", amount: 20_000_000n, idempotencyKey: "y" })).status).toBe("failed");
  });

  it("fails when the float is too low, and supports async fulfilment", async () => {
    const low = new MockGiftCardProvider({ float: 10_000_000n });
    expect((await low.purchase({ brandId: "starbucks", amount: 25_000_000n, idempotencyKey: "z" })).status).toBe("failed");
    const slow = new MockGiftCardProvider({ asyncFulfilment: true });
    const first = await slow.purchase({ brandId: "starbucks", amount: 5_000_000n, idempotencyKey: "s" });
    expect(first.status).toBe("pending");
    expect((await slow.getPurchase(first.providerOrderId)).status).toBe("pending");
    expect((await slow.getPurchase(first.providerOrderId)).status).toBe("completed");
    expect((await slow.purchase({ brandId: "starbucks", amount: 5_000_000n, idempotencyKey: "s" })).status).toBe("completed");
  });
});

describe("createGiftCardProvider", () => {
  it("defaults to mock and builds each provider from env", () => {
    const check = (p: GiftCardProvider, name: string) => expect(p.name).toBe(name);
    check(createGiftCardProvider({}), "mock");
    const laso = createGiftCardProvider({ GIFT_PROVIDER: "laso", LASO_PRIVATE_KEY: `0x${"11".repeat(32)}`, BASE_RPC_URL: "http://127.0.0.1:1" });
    expect(laso).toBeInstanceOf(LasoProvider);
    const br = createGiftCardProvider({ GIFT_PROVIDER: "bitrefill", BITREFILL_API_ID: "a", BITREFILL_API_SECRET: "b" });
    expect(br).toBeInstanceOf(BitrefillProvider);
  });

  it("rejects bad configuration loudly", () => {
    expect(() => createGiftCardProvider({ GIFT_PROVIDER: "laso" })).toThrow(/LASO_PRIVATE_KEY/);
    expect(() => createGiftCardProvider({ GIFT_PROVIDER: "bitrefill" })).toThrow(/apiId/);
    expect(() => createGiftCardProvider({ GIFT_PROVIDER: "tremendous" })).toThrow(/Unknown GIFT_PROVIDER/);
  });
});
