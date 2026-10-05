import { type Address, encodeAbiParameters, type Hex, keccak256, toHex, type TypedDataDefinition } from "viem";
import type { TokenInfo } from "./chains";

/** Deployed BilbyPay contracts on one chain (see contracts/deployments/<chainId>.json). */
export type Deployment = {
  chainId: number;
  ausd: Address;
  stata: Address;
  directory: Address;
  escrow: Address;
  router: Address;
};

export const DepositKind = { TRANSFER: 0, GIFT: 1 } as const;
export type DepositKind = (typeof DepositKind)[keyof typeof DepositKind];

export const DepositStatus = ["None", "Pending", "Claimed", "Refunded", "Cancelled"] as const;
export type DepositStatus = (typeof DepositStatus)[number];

/** Mirrors BilbyEscrow.Terms. */
export type EscrowTerms = {
  phoneKey: Hex;
  phoneEpoch: bigint;
  expiry: number;
  kind: DepositKind;
  giftId: Hex; // zero for TRANSFER
  salt: Hex;
};

export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;
const TERMS_TAG = keccak256(toHex("BilbyEscrow.Terms.v2"));

/** The EIP-3009 nonce the sender signs for an escrow deposit (BilbyEscrow.termsNonce). */
export function escrowTermsNonce(t: EscrowTerms): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }, { type: "uint40" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }],
      [TERMS_TAG, t.phoneKey, t.phoneEpoch, t.expiry, t.kind, t.giftId, t.salt],
    ),
  );
}

/** BilbyEscrow.depositIdOf */
export function escrowDepositId(sender: Address, nonce: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [sender, nonce]));
}

const domain = (name: string, chainId: number, verifyingContract: Address) => ({ name, version: "1", chainId, verifyingContract });

export type DirectoryBindRequest = { phoneKey: Hex; account: Address; issuedAt: bigint; deadline: bigint; expectedRevision: bigint; validUntil: bigint };
export type DirectoryControlRequest = { phoneKey: Hex; expectedRevision: bigint; deadline: bigint };

const DIRECTORY_BIND_FIELDS = [
  { name: "phoneKey", type: "bytes32" },
  { name: "account", type: "address" },
  { name: "issuedAt", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "expectedRevision", type: "uint256" },
  { name: "validUntil", type: "uint256" },
] as const;
const DIRECTORY_CONTROL_FIELDS = [
  { name: "phoneKey", type: "bytes32" },
  { name: "expectedRevision", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;

function directoryTypedData<const T extends "Bind" | "RequestRecovery" | "FinalizeRecovery">(d: Deployment, primaryType: T, message: DirectoryBindRequest) {
  return {
    domain: { ...domain("BilbyDirectory", d.chainId, d.directory), version: "2" },
    types: { [primaryType]: DIRECTORY_BIND_FIELDS } as { [K in T]: typeof DIRECTORY_BIND_FIELDS },
    primaryType,
    message,
  } as const;
}

export const bindTypedData = (d: Deployment, m: DirectoryBindRequest) => directoryTypedData(d, "Bind", m);
export const requestRecoveryTypedData = (d: Deployment, m: DirectoryBindRequest) => directoryTypedData(d, "RequestRecovery", m);
export const finalizeRecoveryTypedData = (d: Deployment, m: DirectoryBindRequest) => directoryTypedData(d, "FinalizeRecovery", m);

export function revokePhoneTypedData(d: Deployment, message: DirectoryControlRequest) {
  return {
    domain: { ...domain("BilbyDirectory", d.chainId, d.directory), version: "2" },
    types: { Revoke: DIRECTORY_CONTROL_FIELDS },
    primaryType: "Revoke",
    message,
  } as const satisfies TypedDataDefinition;
}

export function cancelRecoveryTypedData(d: Deployment, message: DirectoryControlRequest) {
  return {
    domain: { ...domain("BilbyDirectory", d.chainId, d.directory), version: "2" },
    types: { CancelRecovery: DIRECTORY_CONTROL_FIELDS },
    primaryType: "CancelRecovery",
    message,
  } as const satisfies TypedDataDefinition;
}

export function claimTypedData(d: Deployment, m: { depositId: Hex; phoneKey: Hex; recipient: Address; deadline: bigint }) {
  return {
    domain: domain("BilbyEscrow", d.chainId, d.escrow),
    types: {
      Claim: [
        { name: "depositId", type: "bytes32" },
        { name: "phoneKey", type: "bytes32" },
        { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Claim",
    message: m,
  } as const satisfies TypedDataDefinition;
}

export function cancelTypedData(d: Deployment, m: { depositId: Hex; deadline: bigint }) {
  return {
    domain: domain("BilbyEscrow", d.chainId, d.escrow),
    types: {
      Cancel: [
        { name: "depositId", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Cancel",
    message: m,
  } as const satisfies TypedDataDefinition;
}

export function setAutoSaveTypedData(
  d: Deployment,
  m: { user: Address; enabled: boolean; threshold: bigint; nonce: bigint; deadline: bigint },
) {
  return {
    domain: domain("BilbyRouter", d.chainId, d.router),
    types: {
      SetAutoSave: [
        { name: "user", type: "address" },
        { name: "enabled", type: "bool" },
        { name: "threshold", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "SetAutoSave",
    message: m,
  } as const satisfies TypedDataDefinition;
}

/** EIP-2612 permit for AUSD or stataAUSD. */
export function permitTypedData(
  token: TokenInfo,
  chainId: number,
  m: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint },
) {
  return {
    domain: { name: token.domainName, version: token.domainVersion, chainId, verifyingContract: token.address },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: m,
  } as const satisfies TypedDataDefinition;
}

/** Mirrors BilbyRouter.Permit. value 0 = no permit. */
export type RouterPermit = { value: bigint; deadline: bigint; v: number; r: Hex; s: Hex };
export const NO_PERMIT: RouterPermit = { value: 0n, deadline: 0n, v: 0, r: ZERO_BYTES32, s: ZERO_BYTES32 };
