import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, isApiError, setSessionExpiredHandler, setSessionToken } from "../api";
import type { Hex, OtpVerifyResponse, Profile } from "../api/types";
import * as store from "../auth/keyStore";
import { createNewAccount, logInWithPasskey, UnlockFailed, withAccount, withUnlockedSigner } from "../auth/unlock";
import { nowSeconds, registerMessage, sessionMessage } from "../signing/messages";

export type Status = "loading" | "signedOut" | "needsPhone" | "locked" | "ready";

/** A verified number (from /v1/otp/verify). Proves the number for 15 minutes; never moves money. */
export type Verification = OtpVerifyResponse & { at: number };
const VERIFICATION_TTL_MS = 14 * 60_000;

type Session = {
  status: Status;
  address: Hex | null;
  profile: Profile | null;
  verification: Verification | null;
  setVerification: (v: OtpVerifyResponse | null) => void;
  freshVerification: () => Verification | null;
  /** A claim link opened before onboarding; resumed once the person is in. */
  pendingClaim: string | null;
  setPendingClaim: (code: string | null) => void;
  /** New person: passkey (Face ID) → link the verified number. */
  createAccount: (displayName: string) => Promise<void>;
  /** "I already have an account": passkey → session. */
  logIn: () => Promise<void>;
  /** Link the verified number to this (existing) account: first number, new number, or a claim. */
  linkNumber: (displayName?: string) => Promise<void>;
  /** Session ran out: one Face ID to get a new one. */
  unlock: () => Promise<void>;
  logOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setProfile: (p: Profile) => void;
};

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

const expiredVerification = () =>
  new UnlockFailed("Your code expired. Enter your number again and we'll text you a new one.");

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [address, setAddress] = useState<Hex | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [verification, setVerificationState] = useState<Verification | null>(null);
  const [pendingClaim, setPendingClaimState] = useState<string | null>(null);
  const verificationRef = useRef<Verification | null>(null);
  const addressRef = useRef<Hex | null>(null);

  const setProfile = useCallback((p: Profile | null) => {
    setProfileState(p);
    void store.saveCachedProfile(p);
  }, []);

  const rememberAddress = useCallback(async (a: Hex) => {
    addressRef.current = a;
    setAddress(a);
    await store.saveAccountId(a);
  }, []);

  const startSession = useCallback(
    async (token: string, p: Profile | null) => {
      setSessionToken(token);
      await store.saveSessionToken(token);
      setProfile(p);
      setStatus(p ? "ready" : "needsPhone");
    },
    [setProfile],
  );

  // Boot: restore what we have, no prompts.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [token, acct, cached, claim] = await Promise.all([
        store.loadSessionToken(),
        store.loadAccountId(),
        store.loadCachedProfile(),
        store.loadPendingClaim(),
      ]);
      if (!alive) return;
      if (claim) setPendingClaimState(claim);
      if (acct) {
        addressRef.current = acct;
        setAddress(acct);
      }
      if (!acct) return setStatus("signedOut");
      if (!token) return setStatus("locked");
      setSessionToken(token);
      try {
        const me = await api.me();
        if (!alive) return;
        setProfile(me);
        setStatus("ready");
      } catch (e) {
        if (!alive) return;
        if (isApiError(e) && (e.code === "PHONE_REQUIRED" || e.code === "NOT_FOUND")) setStatus("needsPhone");
        else if (isApiError(e) && e.code === "NETWORK" && cached) {
          setProfileState(cached);
          setStatus("ready"); // offline: show cached, screens show the offline note
        } else setStatus("locked");
      }
    })();
    return () => {
      alive = false;
    };
  }, [setProfile]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setSessionToken(null);
      void store.saveSessionToken("");
      setStatus((s) => (s === "ready" || s === "needsPhone" ? "locked" : s));
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const setVerification = useCallback((v: OtpVerifyResponse | null) => {
    const next = v ? { ...v, at: Date.now() } : null;
    verificationRef.current = next;
    setVerificationState(next);
  }, []);

  const freshVerification = useCallback(() => {
    const v = verificationRef.current;
    return v && Date.now() - v.at < VERIFICATION_TTL_MS ? v : null;
  }, []);

  const setPendingClaim = useCallback((code: string | null) => {
    setPendingClaimState(code);
    void store.savePendingClaim(code);
  }, []);

  const register = useCallback(
    async (v: Verification, a: Hex, displayName: string, sign: (message: string) => Promise<Hex>) => {
      const issuedAt = nowSeconds();
      const signature = await sign(registerMessage(v.phone, a, issuedAt));
      const res = await api.register({ phoneToken: v.phoneToken, address: a, displayName, issuedAt, signature });
      await startSession(res.sessionToken, res.profile);
    },
    [startSession],
  );

  const linkNumber = useCallback(
    async (displayName?: string) => {
      const v = freshVerification();
      if (!v) throw expiredVerification();
      const a = addressRef.current;
      if (!a) throw new UnlockFailed("Please log in first.");
      const name = (displayName ?? profile?.displayName ?? "").trim();
      if (!name) throw new UnlockFailed("Add your name so friends know it's you.");
      await register(v, a, name, (message) => withUnlockedSigner(a, (s) => s.signMessage({ message })));
    },
    [freshVerification, profile, register],
  );

  const createAccount = useCallback(
    async (displayName: string) => {
      const v = freshVerification();
      if (!v) throw expiredVerification();
      // A retry after a failed link must not create a second passkey.
      if (addressRef.current) return linkNumber(displayName);
      const acct = await createNewAccount(displayName.trim());
      await rememberAddress(acct.address);
      await register(v, acct.address, displayName.trim(), (message) => withAccount(acct, (s) => s.signMessage({ message })));
    },
    [freshVerification, linkNumber, register, rememberAddress],
  );

  const openSession = useCallback(
    async (a: Hex, sign: (message: string) => Promise<Hex>) => {
      const issuedAt = nowSeconds();
      const signature = await sign(sessionMessage(a, issuedAt));
      const res = await api.session({ address: a, issuedAt, signature });
      await startSession(res.sessionToken, res.profile);
    },
    [startSession],
  );

  const logIn = useCallback(async () => {
    const acct = await logInWithPasskey();
    await rememberAddress(acct.address);
    await openSession(acct.address, (message) => withAccount(acct, (s) => s.signMessage({ message })));
  }, [openSession, rememberAddress]);

  const unlock = useCallback(async () => {
    const a = addressRef.current;
    if (!a) return logIn();
    await openSession(a, (message) => withUnlockedSigner(a, (s) => s.signMessage({ message })));
  }, [logIn, openSession]);

  const logOut = useCallback(async () => {
    setSessionToken(null);
    await store.clearAll();
    addressRef.current = null;
    verificationRef.current = null;
    setAddress(null);
    setProfileState(null);
    setVerificationState(null);
    setPendingClaimState(null);
    setStatus("signedOut");
  }, []);

  const refreshProfile = useCallback(async () => {
    setProfile(await api.me());
  }, [setProfile]);

  const value = useMemo<Session>(
    () => ({
      status,
      address,
      profile,
      verification,
      setVerification,
      freshVerification,
      pendingClaim,
      setPendingClaim,
      createAccount,
      logIn,
      linkNumber,
      unlock,
      logOut,
      refreshProfile,
      setProfile,
    }),
    [status, address, profile, verification, setVerification, freshVerification, pendingClaim, setPendingClaim, createAccount, logIn, linkNumber, unlock, logOut, refreshProfile, setProfile],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
