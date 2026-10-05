import { describe, expect, it, vi } from "vitest";
import type { ActionRequest } from "../api/types";
import { authorizeAndSubmit } from "../flows/authorize";
import { MOCK_ESCROW, selectedRecipient, signedInMockApi } from "../testing/fixtures";
import { RecipientCheckError, verifySelectedRecipient } from "./verification";

const request: ActionRequest = { type: "send", params: { phone: "+15555550101", amount: "1000000" } };
describe("independent recipient verification", () => {
  it.each(["account", "revision", "ownershipEpoch", "expired", "revoked", "pending"])("rejects %s changes without changing the chosen recipient", async field => {
    const ctx = await signedInMockApi(); const recipient = await selectedRecipient(ctx.api, request.params.phone);
    const before = JSON.stringify(recipient); const binding = await ctx.api.readDirectory(recipient.directory!.phoneKey);
    if (field === "account") binding.account = ctx.address;
    if (field === "revision") binding.revision = "9";
    if (field === "ownershipEpoch") binding.ownershipEpoch = "1";
    if (field === "expired") binding.now = Date.parse(binding.validUntil!) / 1000 + 1;
    if (field === "revoked") binding.revoked = true;
    if (field === "pending") binding.pending = true;
    await expect(verifySelectedRecipient(request, recipient, async () => binding)).rejects.toBeInstanceOf(RecipientCheckError);
    expect(JSON.stringify(recipient)).toBe(before);
  });
  it("fails closed before unlock when independent lookup is unavailable", async () => {
    const ctx = await signedInMockApi(); const recipient = await selectedRecipient(ctx.api, request.params.phone);
    const prepared = await ctx.api.prepareAction(request); const unlock = vi.fn();
    await expect(authorizeAndSubmit({ api: ctx.api, account: ctx.address, chainId: 143, request, prepared, recipient, unlock, readDirectory: async () => { throw new Error("offline"); } })).rejects.toBeInstanceOf(RecipientCheckError);
    expect(unlock).not.toHaveBeenCalled();
  });
  it("stops a change while device confirmation was open, before the key signs", async () => {
    const ctx = await signedInMockApi(); const recipient = await selectedRecipient(ctx.api, request.params.phone);
    const prepared = await ctx.api.prepareAction(request); const binding = await ctx.api.readDirectory(recipient.directory!.phoneKey);
    const signTypedData = vi.fn(ctx.signer.signTypedData); let reads = 0;
    await expect(authorizeAndSubmit({ api: ctx.api, account: ctx.address, chainId: 143, request, prepared, recipient,
      unlock: fn => fn({ signTypedData }), readDirectory: async () => ({ ...binding, revision: ++reads === 1 ? binding.revision : "2" }),
    })).rejects.toBeInstanceOf(RecipientCheckError);
    expect(signTypedData).not.toHaveBeenCalled();
  });
  it("derives the fixed recipient from selection even without resolvedPayee", async () => {
    const ctx = await signedInMockApi(); const recipient = await selectedRecipient(ctx.api, request.params.phone);
    const prepared = await ctx.api.prepareAction(request); prepared.toSign[0]!.typedData.message.to = ctx.address;
    const unlock = vi.fn();
    await expect(authorizeAndSubmit({ api: ctx.api, account: ctx.address, chainId: 143, request, prepared, recipient, unlock, readDirectory: ctx.api.readDirectory })).rejects.toThrow();
    expect(unlock).not.toHaveBeenCalled();
  });
  it("rejects a server downgrade of a selected registered person to a pending payment", async () => {
    const ctx = await signedInMockApi(); const recipient = await selectedRecipient(ctx.api, request.params.phone);
    const prepared = await ctx.api.prepareAction(request); const payment = prepared.toSign[0]!.typedData;
    payment.primaryType = "ReceiveWithAuthorization";
    payment.types = { ReceiveWithAuthorization: payment.types.TransferWithAuthorization! };
    payment.message.to = MOCK_ESCROW;
    const unlock = vi.fn();
    await expect(authorizeAndSubmit({ api: ctx.api, account: ctx.address, chainId: 143, request, prepared, recipient, unlock, readDirectory: ctx.api.readDirectory, escrow: MOCK_ESCROW })).rejects.toThrow("registered send must pay the contact directly");
    expect(unlock).not.toHaveBeenCalled();
  });
  it("rejects prepared metadata that differs from the reviewed recipient", async () => {
    const ctx = await signedInMockApi(); const recipient = await selectedRecipient(ctx.api, request.params.phone);
    const prepared = await ctx.api.prepareAction(request); prepared.expect.directory!.revision = "99";
    const unlock = vi.fn();
    await expect(authorizeAndSubmit({ api: ctx.api, account: ctx.address, chainId: 143, request, prepared, recipient, unlock, readDirectory: ctx.api.readDirectory })).rejects.toThrow("prepared recipient changed");
    expect(unlock).not.toHaveBeenCalled();
  });
  it("rejects an invite whose authorization hides another number or epoch", async () => {
    const ctx = await signedInMockApi(); const invite: ActionRequest = { type: "send", params: { phone: "+15555550188", amount: "1000000" } };
    const recipient = await selectedRecipient(ctx.api, invite.params.phone); const prepared = await ctx.api.prepareAction(invite);
    prepared.expect.terms!.phoneEpoch = "1"; const unlock = vi.fn();
    await expect(authorizeAndSubmit({ api: ctx.api, account: ctx.address, chainId: 143, request: invite, prepared, recipient, unlock, readDirectory: ctx.api.readDirectory, escrow: MOCK_ESCROW })).rejects.toThrow();
    expect(unlock).not.toHaveBeenCalled();
  });
  it("rejects gift authorization that does not commit the reviewed number and ownership period", async () => {
    const ctx = await signedInMockApi();
    const gift = { type: "gift_send" as const, params: { ...request.params, brandId: "starbucks-us" } };
    const recipient = await selectedRecipient(ctx.api, gift.params.phone); const prepared = await ctx.api.prepareAction(gift);
    prepared.toSign[0]!.typedData.message.nonce = `0x${"ab".repeat(32)}`;
    const unlock = vi.fn();
    await expect(authorizeAndSubmit({ api: ctx.api, account: ctx.address, chainId: 143, request: gift, prepared, recipient, unlock, readDirectory: ctx.api.readDirectory, escrow: MOCK_ESCROW })).rejects.toThrow();
    expect(unlock).not.toHaveBeenCalled();
  });
});
