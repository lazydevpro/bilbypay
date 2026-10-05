import { hydrateTypedData, serializeTypedData } from "@bilbypay/core";
import { hashTypedData, isAddress, type TypedDataDefinition } from "viem";
import type { DirectoryConsent, DirectoryOperation, Hex } from "../api/types";
import { DIRECTORY_ADDRESS, ESCROW_ADDRESS, IS_MOCK } from "../config";

export const MOCK_DIRECTORY: Hex = "0x00000000000000000000000000000000000b11b1";
const NAMES: Record<DirectoryOperation, string> = {
  bind: "Bind", requestRecovery: "RequestRecovery", finalizeRecovery: "FinalizeRecovery", revoke: "Revoke", cancelRecovery: "CancelRecovery",
};
const registrationFields = [
  { name: "phoneKey", type: "bytes32" }, { name: "account", type: "address" },
  { name: "issuedAt", type: "uint256" }, { name: "deadline", type: "uint256" },
  { name: "expectedRevision", type: "uint256" }, { name: "validUntil", type: "uint256" },
] as const;
const managementFields = [
  { name: "phoneKey", type: "bytes32" }, { name: "expectedRevision", type: "uint256" }, { name: "deadline", type: "uint256" },
] as const;

export class DirectoryCheckError extends Error {
  readonly userMessage = "We couldn't confirm these details. Please refresh and try again. Nothing was changed.";
}

export function trustedDirectoryAddress(): Hex {
  const pin = IS_MOCK ? MOCK_DIRECTORY : DIRECTORY_ADDRESS;
  if (!isAddress(pin) || /^0x0{40}$/i.test(pin)) throw new DirectoryCheckError("missing deployment pin");
  return pin;
}
export function trustedEscrowAddress(): Hex {
  const pin = IS_MOCK ? "0x00000000000000000000000000000000000b11b2" : ESCROW_ADDRESS;
  if (!isAddress(pin) || /^0x0{40}$/i.test(pin)) throw new DirectoryCheckError("missing receiver pin");
  return pin;
}

/** Canonical operation schema shared with the demo and consent guard. */
export function directoryTypedData(chainId: number, directory: Hex, operation: DirectoryOperation, message: Record<string, unknown>) {
  const primaryType = NAMES[operation];
  return serializeTypedData({
    domain: { name: "BilbyDirectory", version: "2", chainId, verifyingContract: directory },
    types: { [primaryType]: operation === "revoke" || operation === "cancelRecovery" ? managementFields : registrationFields },
    primaryType, message,
  } as unknown as TypedDataDefinition);
}

/** Only the exact enrollment or management operation reviewed by the user may reach the key. */
export function checkDirectoryConsent(prepared: DirectoryConsent, input: {
  account: Hex; chainId: number; operation?: DirectoryOperation; phoneKey?: Hex; directoryAddress?: Hex; now?: number;
}): TypedDataDefinition {
  const fail = (): never => { throw new DirectoryCheckError("consent mismatch"); };
  try {
    if (input.operation && prepared.operation !== input.operation) fail();
    if (!Object.hasOwn(NAMES, prepared.operation) || !/^0x[\da-f]{64}$/i.test(prepared.phoneKey)) fail();
    if (input.phoneKey && prepared.phoneKey.toLowerCase() !== input.phoneKey.toLowerCase()) fail();
    const td = hydrateTypedData(prepared.typedData);
    const m = td.message as Record<string, unknown>;
    const now = BigInt(input.now ?? Math.floor(Date.now() / 1000));
    const deadline = BigInt(String(m.deadline));
    const revision = BigInt(prepared.revision);
    if (revision < 0n || String(m.expectedRevision) !== prepared.revision || deadline <= now || deadline > now + 900n) fail();
    const expected: Record<string, unknown> = { phoneKey: prepared.phoneKey, expectedRevision: revision, deadline };
    if (prepared.operation !== "revoke" && prepared.operation !== "cancelRecovery") {
      const issuedAt = BigInt(String(m.issuedAt));
      const validUntil = BigInt(String(m.validUntil));
      if (issuedAt > now + 60n || issuedAt < now - 300n || validUntil <= now || validUntil > now + 366n * 86400n) fail();
      if (!prepared.validUntil || BigInt(Math.floor(Date.parse(prepared.validUntil) / 1000)) !== validUntil) fail();
      Object.assign(expected, { account: input.account, issuedAt, validUntil });
    }
    if (Object.keys(m).sort().join() !== Object.keys(expected).sort().join()) fail();
    const canonical = hydrateTypedData(directoryTypedData(input.chainId, input.directoryAddress ?? trustedDirectoryAddress(), prepared.operation, expected));
    if (hashTypedData(td) !== hashTypedData(canonical)) fail();
    return canonical;
  } catch { return fail(); }
}
