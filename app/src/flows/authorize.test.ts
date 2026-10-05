import { describe, expect, it, vi } from "vitest";
import type { ActionRequest } from "../api/types";
import { MOCK_ESCROW, registerMockNumber, selectedRecipient, signedInMockApi } from "../testing/fixtures";
import { authorizeAndSubmit } from "./authorize";
import { SigningGuardError } from "../signing/guard";

type Ctx = Awaited<ReturnType<typeof signedInMockApi>>;

async function run(ctx: Ctx, request: ActionRequest, resolvedPayee?: `0x${string}`) {
  const prepared = await ctx.api.prepareAction(request);
  const unlock = vi.fn((fn) => fn(ctx.signer));
  const out = await authorizeAndSubmit({ api: ctx.api, request, prepared, account: ctx.address, chainId: 143, resolvedPayee, unlock, recipient: request.type === "send" || request.type === "gift_send" ? await selectedRecipient(ctx.api, request.params.phone) : undefined, readDirectory: ctx.api.readDirectory, escrow: MOCK_ESCROW });
  return { ...out, prepared, unlock };
}

describe("prepare → authorize → submit (demo API, real key)", () => {
  it("sends to a registered contact with one unlock", async () => {
    const ctx = await signedInMockApi();
    const { results } = await ctx.api.resolve(["+15555550101"]);
    const { result, unlock } = await run(ctx, { type: "send", params: { phone: "+15555550101", amount: "20000000", note: "Lunch" } }, results[0]!.address);
    expect(result.status).toBe("completed");
    expect(result.receipt?.reference).toMatch(/^BP-/);
    expect(unlock).toHaveBeenCalledOnce();
    expect((await ctx.api.balance()).balance).toBe("230000000");
  });

  it("is idempotent: resubmitting returns the first result without paying twice", async () => {
    const ctx = await signedInMockApi();
    const { results } = await ctx.api.resolve(["+15555550101"]);
    const { result, signatures, prepared } = await run(ctx, { type: "send", params: { phone: "+15555550101", amount: "20000000" } }, results[0]!.address);
    const again = await ctx.api.submitAction(prepared.id, signatures);
    expect(again).toEqual(result);
    expect((await ctx.api.balance()).balance).toBe("230000000");
  });

  it("never unlocks for a tampered action", async () => {
    const ctx = await signedInMockApi();
    const request: ActionRequest = { type: "send", params: { phone: "+15555550101", amount: "20000000" } };
    const prepared = await ctx.api.prepareAction(request);
    (prepared.toSign[0]!.typedData.message as Record<string, unknown>).to = "0x9999999999999999999999999999999999999999";
    const unlock = vi.fn((fn) => fn(ctx.signer));
    const { results } = await ctx.api.resolve(["+15555550101"]);
    await expect(
      authorizeAndSubmit({ api: ctx.api, request, prepared, account: ctx.address, chainId: 143, resolvedPayee: results[0]!.address, unlock }),
    ).rejects.toBeInstanceOf(SigningGuardError);
    expect(unlock).not.toHaveBeenCalled();
  });

  it("invites a new number, and the recipient opens it on another account", async () => {
    const sender = await signedInMockApi();
    const { result } = await run(sender, { type: "send", params: { phone: "+15555550177", amount: "15000000" } });
    expect(result.status).toBe("waiting");
    const code = result.claimLink!.split("/c/")[1]!;
    const claim = await sender.api.claim(code);
    expect(claim).toMatchObject({ kind: "money", amount: "15000000", status: "waiting", phoneMasked: "+1 •••• 0177" });

    // The same in-memory server, a second person registering the invited number.
    const other = await signedInMockApiSharing(sender, "+15555550177");
    const wrong = await other.api.otpVerify("+15555550188", "000000");
    await expect(other.api.acceptClaim(code, { phoneToken: wrong.phoneToken })).rejects.toMatchObject({ code: "WRONG_PHONE" });
    const right = await other.api.otpVerify("+15555550177", "000000");
    const accepted = await other.api.acceptClaim(code, { phoneToken: right.phoneToken });
    expect(accepted.status).toBe("completed");
    expect((await other.api.balance()).balance).toBe("265000000");
    await expect(other.api.acceptClaim(code, { phoneToken: right.phoneToken })).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });

    sender.setToken(senderToken);
    const { items } = await sender.api.activity();
    expect(items[0]).toMatchObject({ kind: "sent", status: "completed" });
  });

  it("cancels a waiting payment and refunds it", async () => {
    const ctx = await signedInMockApi();
    await run(ctx, { type: "send", params: { phone: "+15555550166", amount: "10000000" } });
    const waiting = (await ctx.api.activity()).items[0]!;
    expect(waiting.canCancel).toBe(true);
    const { result } = await run(ctx, { type: "cancel", params: { activityId: waiting.id } });
    expect(result.status).toBe("completed");
    expect((await ctx.api.balance()).balance).toBe("250000000");
  });

  it("buys a gift card and reveals it", async () => {
    const ctx = await signedInMockApi();
    const { result } = await run(ctx, { type: "gift_buy", params: { brandId: "starbucks-us", amount: "25000000" } });
    expect(result.giftCardId).toBeTruthy();
    const reveal = await ctx.api.revealGiftCard(result.giftCardId!);
    expect(reveal.code).toBeTruthy();
    expect((await ctx.api.giftCards()).cards).toHaveLength(1);
  });

  it("reports BURROW_BUSY with what's available now", async () => {
    const ctx = await signedInMockApi({ startingBalance: 900_000_000n });
    await run(ctx, { type: "burrow_add", params: { amount: "800000000" } });
    const err = await ctx.api.prepareAction({ type: "burrow_withdraw", params: { amount: "700000000" } }).catch((e) => e);
    expect(err.code).toBe("BURROW_BUSY");
    expect(err.details.availableNow).toBe("500000000");
    const { result } = await run(ctx, { type: "burrow_withdraw", params: { amount: "500000000" } });
    expect(result.status).toBe("completed");
  });

  it("auto-saves everything above the threshold", async () => {
    const ctx = await signedInMockApi({ startingBalance: 300_000_000n });
    await run(ctx, { type: "burrow_autosave", params: { enabled: true, threshold: "200000000" } });
    const b = await ctx.api.balance();
    expect(b.balance).toBe("200000000");
    expect(b.burrow.amount).toBe("100000000");
    expect((await ctx.api.me()).autoSave).toEqual({ enabled: true, threshold: "200000000" });
  });
});

let senderToken: string | null = null;
/** Registers a second person against the same demo server as `ctx`. */
async function signedInMockApiSharing(ctx: Ctx, phone: string) {
  const { privateKeyToAccount } = await import("viem/accounts");
  senderToken = ctx.getToken();
  const signer = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
  const reg = await registerMockNumber(ctx.api, signer, phone, "Invitee");
  ctx.setToken(reg.sessionToken);
  return { ...ctx, signer, address: signer.address };
}
