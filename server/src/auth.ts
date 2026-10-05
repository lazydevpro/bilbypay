import { jwtVerify, SignJWT } from "jose";
import { type Address, getAddress, type Hex, isHex, verifyMessage } from "viem";
import { ApiError, errors } from "./errors";

const ISSUER = "bilbypay";
const PHONE_TOKEN_TTL = "15m";
const SESSION_TTL = "30d";
/** Signed messages must be this fresh (seconds either way, to allow for clock skew). */
export const MESSAGE_MAX_AGE_SECONDS = 300;

export type PhoneClaims = { phoneKey: Hex; e164: string; verifiedAt?: number };

export class Tokens {
  constructor(private readonly secret: Uint8Array) {}

  /** Proves a number was verified by OTP. It never moves money on its own. */
  async phoneToken(c: PhoneClaims): Promise<string> {
    return new SignJWT({ pk: c.phoneKey, e164: c.e164, ...(c.verifiedAt === undefined ? {} : { verifiedAt: c.verifiedAt }) })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setAudience("phone")
      .setIssuedAt()
      .setExpirationTime(PHONE_TOKEN_TTL)
      .sign(this.secret);
  }

  async verifyPhoneToken(token: string): Promise<PhoneClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, audience: "phone", algorithms: ["HS256"] });
      if (typeof payload.pk !== "string" || !isHex(payload.pk) || typeof payload.e164 !== "string") throw new Error("bad claims");
      if (payload.verifiedAt !== undefined && (!Number.isSafeInteger(payload.verifiedAt) || Number(payload.verifiedAt) < 0)) throw new Error("bad verification time");
      return { phoneKey: payload.pk, e164: payload.e164, ...(payload.verifiedAt === undefined ? {} : { verifiedAt: Number(payload.verifiedAt) }) };
    } catch {
      throw errors.phoneCheckExpired();
    }
  }

  async sessionToken(address: Address): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setAudience("session")
      .setSubject(address)
      .setIssuedAt()
      .setExpirationTime(SESSION_TTL)
      .sign(this.secret);
  }

  async verifySessionToken(token: string): Promise<Address> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, audience: "session", algorithms: ["HS256"] });
      return getAddress(payload.sub ?? "");
    } catch {
      throw errors.sessionExpired();
    }
  }
}

// EIP-191 messages, exactly as in docs/api.md. The app signs them with the account key.
export function registerMessage(m: { phone: string; address: Address; issuedAt: number }): string {
  return `BilbyPay: link phone to this account\nPhone: ${m.phone}\nAccount: ${m.address}\nIssued: ${m.issuedAt}`;
}

export function signInMessage(m: { address: Address; issuedAt: number }): string {
  return `BilbyPay: sign in\nAccount: ${m.address}\nIssued: ${m.issuedAt}`;
}

/**
 * Checks an EIP-191 signature over `build(address)`. Accepts the address checksummed (canonical)
 * or lowercase in the message, so either app formatting works.
 */
export async function verifySignedMessage(args: {
  address: string;
  issuedAt: number;
  signature: Hex;
  build: (address: Address) => string;
  nowSeconds?: number;
}): Promise<Address> {
  let address: Address;
  try {
    address = getAddress(args.address);
  } catch {
    throw errors.invalidRequest();
  }
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(args.issuedAt) || Math.abs(now - args.issuedAt) > MESSAGE_MAX_AGE_SECONDS) {
    throw new ApiError(400, "ACTION_EXPIRED", "That took too long. Check your phone's date and time, then try again.");
  }
  for (const form of [address, address.toLowerCase() as Address]) {
    try {
      if (await verifyMessage({ address, message: args.build(form), signature: args.signature })) return address;
    } catch {}
  }
  throw errors.badSignature();
}
