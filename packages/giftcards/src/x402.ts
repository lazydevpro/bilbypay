/**
 * Minimal x402 client for the "exact" scheme on EVM with EIP-3009 (USDC transferWithAuthorization).
 *
 * Written against the coinbase/x402 repo (github.com/coinbase/x402, read 2026-09-25):
 *  - specs/transports-v2/http.md  — v2: 402 + `PAYMENT-REQUIRED` header (base64 JSON PaymentRequired),
 *    client replays with `PAYMENT-SIGNATURE` (base64 JSON PaymentPayload), server answers with
 *    `PAYMENT-RESPONSE` (base64 SettlementResponse).
 *  - specs/transports-v1/http.md  — v1: requirements in the 402 JSON body (`maxAmountRequired`,
 *    network names like "base"), client replays with `X-PAYMENT`, server answers `X-PAYMENT-RESPONSE`.
 *  - specs/schemes/exact/scheme_exact_evm.md and
 *    typescript/packages/mechanisms/evm/src/exact/client/eip3009.ts — the signed message is EIP-712
 *    TransferWithAuthorization over domain {name: extra.name, version: extra.version, chainId,
 *    verifyingContract: asset}; validAfter = now - 600, validBefore = now + maxTimeoutSeconds;
 *    values are decimal strings in the payload.
 *  - typescript/packages/mechanisms/evm/src/shared/defaultAssets.ts — Base mainnet USDC
 *    0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 has EIP-712 name "USD Coin", version "2"
 *    (Base Sepolia USDC is "USDC"/"2" — don't mix them up).
 *
 * We deliberately don't depend on @x402/*: the part we need is ~150 lines, and owning it lets us
 * persist the exact signed header before sending it (see LasoProvider's no-double-pay logic).
 */
import { type Address, getAddress, type Hex, type LocalAccount } from "viem";
import { EIP3009_TYPES, randomNonce } from "@bilbypay/core";
import { isRecord } from "./util";

export const BASE_NETWORK = "eip155:8453";
export const BASE_CHAIN_ID = 8453;
export const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** EIP-712 domain of native USDC on Base mainnet (FiatTokenV2_2). Source: x402 defaultAssets.ts. */
export const BASE_USDC_DOMAIN = { name: "USD Coin", version: "2" } as const;

/** v1 used network names instead of CAIP-2 ids. */
const V1_NETWORKS: Record<string, string> = { base: "eip155:8453", "base-sepolia": "eip155:84532" };

/** A single payment option, normalised across v1 and v2. */
export type PaymentRequirement = {
  scheme: string;
  /** CAIP-2, e.g. "eip155:8453" (v1 names are mapped). */
  network: string;
  /** Atomic units of `asset` (USDC: 6 decimals, so identical to our USD base units). */
  amount: bigint;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
  /** The option exactly as the server sent it; echoed back in v2 `accepted`. */
  raw: Record<string, unknown>;
};

export type PaymentRequired = {
  x402Version: number;
  error?: string;
  resource?: unknown;
  accepts: PaymentRequirement[];
  extensions?: Record<string, unknown>;
};

export function base64JsonEncode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function base64JsonDecode(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function normaliseRequirement(raw: unknown, version: number): PaymentRequirement | undefined {
  if (!isRecord(raw)) return undefined;
  const amount = version === 1 ? raw.maxAmountRequired : raw.amount;
  const network = typeof raw.network === "string" ? (V1_NETWORKS[raw.network] ?? raw.network) : undefined;
  if (typeof raw.scheme !== "string" || !network || typeof raw.asset !== "string" || typeof raw.payTo !== "string") return undefined;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) return undefined;
  // Solana payTo/asset aren't hex; keep those entries out rather than failing getAddress.
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw.asset) || !/^0x[0-9a-fA-F]{40}$/.test(raw.payTo)) return undefined;
  return {
    scheme: raw.scheme,
    network,
    amount: BigInt(amount),
    asset: getAddress(raw.asset),
    payTo: getAddress(raw.payTo),
    maxTimeoutSeconds: typeof raw.maxTimeoutSeconds === "number" ? raw.maxTimeoutSeconds : 60,
    extra: isRecord(raw.extra) ? raw.extra : undefined,
    raw,
  };
}

/**
 * Reads a PaymentRequired from a 402: the v2 `PAYMENT-REQUIRED` header first, then a v1 JSON body.
 * `body` is the already-parsed response body (so callers can inspect it too).
 * Returns undefined when the 402 isn't a challenge (e.g. a settlement failure `{success:false}`).
 */
export function parsePaymentRequired(res: Response, body: unknown): PaymentRequired | undefined {
  let decoded: unknown;
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (header) {
    try {
      decoded = base64JsonDecode(header);
    } catch {
      decoded = undefined;
    }
  }
  if (!isRecord(decoded) && isRecord(body) && Array.isArray(body.accepts)) decoded = body;
  if (!isRecord(decoded)) return undefined;
  const version = Number(decoded.x402Version ?? (header ? 2 : 1));
  const accepts = Array.isArray(decoded.accepts)
    ? decoded.accepts.map((a) => normaliseRequirement(a, version)).filter((a): a is PaymentRequirement => !!a)
    : [];
  return {
    x402Version: version,
    error: typeof decoded.error === "string" ? decoded.error : undefined,
    resource: decoded.resource,
    accepts,
    extensions: isRecord(decoded.extensions) ? decoded.extensions : undefined,
  };
}

export function selectRequirement(
  pr: PaymentRequired,
  want: { network: string; asset: Address },
): PaymentRequirement | undefined {
  return pr.accepts.find(
    (a) =>
      a.scheme === "exact" &&
      a.network === want.network &&
      a.asset.toLowerCase() === want.asset.toLowerCase() &&
      // Permit2 needs an on-chain approval first; we only do EIP-3009.
      (a.extra?.assetTransferMethod === undefined || a.extra.assetTransferMethod === "eip3009"),
  );
}

export type ExactEvmAuthorization = {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
};

export type SignedPayment = {
  /** "PAYMENT-SIGNATURE" (v2) or "X-PAYMENT" (v1). */
  headerName: string;
  headerValue: string;
  authorization: ExactEvmAuthorization;
  signature: Hex;
};

export function eip3009TypedData(req: PaymentRequirement, auth: ExactEvmAuthorization) {
  // Servers normally send the domain in `extra`; for Base USDC we know it, so tolerate its absence.
  const known = req.network === BASE_NETWORK && req.asset.toLowerCase() === BASE_USDC.toLowerCase() ? BASE_USDC_DOMAIN : undefined;
  const name = req.extra?.name ?? known?.name;
  const version = req.extra?.version ?? known?.version;
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error("x402 requirement is missing extra.name/extra.version (EIP-712 domain)");
  }
  const chainId = Number(req.network.split(":")[1]);
  return {
    domain: { name, version, chainId, verifyingContract: req.asset },
    types: { TransferWithAuthorization: EIP3009_TYPES.TransferWithAuthorization },
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: getAddress(auth.from),
      to: getAddress(auth.to),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  };
}

/** Signs an EIP-3009 authorization for `req` and builds the replay header for `x402Version`. */
export async function createExactEvmPayment(args: {
  account: LocalAccount;
  requirement: PaymentRequirement;
  x402Version: number;
  resource?: unknown;
  /** Unix seconds; injectable for tests. */
  now?: number;
}): Promise<SignedPayment> {
  const { account, requirement: req } = args;
  if (!req.network.startsWith("eip155:")) throw new Error(`Not an EVM network: ${req.network}`);
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const authorization: ExactEvmAuthorization = {
    from: account.address,
    to: req.payTo,
    value: req.amount.toString(),
    validAfter: String(now - 600),
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce: randomNonce(),
  };
  const signature = await account.signTypedData(eip3009TypedData(req, authorization));
  const payload = { signature, authorization };
  if (args.x402Version === 1) {
    const v1Network = Object.entries(V1_NETWORKS).find(([, caip]) => caip === req.network)?.[0] ?? req.network;
    return {
      headerName: "X-PAYMENT",
      headerValue: base64JsonEncode({ x402Version: 1, scheme: req.scheme, network: v1Network, payload }),
      authorization,
      signature,
    };
  }
  return {
    headerName: "PAYMENT-SIGNATURE",
    headerValue: base64JsonEncode({
      x402Version: args.x402Version,
      ...(args.resource !== undefined ? { resource: args.resource } : {}),
      accepted: req.raw,
      payload,
    }),
    authorization,
    signature,
  };
}

export type SettlementResponse = {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
  errorMessage?: string;
};

export function parseSettlementResponse(res: Response, body?: unknown): SettlementResponse | undefined {
  const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  let decoded: unknown;
  if (header) {
    try {
      decoded = base64JsonDecode(header);
    } catch {
      decoded = undefined;
    }
  }
  if (!isRecord(decoded) && isRecord(body) && typeof body.success === "boolean") decoded = body;
  if (!isRecord(decoded) || typeof decoded.success !== "boolean") return undefined;
  return decoded as SettlementResponse;
}
