import { deriveEvmPrivateKey } from "@bilbypay/core";
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
} from "@category-labs/mera";
import { reactNativeWebAuthnClient } from "@category-labs/mera/react-native-webauthn-client";
import { toViemAccount } from "@category-labs/mera/viem";
import type { LocalAccount } from "viem";

/** Passkeys are scoped to this domain; it must serve AASA + assetlinks.json (see server/public/.well-known). */
export const RP_ID: string = process.env.EXPO_PUBLIC_RP_ID ?? "bilbypay.com";

export type Account = {
  address: `0x${string}`;
  /** Kept in memory only for this spike. Never persist it unencrypted. */
  prfOutput: Uint8Array;
};

function toAccount(prfOutput: Uint8Array): Account {
  const session = createSecp256k1SigningSession({ privateKey: deriveEvmPrivateKey(prfOutput) });
  try {
    return { address: getEvmAddress(session.publicKey), prfOutput };
  } finally {
    session.end();
  }
}

/** New user: creates a passkey (one Face ID, two on authenticators without create-time PRF). */
export async function createAccount(displayName: string): Promise<Account> {
  const { prfOutput } = await createPasskeyWithPrfOutput({
    rp: { id: RP_ID, name: "BilbyPay" },
    user: { name: displayName, displayName },
    webAuthnClient: reactNativeWebAuthnClient,
  });
  return toAccount(prfOutput);
}

/**
 * Returning user, a reinstall, or a new phone: the OS offers the saved passkey and we get the same
 * PRF output back, so the same account. No app storage involved (mera "stateless test").
 */
export async function signIn(): Promise<Account> {
  const { prfOutput } = await getPasskeyPrfOutput({
    rpId: RP_ID,
    webAuthnClient: reactNativeWebAuthnClient,
  });
  return toAccount(prfOutput);
}

/** Runs `fn` with a signer and wipes the key afterwards. Signing inside never prompts. */
export async function withSigner<T>(account: Account, fn: (signer: LocalAccount) => Promise<T>): Promise<T> {
  const session = createSecp256k1SigningSession({ privateKey: deriveEvmPrivateKey(account.prfOutput) });
  try {
    return await fn(toViemAccount(session));
  } finally {
    session.end();
  }
}
