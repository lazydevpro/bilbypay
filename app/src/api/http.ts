import { ApiError, FALLBACK_MESSAGE, OFFLINE_MESSAGE } from "./errors";
import type { BilbyApi } from "./types";

export type HttpApiOptions = {
  baseUrl: string;
  /** Returns the current session token, if any. */
  getToken: () => string | null;
  /** Called when the server says the session is over (the app then asks for Face ID again). */
  onSessionExpired?: () => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type Method = "GET" | "POST";

export function createHttpApi(opts: HttpApiOptions): BilbyApi {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function call<T>(method: Method, path: string, body?: unknown, auth = false): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const token = opts.getToken();
      if (!token) {
        opts.onSessionExpired?.();
        throw new ApiError("SESSION_EXPIRED", "Please unlock BilbyPay with Face ID to continue.", 401);
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError("NETWORK", OFFLINE_MESSAGE);
    } finally {
      clearTimeout(timer);
    }

    let json: unknown = null;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } & Record<string, unknown> } | null)?.error;
      const { code, message, ...rest } = err ?? {};
      // Extra fields may sit next to `error` (e.g. availableNow) or inside it; keep both.
      const outer = { ...(json as Record<string, unknown> | null) };
      delete outer.error;
      const apiError = new ApiError(code ?? (res.status >= 500 ? "INTERNAL" : "UNKNOWN"), message ?? FALLBACK_MESSAGE, res.status, {
        ...outer,
        ...rest,
      });
      if (apiError.code === "SESSION_EXPIRED" || (auth && res.status === 401)) opts.onSessionExpired?.();
      throw apiError;
    }
    return json as T;
  }

  const enc = encodeURIComponent;

  return {
    otpStart: (phone, region) => call("POST", "/v1/otp/start", { phone, region }),
    otpVerify: (phone, code) => call("POST", "/v1/otp/verify", { phone, code }),
    register: (req) => call("POST", "/v1/accounts/register", req),
    session: (req) => call("POST", "/v1/session", req),
    me: () => call("GET", "/v1/me", undefined, true),
    balance: () => call("GET", "/v1/balance", undefined, true),
    resolve: (phones, region) => call("POST", "/v1/resolve", { phones, region }, true),
    prepareAction: (req) => call("POST", "/v1/actions", req, true),
    submitAction: (id, signatures) => call("POST", `/v1/actions/${enc(id)}/submit`, { signatures }, true),
    activity: (cursor) => call("GET", `/v1/activity${cursor ? `?cursor=${enc(cursor)}` : ""}`, undefined, true),
    claim: (code) => call("GET", `/v1/claims/${enc(code)}`),
    acceptClaim: (code, body) => call("POST", `/v1/claims/${enc(code)}/accept`, body, true),
    catalog: (country = "US") => call("GET", `/v1/giftcards/catalog?country=${enc(country)}`),
    quote: (brandId, amount) => call("POST", "/v1/giftcards/quote", { brandId, amount }),
    giftCards: () => call("GET", "/v1/giftcards", undefined, true),
    revealGiftCard: (id) => call("GET", `/v1/giftcards/${enc(id)}/reveal`, undefined, true),
    topupOrigins: () => call("GET", "/v1/topup/origins", undefined, true),
    topupQuote: (originAsset, amount) => call("POST", "/v1/topup/quote", { originAsset, amount }, true),
    topupStatus: (quoteId) => call("GET", `/v1/topup/${enc(quoteId)}`, undefined, true),
  };
}
