import { describe, expect, it } from "vitest";
import { BitrefillProvider, MemoryIdempotencyStore, parseUsdBalance } from "../src";
import { FakeBitrefill } from "./fakes/bitrefill";

function setup(opts: Partial<ConstructorParameters<typeof BitrefillProvider>[0]> = {}) {
  const br = new FakeBitrefill();
  const store = new MemoryIdempotencyStore();
  const provider = new BitrefillProvider({
    apiId: "id",
    apiSecret: "secret",
    baseUrl: "https://bitrefill.test/v2",
    fetch: br.fetch,
    store,
    sleep: async () => {},
    ...opts,
  });
  return { br, provider, store };
}

describe("BitrefillProvider", () => {
  it("uses Basic auth for Business keys and Bearer for Personal keys", async () => {
    const { br, provider } = setup();
    await provider.floatAvailable();
    expect(br.log[0]!.auth).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    const personal = setup({ apiId: undefined, apiSecret: undefined, apiKey: "k" });
    await personal.provider.floatAvailable();
    expect(personal.br.log[0]!.auth).toBe("Bearer k");
  });

  it("maps the catalog: USD gift cards only, ranges vs fixed packages", async () => {
    const { provider } = setup();
    const brands = await provider.catalog("US");
    expect(brands.map((b) => b.id)).toEqual(["starbucks-usa", "netflix-usa"]);
    expect(brands[0]).toMatchObject({ name: "Starbucks USA", category: "food", minAmount: 5_000_000n, maxAmount: 500_000_000n,
      logoUrl: "https://cdn.bitrefill.com/primg/w250h100i1/starbucks-usa.png",
      artworkUrl: "https://cdn.bitrefill.com/primg/w600h400/starbucks-usa.png" });
    expect(brands[0]!.denominations).toBeUndefined();
    expect(brands[1]!.denominations).toEqual([25_000_000n, 50_000_000n]);
    const withTest = await setup({ includeTestProducts: true }).provider.catalog("US");
    expect(withTest.map((b) => b.id)).toContain("test-gift-card-code");
  });

  it("derives artwork from the exact product ID even when image is missing or only an image ID", async () => {
    const { br, provider } = setup();
    br.products[0]!.id = "merchant/US & cafe";
    br.products[0]!.image = "opaque-provider-image-id";
    br.products[1]!.image = undefined;
    const brands = await provider.catalog("US");
    expect(brands[0]!.artworkUrl).toBe("https://cdn.bitrefill.com/primg/w600h400/merchant%2FUS%20%26%20cafe.png");
    expect(brands[0]!.logoUrl).toBe("https://cdn.bitrefill.com/primg/w250h100i1/merchant%2FUS%20%26%20cafe.png");
    expect(brands[1]!.artworkUrl).toBe("https://cdn.bitrefill.com/primg/w600h400/netflix-usa.png");
  });

  it("quotes from the package USD price when listed, face value + fee otherwise", async () => {
    const { provider } = setup({ feePercent: 2 });
    expect((await provider.quote("netflix-usa", 50_000_000n)).price).toBe(51_000_000n);
    expect((await provider.quote("starbucks-usa", 5_000_000n)).price).toBe(5_030_000n);
    expect((await provider.quote("starbucks-usa", 12_340_000n)).price).toBe(12_586_800n);
    await expect(provider.quote("netflix-usa", 30_000_000n)).rejects.toThrow(/fixed amounts/);
  });

  it("creates a balance invoice without email, pays it, polls, and returns redemption_info incl. barcode", async () => {
    const { br, provider } = setup({ webhookUrl: "https://api.bilbypay.test/hooks/bitrefill" });
    br.deliveryPolls = 2;
    const p = await provider.purchase({ brandId: "starbucks-usa", amount: 25_000_000n, idempotencyKey: "g1" });
    expect(p).toEqual({
      providerOrderId: "inv_1",
      status: "completed",
      redemption: { code: "BR-ord_1-CODE", pin: "9876", barcode: { format: "CODE128", value: "123456789012" }, instructions: "Show at the till" },
    });
    const create = br.log.find((l) => l.method === "POST" && l.path === "/v2/invoices")!;
    expect(create.body).toEqual({
      products: [{ product_id: "starbucks-usa", value: 25, quantity: 1 }],
      payment_method: "balance",
      auto_pay: false,
      send_email: false,
      webhook_url: "https://api.bilbypay.test/hooks/bitrefill",
    });
    expect(br.pays).toBe(1);
    expect(await provider.getPurchase("inv_1")).toEqual(p);
  });

  it("auto_pay mode sends auto_pay:true and never calls /pay", async () => {
    const { br, provider } = setup({ autoPay: true });
    const p = await provider.purchase({ brandId: "starbucks-usa", amount: 5_000_000n, idempotencyKey: "g-auto" });
    expect(p.status).toBe("completed");
    expect(br.log.some((l) => l.path.endsWith("/pay"))).toBe(false);
    expect(br.log.find((l) => l.path === "/v2/invoices")!.body.auto_pay).toBe(true);
  });

  it("is idempotent on the key: one invoice, one payment", async () => {
    const { br, provider } = setup();
    const input = { brandId: "starbucks-usa", amount: 10_000_000n, idempotencyKey: "g2" };
    const [a, b] = await Promise.all([provider.purchase(input), provider.purchase(input)]);
    expect(b).toEqual(a);
    expect(await provider.purchase(input)).toEqual(a);
    expect(br.invoices.size).toBe(1);
    expect(br.pays).toBe(1);
  });

  it("a lost /pay response is recovered by reading the invoice, not paying again", async () => {
    const { br, provider } = setup();
    br.dropPayResponse = 1;
    const input = { brandId: "starbucks-usa", amount: 10_000_000n, idempotencyKey: "g3" };
    await expect(provider.purchase(input)).rejects.toThrow(/network error/);
    const p = await provider.purchase(input);
    expect(p.status).toBe("completed");
    expect(br.pays).toBe(1);
    expect(br.invoices.size).toBe(1);
  });

  it("stays pending while undelivered, then completes via getPurchase", async () => {
    const { br, provider } = setup({ pollAttempts: 1 });
    br.deliveryPolls = 5;
    const p = await provider.purchase({ brandId: "starbucks-usa", amount: 5_000_000n, idempotencyKey: "g4" });
    expect(p).toEqual({ providerOrderId: "inv_1", status: "pending" });
    let later = p;
    for (let i = 0; i < 5 && later.status === "pending"; i++) later = await provider.getPurchase(p.providerOrderId);
    expect(later.status).toBe("completed");
    expect(br.pays).toBe(1);
  });

  it("a failed order (test *-fail product) maps to failed with a human reason", async () => {
    const { provider } = setup({ includeTestProducts: true });
    const p = await provider.purchase({ brandId: "test-gift-card-code-fail", amount: 5_000_000n, idempotencyKey: "g5" });
    expect(p).toEqual({ providerOrderId: "inv_1", status: "failed", failureReason: "We couldn't complete this gift card purchase right now." });
  });

  it("insufficient balance and unknown products fail without a charge", async () => {
    const { br, provider } = setup();
    br.balanceUsd = 3;
    const poor = await provider.purchase({ brandId: "starbucks-usa", amount: 5_000_000n, idempotencyKey: "g6" });
    expect(poor.status).toBe("failed");
    expect(br.pays).toBe(0);
    const unknown = await provider.purchase({ brandId: "nope-usa", amount: 5_000_000n, idempotencyKey: "g7" });
    expect(unknown).toMatchObject({ status: "failed", failureReason: "This gift card isn't available right now." });
  });

  it("reads the USD float", async () => {
    const { provider } = setup();
    expect(await provider.floatAvailable()).toBe(100_000_000n);
  });

  it("parses the balance shapes we've seen", () => {
    expect(parseUsdBalance({ balance: 20, currency: "USD" })).toBe(20_000_000n);
    expect(parseUsdBalance({ balance: 20, currency: "EUR" })).toBeUndefined();
    expect(
      parseUsdBalance({
        balances: [
          { payment_method: "balance", balance_currency: "BTC", amount: "0.1", amount_base: 10_000_000, decimals: 8 },
          { payment_method: "cashback", balance_currency: "USD", amount: "9.00", amount_base: 900, decimals: 2 },
          { payment_method: "balance", balance_currency: "USD", amount: "12.34", amount_base: 1234, decimals: 2 },
        ],
      }),
    ).toBe(12_340_000n);
    expect(parseUsdBalance([{ currency: "USD", amount: "7.5" }])).toBe(7_500_000n);
  });
});
