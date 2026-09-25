import { describe, expect, it, vi } from "vitest";
import { ApiError, OFFLINE_MESSAGE } from "./errors";
import { createHttpApi } from "./http";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => { status?: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const r = respond(call);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe("http api client", () => {
  it("sends JSON to the documented routes", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { ok: true, expiresInSeconds: 600 } }));
    const api = createHttpApi({ baseUrl: "https://api.example.com/", getToken: () => null, fetch });
    await expect(api.otpStart("+14155550123", "US")).resolves.toEqual({ ok: true, expiresInSeconds: 600 });
    expect(calls[0]!.url).toBe("https://api.example.com/v1/otp/start");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ phone: "+14155550123", region: "US" });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("adds the bearer token on protected routes and encodes path/query parts", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { items: [] } }));
    const api = createHttpApi({ baseUrl: "https://api.example.com", getToken: () => "tok", fetch });
    await api.activity("a b/c");
    await api.submitAction("act/1", { payment: "0x01" });
    expect(calls[0]!.url).toBe("https://api.example.com/v1/activity?cursor=a%20b%2Fc");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(calls[1]!.url).toBe("https://api.example.com/v1/actions/act%2F1/submit");
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ signatures: { payment: "0x01" } });
  });

  it("covers every route in docs/api.md", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const api = createHttpApi({ baseUrl: "https://x", getToken: () => "t", fetch });
    await api.otpVerify("+1", "000000");
    await api.register({ phoneToken: "p", address: "0x1", displayName: "A", issuedAt: 1, signature: "0x2" });
    await api.session({ address: "0x1", issuedAt: 1, signature: "0x2" });
    await api.me();
    await api.balance();
    await api.resolve(["+1"], "US");
    await api.prepareAction({ type: "send", params: { phone: "+1", amount: "1" } });
    await api.claim("ABC");
    await api.acceptClaim("ABC", { phoneToken: "p" });
    await api.catalog();
    await api.quote("b", "1");
    await api.giftCards();
    await api.revealGiftCard("g1");
    await api.topupOrigins();
    await api.topupQuote("base:usdc", "1");
    await api.topupStatus("q1");
    expect(calls.map((c) => `${c.init.method} ${c.url.replace("https://x", "")}`)).toEqual([
      "POST /v1/otp/verify",
      "POST /v1/accounts/register",
      "POST /v1/session",
      "GET /v1/me",
      "GET /v1/balance",
      "POST /v1/resolve",
      "POST /v1/actions",
      "GET /v1/claims/ABC",
      "POST /v1/claims/ABC/accept",
      "GET /v1/giftcards/catalog?country=US",
      "POST /v1/giftcards/quote",
      "GET /v1/giftcards",
      "GET /v1/giftcards/g1/reveal",
      "GET /v1/topup/origins",
      "POST /v1/topup/quote",
      "GET /v1/topup/q1",
    ]);
  });

  it("surfaces the server's error code, message and extra fields", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 409,
      body: { error: { code: "BURROW_BUSY", message: "Some of your Burrow money is busy right now.", availableNow: "5000000" } },
    }));
    const api = createHttpApi({ baseUrl: "https://x", getToken: () => "t", fetch });
    const err = await api.prepareAction({ type: "burrow_withdraw", params: { amount: "9000000" } }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("BURROW_BUSY");
    expect(err.message).toBe("Some of your Burrow money is busy right now.");
    expect(err.details.availableNow).toBe("5000000");
    expect(err.status).toBe(409);
  });

  it("gives a human fallback for non-JSON server errors", async () => {
    const { fetch } = fakeFetch(() => ({ status: 502 }));
    const api = createHttpApi({ baseUrl: "https://x", getToken: () => null, fetch });
    const err = await api.claim("X").catch((e) => e);
    expect(err.code).toBe("INTERNAL");
    expect(err.message).toMatch(/try again/i);
  });

  it("maps network failures to an offline error", async () => {
    const { fetch } = fakeFetch(() => new TypeError("Network request failed"));
    const api = createHttpApi({ baseUrl: "https://x", getToken: () => null, fetch });
    const err = await api.catalog().catch((e) => e);
    expect(err.code).toBe("NETWORK");
    expect(err.message).toBe(OFFLINE_MESSAGE);
  });

  it("reports an expired session", async () => {
    const onSessionExpired = vi.fn();
    const { fetch } = fakeFetch(() => ({ status: 401, body: { error: { code: "SESSION_EXPIRED", message: "Please log in again." } } }));
    const api = createHttpApi({ baseUrl: "https://x", getToken: () => "old", fetch, onSessionExpired });
    await expect(api.me()).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it("treats a 401 OTP_EXPIRED as 'verify again', not as a lost session", async () => {
    const onSessionExpired = vi.fn();
    const { fetch } = fakeFetch(() => ({ status: 401, body: { error: { code: "OTP_EXPIRED", message: "Verify your number again to continue." } } }));
    const api = createHttpApi({ baseUrl: "https://x", getToken: () => "t", fetch, onSessionExpired });
    await expect(api.acceptClaim("C", { phoneToken: "old" })).rejects.toMatchObject({ code: "OTP_EXPIRED" });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("reports PHONE_REQUIRED so the app can go to the phone step", async () => {
    const onPhoneRequired = vi.fn();
    const { fetch } = fakeFetch(() => ({ status: 403, body: { error: { code: "PHONE_REQUIRED", message: "Add your phone number to continue." } } }));
    const api = createHttpApi({ baseUrl: "https://x", getToken: () => "t", fetch, onPhoneRequired });
    await expect(api.me()).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
    expect(onPhoneRequired).toHaveBeenCalledOnce();
  });

  it("does not call protected routes without a session", async () => {
    const onSessionExpired = vi.fn();
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const api = createHttpApi({ baseUrl: "https://x", getToken: () => null, fetch, onSessionExpired });
    await expect(api.balance()).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(calls).toHaveLength(0);
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });
});
