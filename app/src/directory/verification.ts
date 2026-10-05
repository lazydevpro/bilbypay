import { getNetwork } from "@bilbypay/core";
import { createPublicClient, http, parseAbi, zeroAddress } from "viem";
import type { ActionRequest, Hex } from "../api/types";
import type { Recipient } from "../flows/drafts";

const ABI = parseAbi([
  "function VERSION() view returns (uint256)",
  "function getBinding(bytes32 phoneKey) view returns ((address account,uint64 boundAt,uint64 validUntil,uint64 revision,uint64 phoneEpoch,bool revoked))",
  "function getPendingChange(bytes32 phoneKey) view returns ((address account,uint64 requestedAt,uint64 executableAt,uint64 expiresAt,uint64 expectedRevision))",
]);

export type BindingRead = {
  account: Hex; revision: string; ownershipEpoch: string; validUntil: string | null; revoked: boolean; pending: boolean; now: number;
};
export type DirectoryReader = (phoneKey: Hex) => Promise<BindingRead>;

export class RecipientCheckError extends Error {
  readonly userMessage = "This recipient's details couldn't be confirmed. Choose them again and check their number before sending. Nothing was sent.";
}

/** The endpoint and contract come from the installed app, never the payment API. */
export function createPinnedDirectoryReader(pin: { chainId: number; directory: Hex; rpcUrl?: string }): DirectoryReader {
  return async (phoneKey) => {
  try {
    const address = pin.directory;
    const client = createPublicClient({ chain: getNetwork(pin.chainId).chain, transport: http(pin.rpcUrl, { timeout: 12_000, retryCount: 0 }) });
    const chainId = await client.getChainId();
    if (chainId !== pin.chainId) throw new Error("wrong network");
    const block = await client.getBlock({ blockTag: "latest" });
    const [version, binding, pending] = await Promise.all([
      client.readContract({ address, abi: ABI, functionName: "VERSION", blockNumber: block.number }),
      client.readContract({ address, abi: ABI, functionName: "getBinding", args: [phoneKey], blockNumber: block.number }),
      client.readContract({ address, abi: ABI, functionName: "getPendingChange", args: [phoneKey], blockNumber: block.number }),
    ]);
    if (version !== 2n || Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 120) throw new Error("stale directory");
    return {
      account: binding.account, revision: binding.revision.toString(), ownershipEpoch: binding.phoneEpoch.toString(),
      validUntil: binding.validUntil ? new Date(Number(binding.validUntil) * 1000).toISOString() : null,
      revoked: binding.revoked, pending: pending.account !== zeroAddress && pending.expiresAt >= block.timestamp,
      now: Number(block.timestamp),
    };
  } catch { throw new RecipientCheckError("independent lookup unavailable"); }
  };
}

/** Verifies the selection snapshot; never substitutes a new destination. */
export async function verifySelectedRecipient(request: ActionRequest, recipient: Recipient | undefined, read: DirectoryReader): Promise<void> {
  if (request.type !== "send" && request.type !== "gift_send") return;
  const fail = (): never => { throw new RecipientCheckError("recipient changed"); };
  const selected = recipient?.directory;
  if (!recipient || recipient.e164 !== request.params.phone || !selected || !/^0x[\da-f]{64}$/i.test(selected.phoneKey)) fail();
  try {
    const current = await read(selected!.phoneKey);
    if (selected!.pending || current.pending || current.revoked || selected!.revision !== current.revision || selected!.ownershipEpoch !== current.ownershipEpoch || selected!.validUntil !== current.validUntil) fail();
    if (recipient!.status === "registered") {
      if (!recipient!.address || recipient!.address.toLowerCase() !== current.account.toLowerCase() || current.account === zeroAddress || !current.validUntil || Date.parse(current.validUntil) <= current.now * 1000) fail();
    } else if (current.account !== zeroAddress || current.revision !== "0" || current.ownershipEpoch !== "0") fail();
  } catch { fail(); }
}
