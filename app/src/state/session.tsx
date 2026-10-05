import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, isApiError, setPhoneRequiredHandler, setSessionExpiredHandler, setSessionToken } from "../api";
import type { DirectoryConsent, Hex, OtpVerifyResponse, Profile, RegisterResponse } from "../api/types";
import * as store from "../auth/keyStore";
import { createNewAccount, logInWithPasskey, UnlockFailed, withAccount, withUnlockedSigner } from "../auth/unlock";
import { CHAIN_ID } from "../config";
import { checkDirectoryConsent } from "../signing/directory";
import { nowSeconds, registerMessage, sessionMessage } from "../signing/messages";

export type Status = "loading" | "signedOut" | "needsPhone" | "pendingPhone" | "locked" | "ready";

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
  /** Prepare exact number-link consent for review before confirmation. */
  prepareNumber: (displayName: string) => Promise<DirectoryConsent>;
  confirmNumber: (prepared: DirectoryConsent, displayName: string) => Promise<RegisterResponse>;
  /** "I already have an account": passkey → session. */
  logIn: () => Promise<void>;
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
  const enrollmentRef = useRef<{ id: string; phone: string; address: Hex } | null>(null);

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
      if (p) setStatus("ready");
      else {
        const number = await api.phoneStatus().catch(() => null);
        setStatus(number?.status === "pending" ? "pendingPhone" : "needsPhone");
      }
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
        if (isApiError(e) && (e.code === "PHONE_REQUIRED" || e.code === "NOT_FOUND")) {
          const number = await api.phoneStatus().catch(() => null);
          if (alive) setStatus(number?.status === "pending" ? "pendingPhone" : "needsPhone");
        }
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
      setStatus((s) => (s === "ready" || s === "needsPhone" || s === "pendingPhone" ? "locked" : s));
    });
    // Signed in, but the account has no number yet (e.g. it was never linked): go to the phone step.
    setPhoneRequiredHandler(() => {
      // A former number holder retains their account and balance. Number-specific
      // actions show their own recovery instructions without replacing the key.
      if (!profile) setStatus((s) => (s === "ready" ? "needsPhone" : s));
    });
    return () => {
      setSessionExpiredHandler(null);
      setPhoneRequiredHandler(null);
    };
  }, [profile]);

  const setVerification = useCallback((v: OtpVerifyResponse | null) => {
    enrollmentRef.current = null;
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

  const prepareNumber = useCallback(async (displayName: string) => {
    const v = freshVerification();
    if (!v) throw expiredVerification();
    if (!displayName.trim()) throw new UnlockFailed("Add your name so friends know it's you.");
    let a = addressRef.current;
    if (!a) {
      const acct = await createNewAccount(displayName.trim());
      try { await rememberAddress(acct.address); a = acct.address; }
      finally { acct.prfOutput.fill(0); }
    }
    const prepared = await api.prepareRegistration({ phoneToken: v.phoneToken, address: a });
    if (!["bind", "requestRecovery", "finalizeRecovery"].includes(prepared.operation)) throw new UnlockFailed("We couldn't confirm these details. Please try again.");
    checkDirectoryConsent(prepared, { account: a, chainId: CHAIN_ID, operation: prepared.operation });
    enrollmentRef.current = { id: prepared.id, phone: v.phone, address: a };
    return prepared;
  }, [freshVerification, rememberAddress]);

  const confirmNumber = useCallback(async (prepared: DirectoryConsent, displayName: string) => {
    const v = freshVerification();
    if (!v) throw expiredVerification();
    const a = addressRef.current;
    if (!a) throw new UnlockFailed("Please log in first.");
    if (enrollmentRef.current?.id !== prepared.id || enrollmentRef.current.phone !== v.phone || enrollmentRef.current.address !== a) throw new UnlockFailed("The details changed. Please review your number again.");
    if (!["bind", "requestRecovery", "finalizeRecovery"].includes(prepared.operation)) throw new UnlockFailed("We couldn't confirm these details. Please try again.");
    const td = checkDirectoryConsent(prepared, { account: a, chainId: CHAIN_ID, operation: prepared.operation });
    const issuedAt = nowSeconds();
    const proofs = await withUnlockedSigner(a, async signer => ({
      signature: await signer.signMessage({ message: registerMessage(v.phone, a, issuedAt) }),
      consentSignature: await signer.signTypedData(td),
    }));
    const res = await api.register({ phoneToken: v.phoneToken, address: a, displayName: displayName.trim(), issuedAt, registrationId: prepared.id, ...proofs });
    await startSession(res.sessionToken, res.profile);
    setVerification(null);
    return res;
  }, [freshVerification, setVerification, startSession]);

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
      prepareNumber,
      confirmNumber,
      logIn,
      unlock,
      logOut,
      refreshProfile,
      setProfile,
    }),
    [status, address, profile, verification, setVerification, freshVerification, pendingClaim, setPendingClaim, prepareNumber, confirmNumber, logIn, unlock, logOut, refreshProfile, setProfile],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
