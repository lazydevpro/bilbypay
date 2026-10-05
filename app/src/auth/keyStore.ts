import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { Profile } from "../api/types";
import { API_URL, CHAIN_ID, DIRECTORY_ADDRESS } from "../config";

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

// A preview and a deployed test environment may share the same browser origin.
// Never restore one environment's session or test account into another.
const webKey = (key: string) => `${key}:${CHAIN_ID}:${API_URL}:${DIRECTORY_ADDRESS.toLowerCase()}`;

async function readPlain(key: string): Promise<string | null> {
  if (Platform.OS !== "web") return quietly(SecureStore.getItemAsync(key), null);
  try { return globalThis.sessionStorage.getItem(webKey(key)); }
  catch { return null; }
}

async function writePlain(key: string, value: string | null): Promise<void> {
  if (Platform.OS !== "web") {
    await quietly(value === null ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, value), undefined);
    return;
  }
  // Browser sessions survive a reload, but are discarded when the tab is closed.
  try {
    if (value === null) globalThis.sessionStorage.removeItem(webKey(key));
    else globalThis.sessionStorage.setItem(webKey(key), value);
  } catch { /* Storage may be unavailable in a restricted browser. */ }
}

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
  if (Platform.OS === "web") return;
  await quietly(SecureStore.deleteItemAsync(K.unlock, { requireAuthentication: true }), undefined);
}

// ── demo key (mock mode or Monad testnet only; see config.DEMO_KEY) ──────────────────────────────────────────────────

export async function demoSecret(): Promise<Uint8Array> {
  // SecureStore has no web implementation. This key is used only in explicit demo mode.
  const existing = Platform.OS === "web"
    ? globalThis.localStorage.getItem(webKey(K.demo))
    : await quietly(SecureStore.getItemAsync(K.demo), null);
  if (existing) return fromHex(existing);
  const fresh = new Uint8Array(32);
  globalThis.crypto.getRandomValues(fresh);
  if (Platform.OS === "web") globalThis.localStorage.setItem(webKey(K.demo), toHex(fresh));
  else await SecureStore.setItemAsync(K.demo, toHex(fresh));
  return fresh;
}

// ── plain items ───────────────────────────────────────────────────────────────────────────────

export const loadSessionToken = () => readPlain(K.session);
export const saveSessionToken = (t: string) => writePlain(K.session, t);

export const loadAccountId = () => readPlain(K.account) as Promise<`0x${string}` | null>;
export const saveAccountId = (a: string) => writePlain(K.account, a);

export async function loadCachedProfile(): Promise<Profile | null> {
  const raw = await readPlain(K.profile);
  try {
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}
export const saveCachedProfile = (p: Profile | null) =>
  writePlain(K.profile, p ? JSON.stringify(p) : null);

export const loadPendingClaim = () => readPlain(K.claim);
export const savePendingClaim = (code: string | null) =>
  writePlain(K.claim, code);

/** The person has read the Burrow disclosure on this phone. */
export const loadBurrowAck = async () => (await readPlain(K.burrowAck)) === "1";
export const saveBurrowAck = () => writePlain(K.burrowAck, "1");

/** Log out: forget everything local. The passkey stays with the phone's password manager. */
export async function clearAll(): Promise<void> {
  await deleteUnlockSecret();
  await Promise.all([K.session, K.account, K.profile, K.claim].map((k) => writePlain(k, null)));
}
