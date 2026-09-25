/**
 * Sign-In-With-X (CAIP-122) for EVM, as used by x402 servers such as Laso's `GET /auth`.
 *
 * Sources (read 2026-09-25):
 *  - coinbase/x402 specs/extensions/sign-in-with-x.md and
 *    typescript/packages/extensions/src/sign-in-with-x/{client,evm,encode,fetch}.ts:
 *    server puts `extensions["sign-in-with-x"] = { info, supportedChains }` in the 402
 *    PAYMENT-REQUIRED header; the client signs an EIP-4361 (SIWE) message built from `info` with
 *    EIP-191 personal_sign, and replays with `SIGN-IN-WITH-X: base64(JSON payload)` where the payload
 *    is `info` + { address, chainId (CAIP-2), type, signatureScheme?, signature }.
 *  - LasoFinance/docs guides/authentication.mdx + auth.md: domain must be "laso.finance", nonces are
 *    single use, signatures older than 5 minutes are rejected, and every failure is a 402 carrying a
 *    fresh challenge (so: never resend a payload, sign the new challenge).
 *
 * The x402 reference client uses the `siwe` npm library to format the message; we use viem's
 * createSiweMessage, which implements the same EIP-4361 grammar. Unverified against the live
 * server — the smoke script is the first real test.
 */
import type { LocalAccount } from "viem";
import { createSiweMessage } from "viem/siwe";
import { base64JsonEncode } from "./x402";
import { isRecord } from "./util";

export const SIWX_EXTENSION = "sign-in-with-x";

export type SiwxInfo = {
  domain: string;
  uri: string;
  version: string;
  nonce: string;
  issuedAt: string;
  statement?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
};

export type SiwxChain = { chainId: string; type: string; signatureScheme?: string };

export type SiwxChallenge = { info: SiwxInfo; supportedChains: SiwxChain[] };

export function parseSiwxChallenge(extensions: Record<string, unknown> | undefined): SiwxChallenge | undefined {
  const ext = extensions?.[SIWX_EXTENSION];
  if (!isRecord(ext) || !isRecord(ext.info) || !Array.isArray(ext.supportedChains)) return undefined;
  const info = ext.info as Record<string, unknown>;
  for (const k of ["domain", "uri", "version", "nonce", "issuedAt"]) {
    if (typeof info[k] !== "string") return undefined;
  }
  return {
    info: info as unknown as SiwxInfo,
    supportedChains: ext.supportedChains.filter(
      (c): c is SiwxChain => isRecord(c) && typeof c.chainId === "string" && typeof c.type === "string",
    ),
  };
}

/** EIP-4361 message text for `info` on an `eip155:<n>` chain. */
export function siweMessage(info: SiwxInfo, chainId: string, address: `0x${string}`): string {
  const numeric = Number(/^eip155:(\d+)$/.exec(chainId)?.[1]);
  if (!Number.isInteger(numeric)) throw new Error(`Not an EVM CAIP-2 chain id: ${chainId}`);
  return createSiweMessage({
    domain: info.domain,
    address,
    statement: info.statement,
    uri: info.uri,
    version: "1",
    chainId: numeric,
    nonce: info.nonce,
    issuedAt: new Date(info.issuedAt),
    expirationTime: info.expirationTime ? new Date(info.expirationTime) : undefined,
    notBefore: info.notBefore ? new Date(info.notBefore) : undefined,
    requestId: info.requestId,
    resources: info.resources,
  });
}

/** Builds the `SIGN-IN-WITH-X` header value for the first supported chain matching `chainId`. */
export async function createSiwxHeader(
  challenge: SiwxChallenge,
  account: LocalAccount,
  chainId: string,
): Promise<string> {
  const chain = challenge.supportedChains.find((c) => c.chainId === chainId);
  if (!chain) throw new Error(`Server does not offer sign-in on ${chainId}`);
  const message = siweMessage(challenge.info, chain.chainId, account.address);
  const signature = await account.signMessage({ message });
  return base64JsonEncode({
    domain: challenge.info.domain,
    address: account.address,
    statement: challenge.info.statement,
    uri: challenge.info.uri,
    version: challenge.info.version,
    chainId: chain.chainId,
    type: chain.type,
    nonce: challenge.info.nonce,
    issuedAt: challenge.info.issuedAt,
    expirationTime: challenge.info.expirationTime,
    notBefore: challenge.info.notBefore,
    requestId: challenge.info.requestId,
    resources: challenge.info.resources,
    signatureScheme: chain.signatureScheme,
    signature,
  });
}
