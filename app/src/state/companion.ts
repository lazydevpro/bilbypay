import * as SecureStore from "expo-secure-store";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { companionForLocalTime, DEFAULT_COMPANION, parseCompanionPreferences, type CompanionPreferences } from "./companionModel";

export type { CompanionScene } from "./companionModel";
const KEY = "bilbypay_companion_v1";
type Snapshot = CompanionPreferences & { hydrated: boolean; error: string | null };
let snapshot: Snapshot = { ...DEFAULT_COMPANION, hydrated: false, error: null };
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
let saving = Promise.resolve();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => snapshot;

async function hydrate() {
  if (!loading) loading = (async () => {
    try {
      const raw = Platform.OS === "web" ? globalThis.localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
      snapshot = { ...parseCompanionPreferences(raw), hydrated: true, error: null };
    } catch {
      // Keep Bilby still until we know whether the person previously disabled movement.
      snapshot = { ...snapshot, hydrated: false, error: "We couldn't load your motion preference. Please try again." };
    }
    emit();
  })();
  await loading;
}

export function useCompanionPreferences() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => { void hydrate(); }, []);
  return value;
}

export async function reloadCompanionPreferences(): Promise<void> {
  if (!snapshot.error) return;
  loading = undefined;
  await hydrate();
}

export async function saveCompanionPreferences(patch: Partial<CompanionPreferences>): Promise<void> {
  await hydrate();
  if (!snapshot.hydrated) throw new Error("Motion preferences are unavailable.");
  const persist = async () => {
    const next = parseCompanionPreferences(JSON.stringify({ ...snapshot, ...patch }));
    if (Platform.OS === "web") globalThis.localStorage.setItem(KEY, JSON.stringify(next));
    else await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    snapshot = { ...next, hydrated: true, error: null };
    emit();
  };
  saving = saving.catch(() => {}).then(persist);
  await saving;
}

/** Refresh at least once a minute and immediately after returning to the app or browser tab. */
export function useCompanionTime(enabled = true) {
  const [time, setTime] = useState(() => companionForLocalTime(new Date()));
  useEffect(() => {
    if (!enabled) return;
    const update = () => setTime(companionForLocalTime(new Date()));
    const onVisible = () => { if (document.visibilityState === "visible") update(); };
    const subscription = AppState.addEventListener("change", state => { if (state === "active") update(); });
    const timer = setInterval(update, 60_000);
    if (Platform.OS === "web" && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    update();
    return () => {
      clearInterval(timer);
      subscription.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
  return time;
}
