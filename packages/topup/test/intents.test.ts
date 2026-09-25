import { describe, expect, it } from "vitest";
import { parseUsd } from "@bilbypay/core";
import { IntentsTopUpProvider, OneClickTopUpProvider, TopUpError, createTopUpProviderFromEnv, MockTopUpProvider } from "../src";
import { BASE_USDC, DEPOSIT, MONAD_USDC, USER, fakeFetch, quoteResponse, statusResponse } from "./fixtures";

const NOW = Date.parse("2026-09-25T10:00:00.000Z");
const KEY = "studio-key-123";

function aurora(routes: Parameters<typeof fakeFetch>[0], extra: Partial<ConstructorParameters<typeof IntentsTopUpProvider>[0]> = {}) {
  const f = fakeFetch(routes);
  const logs: unknown[] = [];
  const provider = new IntentsTopUpProvider({
    backend: "aurora",
    apiKey: KEY,
    fetch: f.fetch,
    now: () => NOW,
    logger: (...a) => logs.push(a),
    ...extra,
  });
  return { provider, calls: f.calls, logs };
}

describe("quote (aurora backend)", () => {
  it("posts a 1Click QuoteRequest to /api/quote/{key} and returns the deposit address", async () => {
    const { provider, calls } = aurora({
      [`POST /api/quote/${KEY}`]: (req) => ({ body: quoteResponse(req.body as Record<string, unknown>) }),
    });
    const q = await provider.quote({ originAsset: "base:usdc", amount: parseUsd("5"), recipient: USER });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://intents-api.aurora.dev/api/quote/${KEY}`);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect(calls[0]!.body).toEqual({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: 50,
      originAsset: BASE_USDC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: MONAD_USDC,
      amount: "5000000",
      refundTo: USER,
      refundType: "ORIGIN_CHAIN",
      recipient: USER,
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-09-25T11:00:00.000Z",
      depositMode: "SIMPLE",
      quoteWaitingTimeMs: 0,
    });
    expect(q).toMatchObject({
      quoteId: DEPOSIT,
      depositAddress: DEPOSIT,
      originAsset: "base:usdc",
      amountIn: 5_000_000n,
      amountInBaseUnits: "5000000",
      amountOut: 4_990_000n,
      minAmountOut: 4_965_050n,
      expiresAt: "2026-09-25T11:00:00.000Z",
      etaSeconds: 20,
      dry: false,
    });
    expect((q.raw as { signature: string }).signature).toBe("ed25519:SIG");
  });

  it("dry quote: no deposit address, dry quoteId, status refuses it", async () => {
    const { provider, calls } = aurora({
      [`POST /api/quote/${KEY}`]: (req) => ({ body: quoteResponse(req.body as Record<string, unknown>) }),
    });
    const q = await provider.quote({ originAsset: "sol:usdc", amount: parseUsd("5"), recipient: USER, dry: true });
    expect((calls[0]!.body as { dry: boolean; refundTo: string }).dry).toBe(true);
    // Solana origin, no refundTo: dry uses the Aurora widget's placeholder
    expect((calls[0]!.body as { refundTo: string }).refundTo).toBe("11111111111111111111111111111112");
    expect(q.dry).toBe(true);
    expect(q.depositAddress).toBeUndefined();
    expect(q.quoteId).toBe("dry:c0rr-1");
    await expect(provider.status(q.quoteId)).rejects.toMatchObject({ code: "NOT_A_LIVE_QUOTE" });
  });

  it("requires refundTo for non-EVM origins on live quotes", async () => {
    const { provider, calls } = aurora({});
    await expect(provider.quote({ originAsset: "sol:usdc", amount: parseUsd("5"), recipient: USER })).rejects.toMatchObject({
      code: "REFUND_ADDRESS_REQUIRED",
    });
    expect(calls).toHaveLength(0);
  });

  it("exactOut scales to destination units and uses EXACT_OUTPUT; 18-decimal origins are scaled back to USD", async () => {
    const { provider, calls } = aurora({
      [`POST /api/quote/${KEY}`]: (req) => ({
        body: quoteResponse(req.body as Record<string, unknown>, { amountIn: "20100000000000000000", amountOut: "20000000", minAmountOut: "20000000" }),
      }),
    });
    const q = await provider.quote({ originAsset: "bsc:usdt", amount: parseUsd("20"), recipient: USER, mode: "exactOut" });
    expect(calls[0]!.body).toMatchObject({ swapType: "EXACT_OUTPUT", amount: "20000000" });
    expect(q.amountIn).toBe(20_100_000n);
    expect(q.amountInBaseUnits).toBe("20100000000000000000");
    expect(q.amountOut).toBe(20_000_000n);
  });

  it("accepts raw asset ids and the configured destination + slippage", async () => {
    const { provider, calls } = aurora(
      { [`POST /api/quote/${KEY}`]: (req) => ({ body: quoteResponse(req.body as Record<string, unknown>) }) },
      { destination: "ausd", slippageBps: 100, referral: "bilbypay" },
    );
    await provider.quote({ originAsset: BASE_USDC, amount: parseUsd("5"), recipient: USER, refundTo: "0x2222222222222222222222222222222222222222" });
    expect(calls[0]!.body).toMatchObject({
      destinationAsset: "nep245:v2_1.omni.hot.tg:143_1111Wd6DUHQcTT8PJELEThdiwB",
      slippageTolerance: 100,
      referral: "bilbypay",
      refundTo: "0x2222222222222222222222222222222222222222",
    });
  });

  it("rejects unknown origins and bad addresses before calling out", async () => {
    const { provider, calls } = aurora({});
    await expect(provider.quote({ originAsset: "doge:doge", amount: 1n, recipient: USER })).rejects.toMatchObject({ code: "UNSUPPORTED_ORIGIN" });
    await expect(provider.quote({ originAsset: "base:usdc", amount: 1n, recipient: "0x123" as `0x${string}` })).rejects.toMatchObject({
      code: "INVALID_ADDRESS",
    });
    expect(calls).toHaveLength(0);
  });

  it("encodes a memo into the quoteId and sends it on status", async () => {
    const { provider, calls } = aurora({
      [`POST /api/quote/${KEY}`]: (req) => ({ body: quoteResponse(req.body as Record<string, unknown>, { depositMemo: "12345" }) }),
      [`GET /api/status/${KEY}`]: () => ({ body: statusResponse("PENDING_DEPOSIT") }),
    });
    const q = await provider.quote({ originAsset: "base:usdc", amount: parseUsd("5"), recipient: USER });
    expect(q.quoteId).toBe(`${DEPOSIT}::12345`);
    expect(q.depositMemo).toBe("12345");
    await provider.status(q.quoteId);
    const url = new URL(calls[1]!.url);
    expect(url.searchParams.get("depositAddress")).toBe(DEPOSIT);
    expect(url.searchParams.get("depositMemo")).toBe("12345");
  });
});

describe("status transitions", () => {
  const cases: Array<[string, string, Record<string, unknown>, Record<string, unknown>]> = [
    ["PENDING_DEPOSIT", "waiting", {}, { amountIn: undefined, amountOut: undefined }],
    ["INCOMPLETE_DEPOSIT", "waiting", { depositedAmount: "2000000" }, { amountIn: 2_000_000n }],
    ["KNOWN_DEPOSIT_TX", "processing", {}, {}],
    ["PROCESSING", "processing", { depositedAmount: "5000000" }, { amountIn: 5_000_000n }],
    [
      "SUCCESS",
      "completed",
      {
        amountIn: "5000000",
        amountOut: "4991234",
        originChainTxHashes: [{ hash: "0xorigin", explorerUrl: "https://basescan.org/tx/0xorigin" }],
        destinationChainTxHashes: [{ hash: "0xmonad", explorerUrl: "https://monadscan.com/tx/0xmonad" }],
      },
      { amountIn: 5_000_000n, amountOut: 4_991_234n, destinationTxHashes: ["0xmonad"], originTxHashes: ["0xorigin"] },
    ],
    ["REFUNDED", "refunded", { refundedAmount: "4900000", refundReason: "slippage" }, { refundedAmount: 4_900_000n }],
    ["FAILED", "failed", {}, {}],
  ];

  for (const [providerStatus, status, details, expected] of cases) {
    it(`${providerStatus} → ${status}`, async () => {
      const { provider, calls } = aurora({ [`GET /api/status/${KEY}`]: () => ({ body: statusResponse(providerStatus, details) }) });
      const s = await provider.status(DEPOSIT);
      expect(new URL(calls[0]!.url).searchParams.get("depositAddress")).toBe(DEPOSIT);
      expect(s).toMatchObject({ status, providerStatus, updatedAt: "2026-09-25T10:05:00.000Z", ...expected });
      expect(s.message.length).toBeGreaterThan(0);
      expect(s.message).not.toMatch(/\b(chain|bridge|swap|token|crypto|gas|intents?|wallet|slippage|monad|deposit address)\b/i);
    });
  }

  it("walks a full lifecycle as the provider advances", async () => {
    const sequence = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
    let i = 0;
    const { provider } = aurora({
      [`GET /api/status/${KEY}`]: () => ({ body: statusResponse(sequence[Math.min(i++, sequence.length - 1)]!, { amountOut: "4990000" }) }),
    });
    const seen: string[] = [];
    for (let n = 0; n < 5; n++) seen.push((await provider.status(DEPOSIT)).status);
    expect(seen).toEqual(["waiting", "processing", "processing", "completed", "completed"]);
  });

  it("unknown provider status is treated as processing and logged", async () => {
    const { provider, logs } = aurora({ [`GET /api/status/${KEY}`]: () => ({ body: statusResponse("SOMETHING_NEW") }) });
    const s = await provider.status(DEPOSIT);
    expect(s.status).toBe("processing");
    expect(logs.some((l) => JSON.stringify(l).includes("SOMETHING_NEW"))).toBe(true);
  });
});

describe("submitDepositTx", () => {
  it("posts { txHash, depositAddress } to /api/deposit/submit/{key}", async () => {
    const { provider, calls } = aurora({ [`POST /api/deposit/submit/${KEY}`]: () => ({ body: statusResponse("KNOWN_DEPOSIT_TX") }) });
    const s = await provider.submitDepositTx({ quoteId: DEPOSIT, txHash: "0xabc" });
    expect(calls[0]!.body).toEqual({ txHash: "0xabc", depositAddress: DEPOSIT });
    expect(s).toMatchObject({ status: "processing" });
  });
});

describe("oneclick backend", () => {
  it("uses /v0 paths and a Bearer JWT", async () => {
    const f = fakeFetch({
      "POST /v0/quote": (req) => ({ body: quoteResponse(req.body as Record<string, unknown>) }),
      "GET /v0/status": () => ({ body: statusResponse("SUCCESS", { amountOut: "4990000" }) }),
      "POST /v0/deposit/submit": () => ({ body: statusResponse("PROCESSING") }),
      "GET /v0/tokens": () => ({
        body: [{ assetId: MONAD_USDC, decimals: 6, blockchain: "monad", symbol: "USDC", price: 1, priceUpdatedAt: "x" }],
      }),
    });
    const provider = new OneClickTopUpProvider({ backend: "oneclick", apiKey: "jwt", fetch: f.fetch, now: () => NOW });
    const q = await provider.quote({ originAsset: "arb:usdc", amount: parseUsd("5"), recipient: USER });
    await provider.status(q.quoteId);
    await provider.submitDepositTx({ quoteId: q.quoteId, txHash: "0x1" });
    const tokens = await provider.listTokens();
    expect(f.calls.map((c) => `${c.method} ${new URL(c.url).origin}${new URL(c.url).pathname}`)).toEqual([
      "POST https://1click.chaindefuser.com/v0/quote",
      "GET https://1click.chaindefuser.com/v0/status",
      "POST https://1click.chaindefuser.com/v0/deposit/submit",
      "GET https://1click.chaindefuser.com/v0/tokens",
    ]);
    expect(f.calls.every((c) => c.headers.Authorization === "Bearer jwt")).toBe(true);
    expect(tokens[0]).toMatchObject({ assetId: MONAD_USDC, blockchain: "monad", symbol: "USDC" });
  });

  it("works without a JWT (no Authorization header)", async () => {
    const f = fakeFetch({ "POST /v0/quote": (req) => ({ body: quoteResponse(req.body as Record<string, unknown>) }) });
    const provider = new IntentsTopUpProvider({ backend: "oneclick", fetch: f.fetch });
    await provider.quote({ originAsset: "base:usdc", amount: parseUsd("5"), recipient: USER, dry: true });
    expect(f.calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("aurora backend refuses to start without a key", () => {
    expect(() => new IntentsTopUpProvider({ backend: "aurora" })).toThrow(/studio\.aurora\.dev/);
  });

  it("parses the aurora tokens envelope", async () => {
    const { provider } = aurora({
      [`GET /api/tokens/${KEY}`]: () => ({ body: { asset_stats: [], tokens: [{ assetId: MONAD_USDC, blockchain: "monad", symbol: "USDC", decimals: 6 }] } }),
    });
    expect((await provider.listTokens())[0]?.assetId).toBe(MONAD_USDC);
  });
});

describe("error mapping", () => {
  const cases: Array<[number, unknown, string]> = [
    [400, { message: "Amount is too low for bridge, try at least 1000000" }, "AMOUNT_TOO_LOW"],
    [400, { message: "recipient is not valid" }, "UNSUPPORTED_ORIGIN"],
    [400, { message: "Failed to get a deposit address" }, "NO_OFFER"],
    [400, { message: "No quotes found" }, "NO_OFFER"],
    [404, { message: "Application key not found" }, "AUTH"],
    [401, { message: "Unauthorized" }, "AUTH"],
    [429, "Too Many Requests", "RATE_LIMITED"],
    [502, "<html>bad gateway</html>", "UNAVAILABLE"],
  ];
  for (const [status, body, code] of cases) {
    it(`${status} ${JSON.stringify(body)} → ${code}`, async () => {
      const { provider, logs } = aurora({ [`POST /api/quote/${KEY}`]: () => ({ status, body }) });
      const err = await provider.quote({ originAsset: "base:usdc", amount: parseUsd("5"), recipient: USER }).catch((e) => e);
      expect(err).toBeInstanceOf(TopUpError);
      expect(err.code).toBe(code);
      expect(err.httpStatus).toBe(status);
      expect(err.raw).toEqual(body);
      // raw detail goes to logs, with the key redacted
      expect(JSON.stringify(logs)).not.toContain(KEY);
      expect(JSON.stringify(logs)).toContain("<key>");
    });
  }

  it("keeps the minimum for AMOUNT_TOO_LOW", async () => {
    const { provider } = aurora({ [`POST /api/quote/${KEY}`]: () => ({ status: 400, body: { message: "Amount is too low for bridge, try at least 1000000" } }) });
    const err = await provider.quote({ originAsset: "base:usdc", amount: 1n, recipient: USER }).catch((e) => e);
    expect(err.details).toEqual({ minAmountBaseUnits: "1000000" });
  });

  it("status 404 → NOT_FOUND", async () => {
    const { provider } = aurora({});
    await expect(provider.status(DEPOSIT)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("network failure → UNAVAILABLE", async () => {
    const provider = new IntentsTopUpProvider({
      apiKey: KEY,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(provider.status(DEPOSIT)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("createTopUpProviderFromEnv", () => {
  it("defaults to mock without a key, aurora with one", () => {
    expect(createTopUpProviderFromEnv({})).toBeInstanceOf(MockTopUpProvider);
    const p = createTopUpProviderFromEnv({ INTENTS_API_KEY: "k", TOPUP_SLIPPAGE_BPS: "30" });
    expect(p).toBeInstanceOf(IntentsTopUpProvider);
    expect(p.name).toBe("aurora-intents");
    expect(createTopUpProviderFromEnv({ TOPUP_PROVIDER: "oneclick" }).name).toBe("near-intents-1click");
    expect(() => createTopUpProviderFromEnv({ TOPUP_PROVIDER: "x" })).toThrow();
    expect(() => createTopUpProviderFromEnv({ INTENTS_API_KEY: "k", TOPUP_SLIPPAGE_BPS: "abc" })).toThrow();
  });
});
