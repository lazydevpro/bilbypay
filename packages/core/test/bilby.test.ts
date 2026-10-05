import { describe, expect, it } from "vitest";
import { DepositKind, escrowDepositId, escrowTermsNonce, bindTypedData, requestRecoveryTypedData, finalizeRecoveryTypedData, revokePhoneTypedData, cancelRecoveryTypedData, type Deployment } from "../src";
import { hashTypedData } from "viem";

describe("escrow terms", () => {
  // Expected values computed with `cast abi-encode` + `cast keccak` using the Solidity encoding.
  it("matches BilbyEscrow.termsNonce / depositIdOf", () => {
    const nonce = escrowTermsNonce({
      phoneKey: `0x${"11".repeat(32)}`,
      phoneEpoch: 7n,
      expiry: 1_790_604_800,
      kind: DepositKind.GIFT,
      giftId: `0x${"33".repeat(32)}`,
      salt: `0x${"22".repeat(32)}`,
    });
    expect(nonce).toBe("0x98137759adfb32b1179b05a1c63a92bd108611fffb1f659aaa8f8fed46a8c346");
    expect(escrowDepositId("0x000000000000000000000000000000000000dEaD", nonce)).toBe(
      "0x50e10954bdf2fd8e4fe10b1d932fc38326f689013b7ef76b8d173a0560b064eb",
    );
  });
});

describe("directory signing domains", () => {
  const address = "0x000000000000000000000000000000000000dEaD";
  const d: Deployment = { chainId: 10143, directory: address, ausd: address, stata: address, escrow: address, router: address };
  const request = { phoneKey: `0x${"11".repeat(32)}` as const, account: d.directory, issuedAt: 1n, deadline: 2n, expectedRevision: 3n, validUntil: 4n };
  it("separates enrollment, recovery request and recovery completion authorizations", () => {
    const messages = [bindTypedData(d, request), requestRecoveryTypedData(d, request), finalizeRecoveryTypedData(d, request)];
    expect(messages.map((m) => m.domain.version)).toEqual(["2", "2", "2"]);
    expect(new Set([hashTypedData(bindTypedData(d, request)), hashTypedData(requestRecoveryTypedData(d, request)), hashTypedData(finalizeRecoveryTypedData(d, request))]).size).toBe(3);
    expect(hashTypedData(bindTypedData(d, request))).not.toBe(hashTypedData(bindTypedData(d, { ...request, expectedRevision: 4n })));
    expect(hashTypedData(bindTypedData(d, request))).not.toBe(hashTypedData(bindTypedData({ ...d, chainId: 143 }, request)));
  });
  it("separates revoking a number from cancelling its pending change", () => {
    expect(hashTypedData(revokePhoneTypedData(d, request))).not.toBe(hashTypedData(cancelRecoveryTypedData(d, request)));
  });
});

import { privateKeyToAccount } from "viem/accounts";
import { authorizationTypedData, getNetwork, hydrateTypedData, monad, newAuthorization, serializeTypedData } from "../src";

describe("typed data JSON", () => {
  it("round-trips and signs identically", async () => {
    const account = privateKeyToAccount(`0x${"42".repeat(32)}`);
    const td = authorizationTypedData("TransferWithAuthorization", getNetwork(monad.id).ausd, monad.id, newAuthorization({ from: account.address, to: account.address, value: 5n }));
    const wire = JSON.parse(JSON.stringify(serializeTypedData(td)));
    expect(typeof wire.message.value).toBe("string");
    expect(await account.signTypedData(hydrateTypedData(wire))).toBe(await account.signTypedData(td));
  });
});
