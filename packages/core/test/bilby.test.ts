import { describe, expect, it } from "vitest";
import { DepositKind, escrowDepositId, escrowTermsNonce } from "../src";

describe("escrow terms", () => {
  // Expected values computed with `cast abi-encode` + `cast keccak` using the Solidity encoding.
  it("matches BilbyEscrow.termsNonce / depositIdOf", () => {
    const nonce = escrowTermsNonce({
      phoneKey: `0x${"11".repeat(32)}`,
      expiry: 1_790_604_800,
      kind: DepositKind.GIFT,
      giftId: `0x${"33".repeat(32)}`,
      salt: `0x${"22".repeat(32)}`,
    });
    expect(nonce).toBe("0x8e25c2d1e9a656d2324e88bc643894302ec60a4197603214ddae9ccfef0fdc42");
    expect(escrowDepositId("0x000000000000000000000000000000000000dEaD", nonce)).toBe(
      "0x7d7f8f268397b930f31177997e7742cce88f65f6b69e11faedd308e8075bd539",
    );
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
