import { getAddress, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { LasoProvider, MemoryIdempotencyStore, signStandardWebhook, verifyLasoWebhook } from "../src";
import { FakeLaso, type FakeLasoOptions, LASO_PAY_TO, USDC_BASE_DOMAIN } from "./fakes/laso";

const FLOAT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(FLOAT_KEY);

function setup(opts: FakeLasoOptions = {}, extra: Partial<ConstructorParameters<typeof LasoProvider>[0]> = {}) {
  let clock = Date.parse("2026-10-01T12:00:00Z");
  const now = () => clock;
  const laso = new FakeLaso({ now, ...opts });
  const store = new MemoryIdempotencyStore();
  const provider = new LasoProvider({
    account,
    baseUrl: "https://laso.test",
    fetch: laso.fetch,
    store,
    publicClient: laso.publicClient,
    now,
    ...extra,
  });
  return { laso, provider, store, now, advance: (ms: number) => (clock += ms) };
}

const paidRequests = (laso: FakeLaso) =>
  laso.log.filter((l) => l.path.startsWith("/order-gift-card") && (l.headers["payment-signature"] || l.headers["x-payment"]));

describe("LasoProvider catalog + quote", () => {
  it("signs in with SIWX, lists USD cards for the country with country-scoped ids", async () => {
    const { laso, provider } = setup();
    const brands = await provider.catalog("us");
    expect(laso.signers).toEqual([account.address]);
    expect(brands.map((b) => b.id)).toEqual(["starbucks:US", "uber:US", "netflix:US"]);
    const sb = brands[0]!;
    expect(sb).toMatchObject({ name: "Starbucks", country: "US", minAmount: 5_000_000n, maxAmount: 500_000_000n, feePercent: 4.8,
      logoUrl: "https://img.test/starbucks.png", artworkUrl: "https://img.test/starbucks.png" });
    expect(brands[2]!.denominations).toEqual([25_000_000n, 50_000_000n, 100_000_000n]);
    // Bearer token reused, no second sign-in.
    await provider.catalog("CA");
    expect(laso.signers).toHaveLength(1);
  });

  it("keeps products without artwork available and preserves the provider's image URL unchanged", async () => {
    const { provider } = setup({ products: [
      { laso_server_id: "with-art", name: "With artwork", currency: "USD", country: "US", min: 5, max: 100,
        product_image_url: "https://images.test/card.png?version=2&country=US" },
      { laso_server_id: "without-art", name: "Without artwork", currency: "USD", country: "US", min: 5, max: 100,
        product_image_url: null },
    ] });
    const brands = await provider.catalog("US");
    expect(brands).toHaveLength(2);
    expect(brands[0]!.artworkUrl).toBe("https://images.test/card.png?version=2&country=US");
    expect(brands[1]!.artworkUrl).toBeUndefined();
    expect(brands[1]!.logoUrl).toBe("");
  });

  it("quotes from the 402 challenge without paying", async () => {
    const { laso, provider } = setup();
    const q = await provider.quote("starbucks:US", 5_000_000n);
    expect(q).toMatchObject({ brandId: "starbucks:US", amount: 5_000_000n, price: 5_240_000n });
    expect(q.expiresAt).toBeInstanceOf(Date);
    expect(paidRequests(laso)).toHaveLength(0);
    await expect(provider.quote("netflix:US", 30_000_000n)).rejects.toThrow(/fixed amounts/);
  });
});

describe("LasoProvider purchase", () => {
  it("402 → signed PAYMENT-SIGNATURE → card with codes", async () => {
    const { laso, provider } = setup();
    const p = await provider.purchase({ brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-1" });
    expect(p).toEqual({ providerOrderId: "gc_1", status: "completed", redemption: { code: "CODE-1-XXXX", pin: "1234" } });
    expect(laso.settlements).toHaveLength(1);
    expect(laso.settlements[0]).toMatchObject({ from: account.address, value: 5_240_000n });
    expect(await provider.getPurchase("gc_1")).toEqual(p);
  });

  it("signs EIP-3009 over the USDC-on-Base domain ('USD Coin', v2, 8453) and recovers to the float", async () => {
    const { laso, provider } = setup();
    await provider.purchase({ brandId: "uber:US", amount: 25_000_000n, idempotencyKey: "gift-sig" });
    const header = JSON.parse(Buffer.from(laso.paymentHeadersSeen[0]!, "base64").toString());
    expect(header.x402Version).toBe(2);
    expect(header.accepted).toMatchObject({ scheme: "exact", network: "eip155:8453", payTo: LASO_PAY_TO, extra: { name: "USD Coin", version: "2" } });
    const a = header.payload.authorization;
    expect(Object.keys(a).sort()).toEqual(["from", "nonce", "to", "validAfter", "validBefore", "value"]);
    expect(typeof a.value).toBe("string");
    const signer = await recoverTypedDataAddress({
      domain: USDC_BASE_DOMAIN,
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
      signature: header.payload.signature,
    });
    expect(signer).toBe(account.address);
    expect(getAddress(a.to)).toBe(LASO_PAY_TO);
    expect(a.value).toBe("26200000");
  });

  it("supports x402 v1 challenges (JSON body, X-PAYMENT)", async () => {
    const { laso, provider } = setup({ x402Version: 1 });
    const p = await provider.purchase({ brandId: "starbucks:US", amount: 10_000_000n, idempotencyKey: "gift-v1" });
    expect(p.status).toBe("completed");
    expect(paidRequests(laso)[0]!.headers["x-payment"]).toBeTruthy();
  });

  it("is idempotent: the same key never pays twice", async () => {
    const { laso, provider } = setup();
    const input = { brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-2" };
    const [a, b] = await Promise.all([provider.purchase(input), provider.purchase(input)]);
    const c = await provider.purchase(input);
    expect(a).toEqual(b);
    expect(c).toEqual(a);
    expect(laso.settlements).toHaveLength(1);
    expect(paidRequests(laso)).toHaveLength(1);
  });

  it("resends the SAME signed payment after a network error, and completes", async () => {
    const { laso, provider } = setup({ dropBeforeSettle: 1 });
    const input = { brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-3" };
    const first = await provider.purchase(input);
    expect(first).toMatchObject({ status: "pending", providerOrderId: "pending:gift-3" });
    const second = await provider.getPurchase(first.providerOrderId);
    expect(second.status).toBe("completed");
    const sent = paidRequests(laso).map((l) => l.headers["payment-signature"]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(sent[1]);
    expect(laso.settlements).toHaveLength(1);
    // And the key now resolves to the completed card.
    expect(await provider.purchase(input)).toEqual(second);
  });

  it("settled-but-response-lost stays pending for review; never re-signs", async () => {
    const { laso, provider } = setup({ dropAfterSettle: 1 });
    const input = { brandId: "uber:US", amount: 20_000_000n, idempotencyKey: "gift-4" };
    expect((await provider.purchase(input)).status).toBe("pending");
    const again = await provider.purchase(input);
    expect(again.status).toBe("pending");
    expect(again.failureReason).toMatch(/checking with the provider/);
    expect(laso.settlements).toHaveLength(1);
    const headers = new Set(paidRequests(laso).map((l) => l.headers["payment-signature"]));
    expect(headers.size).toBe(1);
  });

  it("an expired, never-settled authorization becomes failed (safe to refund)", async () => {
    const { laso, provider, advance } = setup({ dropBeforeSettle: 1 });
    const first = await provider.purchase({ brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-5" });
    expect(first.status).toBe("pending");
    advance(10 * 60_000);
    const later = await provider.getPurchase(first.providerOrderId);
    expect(later).toMatchObject({ status: "failed" });
    expect(later.failureReason).toMatch(/cancelled/);
    expect(laso.settlements).toHaveLength(0);
  });

  it("maps a settlement failure to failed with a human reason", async () => {
    const { laso, provider } = setup({ failMode: "settlement" });
    const input = { brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-6" };
    const p = await provider.purchase(input);
    expect(p.status).toBe("failed");
    expect(p.failureReason).toBe("We couldn't complete this gift card purchase right now.");
    expect(p.redemption).toBeUndefined();
    await provider.purchase(input);
    expect(paidRequests(laso)).toHaveLength(1); // failed is final; no second attempt
  });

  it("unknown product → failed before any payment is signed", async () => {
    const { laso, provider } = setup();
    const p = await provider.purchase({ brandId: "amazon-usa:US", amount: 5_000_000n, idempotencyKey: "gift-7" });
    expect(p).toMatchObject({ status: "failed", failureReason: "This gift card isn't available right now." });
    expect(paidRequests(laso)).toHaveLength(0);
  });

  it("refuses to pay above the fee cap or above the accepted quote", async () => {
    const pricey = setup({ feePercent: 20 });
    const p = await pricey.provider.purchase({ brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-8" });
    expect(p.status).toBe("failed");
    expect(paidRequests(pricey.laso)).toHaveLength(0);

    const { laso, provider } = setup();
    const quote = { brandId: "starbucks:US", amount: 5_000_000n, price: 5_100_000n };
    const q = await provider.purchase({ brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-9", quote });
    expect(q).toMatchObject({ status: "failed", failureReason: "The price of this gift card just changed. Please try again." });
    expect(paidRequests(laso)).toHaveLength(0);
  });

  it("refuses an unexpected payTo", async () => {
    const { laso, provider } = setup({}, { allowedPayTo: ["0x000000000000000000000000000000000000dEaD"] });
    const p = await provider.purchase({ brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-10" });
    expect(p.status).toBe("failed");
    expect(paidRequests(laso)).toHaveLength(0);
  });

  it("survives a restart via the store (same store, new provider)", async () => {
    const { laso, store, now } = setup({ dropBeforeSettle: 1 });
    const mk = () => new LasoProvider({ account, baseUrl: "https://laso.test", fetch: laso.fetch, store, publicClient: laso.publicClient, now });
    const first = await mk().purchase({ brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-11" });
    expect(first.status).toBe("pending");
    const after = await mk().purchase({ brandId: "starbucks:US", amount: 5_000_000n, idempotencyKey: "gift-11" });
    expect(after.status).toBe("completed");
    expect(laso.settlements).toHaveLength(1);
  });

  it("reads the float as USDC balanceOf on Base", async () => {
    const { provider } = setup();
    expect(await provider.floatAvailable()).toBe(123_450_000n);
  });
});

describe("verifyLasoWebhook (Standard Webhooks)", () => {
  const secret = `whsec_${Buffer.from("super-secret-key-bytes").toString("base64")}`;
  const body = JSON.stringify({ type: "notification.giftCard", timestamp: "2026-10-01T12:00:00Z", data: { category: "giftCard", title: "Gift card" } });
  const ts = 1_790_000_000;

  it("accepts a valid signature and rejects tampering / stale timestamps", () => {
    const sig = signStandardWebhook(secret, "msg_1", ts, body);
    const headers = { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": `v1,bogus ${sig}` };
    expect(verifyLasoWebhook({ secret, headers, rawBody: body, now: ts }).type).toBe("notification.giftCard");
    expect(() => verifyLasoWebhook({ secret, headers, rawBody: body.replace("Gift", "Gilt"), now: ts })).toThrow(/signature/);
    expect(() => verifyLasoWebhook({ secret, headers, rawBody: body, now: ts + 3600 })).toThrow(/timestamp/);
  });
});
