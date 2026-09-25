import * as SecureStore from "expo-secure-store";
import type { Profile } from "../api/types";

/**
 * What BilbyPay keeps on the device:
 * - the passkey-derived secret, behind a biometric check (one Face ID per money action);
 * - the session token and account id (no biometric; they can't move money);
 * - a cached profile so the home screen renders offline.
 */
const K = {
  unlock: "bilbypay_unlock_v1",
  session: "bilbypay_session_v1",
  account: "bilbypay_account_v1",
  profile: "bilbypay_profile_v1",
  claim: "bilbypay_pending_claim_v1",
  demo: "bilbypay_demo_secret_v1",
  burrowAck: "bilbypay_burrow_ack_v1",
} as const;

export const FACE_ID_PROMPT = "Confirm with Face ID";

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function quietly<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

// ── biometric-gated secret ────────────────────────────────────────────────────────────────────

export function canUseBiometricStore(): boolean {
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

/** Saves the secret behind Face ID/fingerprint. Best effort: without it we fall back to the passkey. */
export async function saveUnlockSecret(prf: Uint8Array): Promise<void> {
  if (!canUseBiometricStore()) return;
  await quietly(
    SecureStore.setItemAsync(K.unlock, toHex(prf), {
      requireAuthentication: true,
      authenticationPrompt: FACE_ID_PROMPT,
      keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    }),
    undefined,
  );
}

/** One biometric prompt. Returns null when nothing is stored; throws if the person cancels. */
export async function readUnlockSecret(): Promise<Uint8Array | null> {
  const hex = await SecureStore.getItemAsync(K.unlock, {
    requireAuthentication: true,
    authenticationPrompt: FACE_ID_PROMPT,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  });
  return hex && hex.length === 64 ? fromHex(hex) : null;
}

export async function deleteUnlockSecret(): Promise<void> {
  await quietly(SecureStore.deleteItemAsync(K.unlock, { requireAuthentication: true }), undefined);
}

// ── demo key (mock mode on simulators only) ──────────────────────────────────────────────────

export async function demoSecret(): Promise<Uint8Array> {
  const existing = await quietly(SecureStore.getItemAsync(K.demo), null);
  if (existing) return fromHex(existing);
  const fresh = new Uint8Array(32);
  globalThis.crypto.getRandomValues(fresh);
  await SecureStore.setItemAsync(K.demo, toHex(fresh));
  return fresh;
}

// ── plain items ───────────────────────────────────────────────────────────────────────────────

export const loadSessionToken = () => quietly(SecureStore.getItemAsync(K.session), null);
export const saveSessionToken = (t: string) => quietly(SecureStore.setItemAsync(K.session, t), undefined);

export const loadAccountId = () => quietly(SecureStore.getItemAsync(K.account), null) as Promise<`0x${string}` | null>;
export const saveAccountId = (a: string) => quietly(SecureStore.setItemAsync(K.account, a), undefined);

export async function loadCachedProfile(): Promise<Profile | null> {
  const raw = await quietly(SecureStore.getItemAsync(K.profile), null);
  try {
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}
export const saveCachedProfile = (p: Profile | null) =>
  quietly(p ? SecureStore.setItemAsync(K.profile, JSON.stringify(p)) : SecureStore.deleteItemAsync(K.profile), undefined);

export const loadPendingClaim = () => quietly(SecureStore.getItemAsync(K.claim), null);
export const savePendingClaim = (code: string | null) =>
  quietly(code ? SecureStore.setItemAsync(K.claim, code) : SecureStore.deleteItemAsync(K.claim), undefined);

/** The person has read the Burrow disclosure on this phone. */
export const loadBurrowAck = async () => (await quietly(SecureStore.getItemAsync(K.burrowAck), null)) === "1";
export const saveBurrowAck = () => quietly(SecureStore.setItemAsync(K.burrowAck, "1"), undefined);

/** Log out: forget everything local. The passkey stays with the phone's password manager. */
export async function clearAll(): Promise<void> {
  await deleteUnlockSecret();
  await Promise.all([K.session, K.account, K.profile, K.claim].map((k) => quietly(SecureStore.deleteItemAsync(k), undefined)));
}
