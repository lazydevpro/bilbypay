import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import type { ActionRequest } from "./types";
import { authorizeAndSubmit } from "../flows/authorize";
import { sessionMessage } from "../signing/messages";
import { MOCK_ESCROW, registerMockNumber, selectedRecipient, signedInMockApi } from "../testing/fixtures";
import { createMockApi } from "./mock";

type Ctx = Awaited<ReturnType<typeof signedInMockApi>>;
const run = async (ctx: Ctx, request: ActionRequest) => {
  const prepared = await ctx.api.prepareAction(request);
  return authorizeAndSubmit({ api: ctx.api, request, prepared, account: ctx.address, chainId: 143, unlock: (fn) => fn(ctx.signer), recipient: request.type === "send" || request.type === "gift_send" ? await selectedRecipient(ctx.api, request.params.phone) : undefined, readDirectory: ctx.api.readDirectory, escrow: MOCK_ESCROW });
};

describe("demo API matches the server's behaviour", () => {
  it("does not fabricate a provider checkout or credit a practice payment", async () => {
    const ctx = await signedInMockApi();
    const before = await ctx.api.balance();
    const activityBefore = await ctx.api.activity();
    await expect(ctx.api.fundingOptions()).resolves.toMatchObject({ environment: "sandbox", available: false, unavailableReason: "not_configured" });
    await expect(ctx.api.createFundingSession({ amount: "25000000", returnUrl: "https://bilbypay.example/funding", idempotencyKey: "attempt-1" })).rejects.toMatchObject({ code: "FUNDING_UNAVAILABLE" });
    await expect(ctx.api.fundingSession("invented-session")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await ctx.api.balance()).balance).toBe(before.balance);
    expect(await ctx.api.activity()).toEqual(activityBefore);
    ctx.setToken(null);
    await expect(ctx.api.fundingOptions()).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("answers PHONE_REQUIRED for a signed-in account without a number", async () => {
    let token: string | null = null;
    const onPhoneRequired = vi.fn();
    const api = createMockApi({ getToken: () => token, delayMs: 0, onPhoneRequired });
    const signer = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await signer.signMessage({ message: sessionMessage(signer.address, issuedAt) });
    const res = await api.session({ address: signer.address, issuedAt, signature });
    expect(res.profile).toBeNull();
    token = res.sessionToken;
    await expect(api.me()).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
    await expect(api.prepareAction({ type: "burrow_add", params: { amount: "1" } })).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
    expect(onPhoneRequired).toHaveBeenCalledTimes(2);
  });

  it("reports what can be paid now when Burrow is busy (balance + releasable)", async () => {
    const ctx = await signedInMockApi({ startingBalance: 1_000_000_000n });
    await run(ctx, { type: "burrow_add", params: { amount: "900000000" } });
    const err = await ctx.api.prepareAction({ type: "send", params: { phone: "+15555550101", amount: "700000000" } }).catch((e) => e);
    expect(err.code).toBe("BURROW_BUSY");
    expect(err.details.availableNow).toBe("600000000"); // $100 balance + $500 releasable
  });

  it("pays a gift to the balance when the chosen card is unavailable, and says so", async () => {
    const sender = await signedInMockApi();
    const { result } = await run(sender, { type: "gift_send", params: { phone: "+15555550155", brandId: null, amount: "25000000" } });
    const code = result.claimLink!.split("/c/")[1]!;
    const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    const registered = await registerMockNumber(sender.api, other, "+15555550155");
    sender.setToken(registered.sessionToken);
    const { phoneToken } = await sender.api.otpVerify("+15555550155", "000000");
    // A separately enrolled recipient opens the gift.
    const accepted = await sender.api.acceptClaim(code, { phoneToken, brandId: "airbnb-us" }).catch((e) => e);
    expect(accepted.status).toBe("completed");
    expect(accepted.giftCardId).toBeUndefined();
    expect(accepted.error.code).toBe("GIFT_UNAVAILABLE");
  });

  it("keeps merchant artwork through purchase and gift delivery", async () => {
    const ctx = await signedInMockApi();
    const brand = (await ctx.api.catalog()).brands.find((b) => b.id === "starbucks-us")!;
    expect(brand.artworkUrl).toMatch(/^https:\/\//);
    const bought = await run(ctx, { type: "gift_buy", params: { brandId: brand.id, amount: "25000000" } });
    expect((await ctx.api.giftCards()).cards.find((c) => c.id === bought.result.giftCardId)?.artworkUrl).toBe(brand.artworkUrl);
    const sent = await run(ctx, { type: "gift_send", params: { phone: "+15555550155", brandId: brand.id, amount: "25000000" } });
    const code = sent.result.claimLink!.split("/c/")[1]!;
    expect((await ctx.api.claim(code)).gift?.brandArtworkUrl).toBe(brand.artworkUrl);
    const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    const registered = await registerMockNumber(ctx.api, other, "+15555550155");
    ctx.setToken(registered.sessionToken);
    const { phoneToken } = await ctx.api.otpVerify("+15555550155", "000000");
    const accepted = await ctx.api.acceptClaim(code, { phoneToken });
    expect((await ctx.api.giftCards()).cards.find((c) => c.id === accepted.giftCardId)?.artworkUrl).toBe(brand.artworkUrl);
  });

  it("walks an add-money request from waiting to completed", async () => {
    let t = Date.now();
    const ctx = await signedInMockApi();
    const origins = await ctx.api.topupOrigins();
    expect(origins.origins.length).toBeGreaterThan(0);
    await expect(ctx.api.topupQuote(origins.origins[0]!.id, "10")).rejects.toMatchObject({ code: "AMOUNT_TOO_LOW" });
    const q = await ctx.api.topupQuote(origins.origins[0]!.id, "20000000");
    expect(BigInt(q.amountOut)).toBeLessThanOrEqual(20_000_000n);
    expect((await ctx.api.topupStatus(q.quoteId)).status).toBe("waiting");
    const spy = vi.spyOn(Date, "now").mockImplementation(() => (t += 60_000));
    try {
      const st = await ctx.api.topupStatus(q.quoteId);
      expect(st.status).toBe("completed");
      expect(BigInt((await ctx.api.balance()).balance)).toBe(250_000_000n + BigInt(q.amountOut));
    } finally {
      spy.mockRestore();
    }
  });
});
