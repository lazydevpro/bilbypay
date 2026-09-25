import { isMeraError } from "@category-labs/mera";
import type { LocalAccount } from "viem";
import { type Account, accountFromPrf, createAccount, signIn, withSigner } from "../account";
import type { Hex } from "../api/types";
import { DEMO_KEY } from "../config";
import { demoSecret, readUnlockSecret, saveUnlockSecret } from "./keyStore";

/** The person dismissed Face ID / the passkey sheet. Screens treat this as "nothing happened". */
export class UnlockCancelled extends Error {
  readonly userMessage = "Cancelled. Nothing was sent.";
  constructor() {
    super("cancelled");
    this.name = "UnlockCancelled";
  }
}

export class UnlockFailed extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "UnlockFailed";
  }
}

const looksCancelled = (e: unknown) => /cancel/i.test(String((e as Error)?.message ?? e));

function passkeyError(e: unknown): Error {
  if (looksCancelled(e)) return new UnlockCancelled();
  if (isMeraError(e) && e.code === "PRF_UNAVAILABLE") {
    return new UnlockFailed("This phone's passkeys can't be used with BilbyPay yet. Update your phone and try again.");
  }
  return new UnlockFailed("Face ID didn't go through. Please try again.");
}

/** New person: creates their passkey (one Face ID) and keeps the secret behind Face ID for later. */
export async function createNewAccount(displayName: string): Promise<Account> {
  let acct: Account;
  try {
    acct = DEMO_KEY ? accountFromPrf(await demoSecret()) : await createAccount(displayName);
  } catch (e) {
    throw passkeyError(e);
  }
  if (!DEMO_KEY) await saveUnlockSecret(acct.prfOutput);
  return acct;
}

/** Returning person on a new phone or after a reinstall: passkey sheet, same account back. */
export async function logInWithPasskey(): Promise<Account> {
  let acct: Account;
  try {
    acct = DEMO_KEY ? accountFromPrf(await demoSecret()) : await signIn();
  } catch (e) {
    throw passkeyError(e);
  }
  if (!DEMO_KEY) await saveUnlockSecret(acct.prfOutput);
  return acct;
}

/**
 * One biometric prompt → the account secret, for exactly one action. Reads the Face ID-gated copy;
 * if it's gone (reinstall, new fingerprints) it falls back to the passkey, which is also one prompt.
 */
async function unlockSecret(): Promise<Uint8Array> {
  if (DEMO_KEY) return demoSecret();
  try {
    const stored = await readUnlockSecret();
    if (stored) return stored;
  } catch (e) {
    if (looksCancelled(e)) throw new UnlockCancelled();
    // Invalidated key (biometrics changed): fall through to the passkey.
  }
  const acct = await logInWithPasskey();
  return acct.prfOutput;
}

/**
 * Runs `fn` with the account's signer: read → authorize → drop. The secret never outlives this call.
 * `expected` guards against the person picking a different passkey than the one for this account.
 */
export async function withUnlockedSigner<T>(expected: Hex | null, fn: (signer: LocalAccount) => Promise<T>): Promise<T> {
  const prf = await unlockSecret();
  try {
    const acct = accountFromPrf(prf);
    if (expected && acct.address.toLowerCase() !== expected.toLowerCase()) {
      throw new UnlockFailed("That passkey belongs to a different BilbyPay account. Pick the one you use for this number.");
    }
    return await withSigner(acct, fn);
  } finally {
    prf.fill(0);
  }
}

/** Same as withUnlockedSigner, for an account object we already hold (right after create/log in). */
export async function withAccount<T>(acct: Account, fn: (signer: LocalAccount) => Promise<T>): Promise<T> {
  try {
    return await withSigner(acct, fn);
  } finally {
    acct.prfOutput.fill(0);
  }
}
