import { describe, expect, it } from "vitest";
import type { DirectoryConsent, DirectoryOperation, Hex } from "../api/types";
import { checkDirectoryConsent, directoryTypedData, DirectoryCheckError, MOCK_DIRECTORY } from "./directory";

const account: Hex = "0x1111111111111111111111111111111111111111";
const phoneKey: Hex = `0x${"ab".repeat(32)}`;
const now = 1_800_000_000;
function consent(operation: DirectoryOperation = "bind"): DirectoryConsent {
  const message = { phoneKey, expectedRevision: 4n, deadline: BigInt(now + 600), ...(["revoke", "cancelRecovery"].includes(operation) ? {} : { account, issuedAt: BigInt(now), validUntil: BigInt(now + 30 * 86400) }) };
  return { id: "d1", operation, phoneKey, revision: "4", validUntil: new Date((now + 30 * 86400) * 1000).toISOString(), typedData: directoryTypedData(143, MOCK_DIRECTORY, operation, message) };
}
const input = { account, chainId: 143, directoryAddress: MOCK_DIRECTORY, phoneKey, now };

describe("directory consent guard", () => {
  it.each<DirectoryOperation>(["bind", "requestRecovery", "finalizeRecovery", "revoke", "cancelRecovery"])("accepts the exact reviewed %s", operation => {
    expect(checkDirectoryConsent(consent(operation), { ...input, operation }).primaryType).toBeTruthy();
  });
  it.each([
    ["operation", (p: DirectoryConsent) => { p.operation = "requestRecovery"; }],
    ["contract", (p: DirectoryConsent) => { p.typedData.domain.verifyingContract = account; }],
    ["network", (p: DirectoryConsent) => { p.typedData.domain.chainId = 10143; }],
    ["revision", (p: DirectoryConsent) => { p.revision = "5"; }],
    ["destination", (p: DirectoryConsent) => { p.typedData.message.account = "0x2222222222222222222222222222222222222222"; }],
    ["expired", (p: DirectoryConsent) => { p.typedData.message.deadline = String(now - 1); }],
    ["long deadline", (p: DirectoryConsent) => { p.typedData.message.deadline = String(now + 86400); }],
    ["identifier", (p: DirectoryConsent) => { p.phoneKey = `0x${"cd".repeat(32)}`; }],
    ["old schema", (p: DirectoryConsent) => { p.typedData.domain.version = "1"; }],
  ] as const)("rejects changed %s before signing", (_label, mutate) => {
    const prepared = consent(); mutate(prepared);
    expect(() => checkDirectoryConsent(prepared, { ...input, operation: "bind" })).toThrow(DirectoryCheckError);
  });
  it("rejects cross-operation replay even though fields match", () => {
    expect(() => checkDirectoryConsent(consent("requestRecovery"), { ...input, operation: "finalizeRecovery" })).toThrow(DirectoryCheckError);
  });
});
