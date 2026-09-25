import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const SALT = utf8ToBytes("bilbypay");
const INFO = "bilbypay/evm/secp256k1/v1";

/**
 * Derives the account's secp256k1 private key from a passkey PRF output.
 *
 * Deterministic: the same passkey (same credential, rpId and PRF salt) always yields the same
 * key, which is what lets a user clear the app or switch phones and get the same account back.
 * Changing SALT or INFO changes every user's account — never do that without a migration.
 */
export function deriveEvmPrivateKey(prfOutput: Uint8Array): Uint8Array {
  if (prfOutput.length !== 32) throw new Error("PRF output must be 32 bytes");
  // A 32-byte HKDF output is outside [1, n) with probability ~2^-128; the counter is belt and braces.
  for (let counter = 0; counter < 256; counter++) {
    const info = utf8ToBytes(counter === 0 ? INFO : `${INFO}/${counter}`);
    const key = hkdf(sha256, prfOutput, SALT, info, 32);
    if (secp256k1.utils.isValidSecretKey(key)) return key;
  }
  throw new Error("Could not derive a valid key");
}
