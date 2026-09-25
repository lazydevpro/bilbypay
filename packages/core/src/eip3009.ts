import { type Address, bytesToHex, type Hex, parseSignature, type TypedDataDefinition } from "viem";
import type { TokenInfo } from "./chains";

export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type AuthorizationKind = keyof typeof EIP3009_TYPES;

export type Authorization = {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
};

/** A signed authorization, split into the v/r/s form both AUSD and USDC accept. */
export type SignedAuthorization = Authorization & { v: number; r: Hex; s: Hex };

export function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * Builds an authorization valid from now until `ttlSeconds` from now.
 * `validAfter` is backdated a minute so a slightly fast client clock can't make it "not yet valid".
 */
export function newAuthorization(args: {
  from: Address;
  to: Address;
  value: bigint;
  ttlSeconds?: number;
  now?: number;
}): Authorization {
  const now = BigInt(args.now ?? Math.floor(Date.now() / 1000));
  return {
    from: args.from,
    to: args.to,
    value: args.value,
    validAfter: now - 60n,
    validBefore: now + BigInt(args.ttlSeconds ?? 600),
    nonce: randomNonce(),
  };
}

export function authorizationTypedData(
  kind: AuthorizationKind,
  token: TokenInfo,
  chainId: number,
  auth: Authorization,
): TypedDataDefinition<typeof EIP3009_TYPES, AuthorizationKind> {
  return {
    domain: {
      name: token.domainName,
      version: token.domainVersion,
      chainId,
      verifyingContract: token.address,
    },
    types: EIP3009_TYPES,
    primaryType: kind,
    message: auth,
  };
}

export function toSignedAuthorization(auth: Authorization, signature: Hex): SignedAuthorization {
  const { r, s, v, yParity } = parseSignature(signature);
  return { ...auth, r, s, v: Number(v ?? BigInt(27 + (yParity ?? 0))) };
}

export const eip3009Abi = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;
