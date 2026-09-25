import { bytesToHex, hexToBytes, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  authorizationTypedData,
  deriveEvmPrivateKey,
  formatUsd,
  getNetwork,
  monad,
  newAuthorization,
  parseUsd,
  toSignedAuthorization,
} from "../src";

const prf = hexToBytes("0x0101010101010101010101010101010101010101010101010101010101010101");

describe("deriveEvmPrivateKey", () => {
  it("is deterministic and pinned", () => {
    const key = deriveEvmPrivateKey(prf);
    expect(bytesToHex(deriveEvmPrivateKey(prf))).toBe(bytesToHex(key));
    // Pin the derivation: if this changes, every existing account changes.
    expect(privateKeyToAccount(bytesToHex(key)).address).toMatchInlineSnapshot(`"0xb04C951B8f708C9b894047bdD1e01A7492A57c92"`);
  });

  it("differs per PRF output and rejects bad lengths", () => {
    const other = deriveEvmPrivateKey(new Uint8Array(32).fill(2));
    expect(bytesToHex(other)).not.toBe(bytesToHex(deriveEvmPrivateKey(prf)));
    expect(() => deriveEvmPrivateKey(new Uint8Array(31))).toThrow();
  });
});

describe("EIP-3009 authorization", () => {
  it("signs a TransferWithAuthorization against the AUSD domain", async () => {
    const account = privateKeyToAccount(bytesToHex(deriveEvmPrivateKey(prf)));
    const { ausd } = getNetwork(monad.id);
    const auth = newAuthorization({
      from: account.address,
      to: "0x000000000000000000000000000000000000dEaD",
      value: parseUsd("20"),
      now: 1_800_000_000,
    });
    expect(auth.validAfter).toBe(1_799_999_940n);
    expect(auth.validBefore).toBe(1_800_000_600n);
    expect(auth.nonce).toMatch(/^0x[0-9a-f]{64}$/);

    const typedData = authorizationTypedData("TransferWithAuthorization", ausd, monad.id, auth);
    expect(typedData.domain?.name).toBe("Agora Dollar");
    const signature = await account.signTypedData(typedData);
    expect(await recoverTypedDataAddress({ ...typedData, signature })).toBe(account.address);

    const signed = toSignedAuthorization(auth, signature);
    expect([27, 28]).toContain(signed.v);
  });
});

describe("money", () => {
  it("parses and formats dollars", () => {
    expect(parseUsd("12.5")).toBe(12_500_000n);
    expect(parseUsd("$0.000001")).toBe(1n);
    expect(() => parseUsd("-1")).toThrow();
    expect(() => parseUsd("1.0000001")).toThrow();
    expect(formatUsd(1_234_567_890n)).toBe("$1,234.56");
    expect(formatUsd(5n)).toBe("$0.00");
  });
});
