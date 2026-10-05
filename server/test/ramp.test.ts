import { generateKeyPairSync, sign } from "node:crypto";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tokens } from "../src/auth";
import { loadRampConfig, type RampConfig } from "../src/config";
import { openDb, type Db } from "../src/db";
import { ApiError } from "../src/errors";
import { canonicalRampJson, RampFundingService, RAMP_DEMO_API, RAMP_DEMO_WIDGET, type FundingSession } from "../src/ramp";
import { fundingRoutes } from "../src/routes/funding";
import type { AppEnv } from "../src/routes/common";
import { decryptSecret } from "../src/secrets";
import type { Services } from "../src/services";

// Test-only signing key; the running server pins Ramp's published demo verification key.
const signing = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
const owner = getAddress("0x1111111111111111111111111111111111111111");
const otherOwner = getAddress("0x2222222222222222222222222222222222222222");
const secret = Buffer.alloc(32, 37);
const encryptionKey = Buffer.alloc(32, 55);
const config: RampConfig = {
  mode: "sandbox", hostApiKey: "test-integration-id", hostLogoUrl: "https://bilby.example/logo.png",
  webhookBaseUrl: "https://api.bilby.example", returnOrigins: ["https://bilby.example", "http://localhost:8081", "bilbypay://"],
  sandboxAsset: "BASE_USDC",
};
const asset = { chain: "BASE", symbol: "USDC", type: "ERC20", decimals: 6, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
const assets = { currencyCode: "USD", minPurchaseAmount: 3.39, maxPurchaseAmount: 22589.17,
  assets: [{ ...asset, enabled: true, hidden: false, currencyCode: "USD", minPurchaseAmount: -1, maxPurchaseAmount: -1 }] };
const input = { amount: "25000000", returnUrl: "https://bilby.example/funding", idempotencyKey: "checkout_test_001" };
const dbs: Db[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function fixture(overrides: Partial<RampConfig> = {}) {
  const db = openDb(":memory:"); dbs.push(db);
  let now = Date.parse("2026-10-01T00:00:00Z");
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(assets), { headers: { "content-type": "application/json" } }));
  const create = () => new RampFundingService(db, { ...config, ...overrides }, secret, encryptionKey, { fetch: fetcher, now: () => now, webhookPublicKey: signing.publicKey });
  const service = create();
  const purchase = (session: FundingSession, changes: Record<string, unknown> = {}) => ({
    id: `purchase_${session.id}`, receiverAddress: new URL(session.checkoutUrl!).searchParams.get("userAddress"),
    fiatCurrency: "USD", fiatValue: 25, status: "INITIALIZED", asset, appliedFee: 0.99,
    createdAt: session.createdAt, updatedAt: new Date(now).toISOString(), purchaseViewToken: "test-private-view-token", ...changes,
  });
  const row = (id: string) => db.prepare("SELECT * FROM ramp_sessions WHERE id=?").get(id)!;
  const deliver = (session: FundingSession, changes: Record<string, unknown> = {}, type = "CREATED") => {
    const body = { type, purchase: purchase(session, changes) };
    const signature = sign("sha256", Buffer.from(canonicalRampJson(body)), signing.privateKey).toString("base64");
    service.webhook(session.id, JSON.stringify(body, null, 2), signature);
    return { body, signature };
  };
  return { db, service, create, fetcher, purchase, deliver, row, advance: (ms: number) => { now += ms; } };
}

describe("Ramp sandbox configuration and discovery", () => {
  it("defaults disabled, and refuses production modes or unsafe URL configuration", () => {
    expect(loadRampConfig({})).toMatchObject({ mode: "disabled", sandboxAsset: "BASE_USDC", returnOrigins: [] });
    expect(() => loadRampConfig({ RAMP_MODE: "live" })).toThrow("live funding is not implemented");
    for (const value of ["http://api.bilby.example", "https://127.0.0.1", "https://api.bilby.example/subpath", "https://user:password@api.bilby.example"]) {
      expect(() => loadRampConfig({ RAMP_WEBHOOK_BASE_URL: value })).toThrow();
    }
    for (const value of ["https://*.bilby.example", "https://bilby.example/funding", "http://bilby.example", "https://bilby.example/"]) {
      expect(() => loadRampConfig({ RAMP_RETURN_ORIGINS: value })).toThrow();
    }
    expect(loadRampConfig({ RAMP_MODE: "sandbox", RAMP_RETURN_ORIGINS: "http://localhost:8081, bilbypay://", RAMP_WEBHOOK_BASE_URL: "https://api.bilby.example/" }))
      .toMatchObject({ returnOrigins: ["http://localhost:8081", "bilbypay://"], webhookBaseUrl: "https://api.bilby.example" });
  });

  it.each([{ mode: "disabled" as const }, { hostApiKey: undefined }, { hostLogoUrl: undefined }, { webhookBaseUrl: undefined }, { returnOrigins: [] }])("stays unavailable without a complete sandbox setup: %j", async (overrides) => {
    const f = fixture(overrides);
    expect(await f.service.options()).toMatchObject({ environment: "sandbox", available: false, unavailableReason: "not_configured" });
    await expect(f.service.create(owner, input)).rejects.toMatchObject({ status: 503 });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT * FROM ramp_sessions").all()).toEqual([]);
  });

  it("discovers current limits at the pinned demo API and caches briefly", async () => {
    const f = fixture();
    const [first, second] = await Promise.all([f.service.options(), f.service.options()]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ available: true, minAmount: "3390000", maxAmount: "22589170000" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String(f.fetcher.mock.calls[0]![0]));
    expect(url.href.startsWith(`${RAMP_DEMO_API}/host-api/v3/assets?`)).toBe(true);
    expect(url.searchParams.get("currencyCode")).toBe("USD");
    expect(f.fetcher.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
    f.advance(60_001);
    await f.service.options();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["unsupported", "wrong address", "disabled", "hidden", "currency"])("fails closed for %s assets without falling back", async (kind) => {
    const f = fixture(kind === "unsupported" ? { sandboxAsset: "MONAD_AUSD" } : {});
    const data = structuredClone(assets);
    const a = data.assets[0]!;
    if (kind === "wrong address") a.address = otherOwner;
    if (kind === "disabled") a.enabled = false;
    if (kind === "hidden") a.hidden = true;
    if (kind === "currency") a.currencyCode = "EUR";
    f.fetcher.mockResolvedValue(new Response(JSON.stringify(data)));
    expect(await f.service.options()).toMatchObject({ available: false, unavailableReason: "asset_unavailable" });
  });

  it("reports provider outages and invalid responses without leaking provider diagnostics", async () => {
    const f = fixture();
    f.fetcher.mockRejectedValue(new Error("private provider debug details"));
    const options = await f.service.options();
    expect(options).toMatchObject({ available: false, unavailableReason: "provider_unavailable" });
    expect(JSON.stringify(options)).not.toContain("private provider");
  });
});

describe("owned, isolated sandbox sessions", () => {
  it("converts six-decimal dollars to Ramp cents and uses one same-tab return link", async () => {
    const f = fixture();
    const session = await f.service.create(owner, input);
    const checkout = new URL(session.checkoutUrl!);
    expect(checkout.origin).toBe(RAMP_DEMO_WIDGET);
    expect(Object.fromEntries(checkout.searchParams)).toMatchObject({ inAsset: "USD", outAsset: "BASE_USDC", inAssetValue: "2500", enabledFlows: "ONRAMP", defaultFlow: "ONRAMP", selectedCountryCode: "US" });
    expect(checkout.searchParams.get("finalUrl")).toBe(`https://bilby.example/funding?id=${session.id}`);
    expect(checkout.searchParams.has("successUrl")).toBe(false);
    expect(checkout.searchParams.has("failureUrl")).toBe(false);
    expect(checkout.searchParams.get("webhookStatusUrl")).toBe(`https://api.bilby.example/v1/funding/webhooks/ramp/${session.id}`);
    expect(checkout.searchParams.get("userAddress")).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(checkout.searchParams.get("userAddress")).not.toBe(owner);
    expect(await f.service.get(otherOwner, session.id).catch((e: ApiError) => e.code)).toBe("NOT_FOUND");
    const native = await f.service.create(owner, { ...input, idempotencyKey: "native_checkout", returnUrl: "bilbypay://funding" });
    expect(new URL(native.checkoutUrl!).searchParams.get("finalUrl")).toBe(`bilbypay://funding?id=${native.id}`);
  });

  it("persists idempotent creation across restarts, rejects changed requests, and isolates recipient per session", async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.service.create(owner, input), f.service.create(owner, input)]);
    expect(a).toEqual(b);
    expect(await f.create().create(owner, input)).toEqual(a);
    await expect(f.service.create(owner, { ...input, amount: "26000000" })).rejects.toMatchObject({ status: 409 });
    const other = await f.service.create(otherOwner, input);
    expect(other.id).not.toBe(a.id);
    expect(new URL(other.checkoutUrl!).searchParams.get("userAddress")).not.toBe(new URL(a.checkoutUrl!).searchParams.get("userAddress"));
    expect(f.db.prepare("SELECT * FROM ramp_sessions").all()).toHaveLength(2);
  });

  it.each(["0", "-1000000", "25000001", "1.5", "03390000", "3380000", "22589180000"])("rejects invalid or out-of-range amounts %s", async (amount) => {
    await expect(fixture().service.create(owner, { ...input, amount })).rejects.toMatchObject({ status: 400 });
  });

  it.each(["https://evil.example/funding", "https://bilby.example/other", "https://bilby.example/funding?next=https://evil.example", "https://bilby.example/funding#done", "https://user@bilby.example/funding", "bilbypay://evil/funding", "javascript:alert(1)"])("rejects open return navigation %s", async (returnUrl) => {
    await expect(fixture().service.create(owner, { ...input, returnUrl })).rejects.toMatchObject({ status: 400 });
  });

  it("expires abandoned sessions while accepting delayed signed evidence for an in-time purchase", async () => {
    const f = fixture();
    const session = await f.service.create(owner, input);
    f.advance(25 * 60 * 60_000);
    expect(await f.service.get(owner, session.id)).toMatchObject({ status: "expired" });
    f.deliver(session, { status: "RELEASED" }, "RELEASED");
    expect(await f.service.get(owner, session.id)).toMatchObject({ status: "completed" });
    const second = await f.service.create(owner, { ...input, idempotencyKey: "late_creation" });
    f.advance(25 * 60 * 60_000);
    expect(() => f.deliver(second, { createdAt: new Date(Date.parse(second.createdAt) + 25 * 60 * 60_000).toISOString(), status: "RELEASED" }, "RELEASED")).toThrow("Invalid provider update time");
  });
});

describe("verified sandbox provider updates", () => {
  it("verifies stable signed JSON, encrypts reconciliation secrets and records simulation completion once without credits", async () => {
    const f = fixture();
    f.db.prepare("INSERT INTO accounts(address,created_at,updated_at) VALUES(?,?,?)").run(owner, "now", "now");
    const accountBefore = f.db.prepare("SELECT * FROM accounts").all();
    const session = await f.service.create(owner, input);
    const event = f.deliver(session, { status: "RELEASED" }, "RELEASED");
    const result = await f.service.get(owner, session.id);
    expect(result).toMatchObject({ environment: "sandbox", status: "completed", fee: "990000", message: "Demo checkout completed. Your balance has not changed." });
    expect(result.checkoutUrl).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/receiverAddress|test-private-view-token|txHash|purchaseViewToken/);
    expect(f.row(session.id).provider_view_token_enc).not.toContain("test-private-view-token");
    expect(decryptSecret(encryptionKey, String(f.row(session.id).provider_view_token_enc), `ramp:${session.id}`)).toBe("test-private-view-token");
    f.service.webhook(session.id, JSON.stringify(event.body), event.signature);
    expect(f.db.prepare("SELECT * FROM ramp_events").all()).toHaveLength(1);
    expect(f.db.prepare("SELECT * FROM accounts").all()).toEqual(accountBefore);
    for (const table of ["actions", "activity", "topups"]) expect(f.db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  });

  it("rejects tampering, unsigned callbacks and signatures from another key", async () => {
    const f = fixture(); const session = await f.service.create(owner, input);
    const body = { type: "RELEASED", purchase: f.purchase(session, { status: "RELEASED" }) };
    const signature = sign("sha256", Buffer.from(canonicalRampJson(body)), signing.privateKey).toString("base64");
    const other = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    for (const value of [undefined, "garbage", sign("sha256", Buffer.from(canonicalRampJson(body)), other.privateKey).toString("base64")]) {
      expect(() => f.service.webhook(session.id, JSON.stringify(body), value)).toThrow("Invalid provider update");
    }
    expect(() => f.service.webhook(session.id, JSON.stringify({ ...body, type: "RETURNED" }), signature)).toThrow("Invalid provider update");
    expect((await f.service.get(owner, session.id)).status).toBe("pending");
  });

  it.each(["receiver", "amount", "currency", "asset", "precision", "future", "stale", "inconsistent"])("rejects signed but mismatched %s", async (kind) => {
    const f = fixture(); const session = await f.service.create(owner, input);
    const changes: Record<string, unknown> = { status: "RELEASED" };
    if (kind === "receiver") changes.receiverAddress = owner;
    if (kind === "amount") changes.fiatValue = 26;
    if (kind === "currency") changes.fiatCurrency = "EUR";
    if (kind === "asset") changes.asset = { ...asset, address: otherOwner };
    if (kind === "precision") changes.fiatValue = 25.001;
    if (kind === "future") changes.updatedAt = "2030-01-01T00:00:00Z";
    if (kind === "stale") changes.createdAt = "2026-09-01T00:00:00Z";
    if (kind === "inconsistent") changes.status = "INITIALIZED";
    expect(() => f.deliver(session, changes, "RELEASED")).toThrow();
    expect(f.row(session.id).status).toBe("pending");
    expect(f.db.prepare("SELECT * FROM ramp_events").all()).toEqual([]);
  });

  it("rejects callback path replay and reuse of a provider purchase in another session", async () => {
    const f = fixture(); const first = await f.service.create(owner, input);
    const second = await f.service.create(otherOwner, input);
    const event = f.deliver(first);
    expect(() => f.service.webhook(second.id, JSON.stringify(event.body), event.signature)).toThrow("does not match");
    expect(() => f.deliver(second, { id: event.body.purchase.id })).toThrow("already belongs");
    expect(() => f.deliver(first, { id: "different_purchase" })).toThrow("already has a provider purchase");
    expect(f.row(second.id).provider_purchase_id).toBeNull();
  });

  it("ignores older progress and terminal regressions while allowing payment-attempt retry", async () => {
    const f = fixture(); const session = await f.service.create(owner, input);
    f.deliver(session, { status: "PAYMENT_FAILED" });
    expect(f.row(session.id).status).toBe("processing");
    f.advance(1000); f.deliver(session, { status: "FIAT_RECEIVED" });
    f.advance(1000); f.deliver(session, { status: "INITIALIZED" });
    expect(f.row(session.id).provider_status).toBe("FIAT_RECEIVED");
    f.deliver(session, { status: "RELEASED", updatedAt: session.createdAt }, "RELEASED");
    expect(f.row(session.id).status).toBe("processing");
    f.deliver(session, { status: "RELEASED" }, "RELEASED");
    f.advance(1000); f.deliver(session, { status: "CANCELLED" });
    expect(f.row(session.id).status).toBe("completed");
  });

  it.each(["EXPIRED", "CANCELLED", "RETURNED"])("keeps provider %s final", async (kind) => {
    const f = fixture(); const session = await f.service.create(owner, input);
    f.deliver(session, { status: kind === "RETURNED" ? "PAYMENT_IN_PROGRESS" : kind }, kind === "RETURNED" ? "RETURNED" : "CREATED");
    const expected = kind === "EXPIRED" ? "expired" : kind === "CANCELLED" ? "cancelled" : "failed";
    f.advance(1000); f.deliver(session, { status: "RELEASED" }, "RELEASED");
    expect(f.row(session.id).status).toBe(expected);
  });

  it("reconciles missed updates only through the pinned demo API using encrypted purchase credentials", async () => {
    const f = fixture(); const session = await f.service.create(owner, input);
    f.deliver(session);
    f.advance(1000);
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify(f.purchase(session, { status: "RELEASED" }))));
    expect((await f.create().get(owner, session.id)).status).toBe("completed");
    const url = new URL(String(f.fetcher.mock.calls.at(-1)![0]));
    expect(url.href.startsWith(`${RAMP_DEMO_API}/host-api/purchase/purchase_`)).toBe(true);
    expect(url.searchParams.get("secret")).toBe("test-private-view-token");
  });

  it("preserves pending status through reconciliation failures and rejects mismatched polling results", async () => {
    const f = fixture(); const session = await f.service.create(owner, input);
    f.deliver(session);
    f.fetcher.mockRejectedValueOnce(new Error("provider unavailable"));
    expect((await f.service.get(owner, session.id)).status).toBe("pending");
    const count = f.fetcher.mock.calls.length;
    await f.service.get(owner, session.id);
    expect(f.fetcher).toHaveBeenCalledTimes(count);
    f.advance(30_001);
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify(f.purchase(session, { status: "RELEASED", fiatValue: 24 }))));
    expect((await f.service.get(owner, session.id)).status).toBe("pending");
  });
});

describe("funding HTTP authentication and callbacks", () => {
  it("requires owner authentication and never accepts client completion claims", async () => {
    const f = fixture();
    const tokens = new Tokens(secret);
    const app = new Hono<AppEnv>();
    app.onError((e, c) => e instanceof ApiError ? c.json(e.toBody(), e.status as ContentfulStatusCode) : c.json({ error: "unexpected" }, 500));
    fundingRoutes(app, { db: f.db, funding: f.service, tokens } as unknown as Services);
    const auth = { authorization: `Bearer ${await tokens.sessionToken(owner)}`, "content-type": "application/json" };
    const otherAuth = { authorization: `Bearer ${await tokens.sessionToken(otherOwner)}` };
    expect((await app.request("/v1/funding/options")).status).toBe(401);
    expect((await app.request("/v1/funding/options", { headers: auth })).status).toBe(200);
    expect((await app.request("/v1/funding/sessions", { method: "POST", headers: auth, body: JSON.stringify({ ...input, status: "completed" }) })).status).toBe(400);
    const create = await app.request("/v1/funding/sessions", { method: "POST", headers: auth, body: JSON.stringify(input) });
    expect(create.status).toBe(200);
    const session = await create.json() as FundingSession;
    expect(await (await app.request(`/v1/funding/sessions/${session.id}?completed=true`, { headers: auth })).json()).toMatchObject({ status: "pending" });
    expect((await app.request(`/v1/funding/sessions/${session.id}`, { headers: otherAuth })).status).toBe(404);
    expect((await app.request(`/v1/funding/sessions/${session.id}`)).status).toBe(401);
    const webhook = `/v1/funding/webhooks/ramp/${session.id}`;
    expect((await app.request(webhook, { method: "POST", body: "{}" })).status).toBe(401);
    const event = { type: "RELEASED", purchase: f.purchase(session, { status: "RELEASED" }) };
    const signature = sign("sha256", Buffer.from(canonicalRampJson(event)), signing.privateKey).toString("base64");
    expect((await app.request(webhook, { method: "POST", headers: { "x-body-signature": signature }, body: JSON.stringify(event) })).status).toBe(204);
    const status = await app.request(`/v1/funding/sessions/${session.id}?completed=true`, { headers: auth });
    expect(await status.json()).toMatchObject({ status: "completed", environment: "sandbox" });
    expect((await app.request(webhook, { method: "POST", body: "x".repeat(64_001) })).status).toBe(413);
  });
});
