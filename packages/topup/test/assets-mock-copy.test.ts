import { describe, expect, it } from "vitest";
import { parseUsd } from "@bilbypay/core";
import {
  MONAD_DESTINATIONS,
  MockTopUpProvider,
  ORIGINS,
  TopUpError,
  USER_MESSAGES,
  findOrigin,
  hotOmniAssetId,
  unitsToUsd,
  usdToUnits,
} from "../src";
import { USER } from "./fixtures";

describe("asset ids", () => {
  it("hotOmniAssetId reproduces ids from the live 1Click catalogue", () => {
    // Values from a /v0/tokens snapshot (fastnear/explorer-frontend res/1click_prices.json)
    expect(hotOmniAssetId(143, "0x754704Bc059F8C67012fEd69BC8A327a5aafb603")).toBe("nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx");
    expect(hotOmniAssetId(143, "0xe7cd86e13AC4309349F30B3435a9d337750fC82D")).toBe("nep245:v2_1.omni.hot.tg:143_4EJiJxSALvGoTZbnc8K7Ft9533et");
    expect(hotOmniAssetId(143, "0x0000000000000000000000000000000000000000")).toBe("nep245:v2_1.omni.hot.tg:143_11111111111111111111");
    expect(hotOmniAssetId(196, "0x74b7F16337b8972027F6196A17a631aC6dE26d22")).toBe("nep245:v2_1.omni.hot.tg:196_2dK9kLNR7Ekq7su8FxNGiUW3djTw");
    expect(MONAD_DESTINATIONS.usdc.assetId).toBe(hotOmniAssetId(143, MONAD_DESTINATIONS.usdc.token));
    expect(MONAD_DESTINATIONS.ausd.assetId).toBe("nep245:v2_1.omni.hot.tg:143_1111Wd6DUHQcTT8PJELEThdiwB");
  });

  it("origins are unique and findable by id or asset id", () => {
    expect(new Set(ORIGINS.map((o) => o.id)).size).toBe(ORIGINS.length);
    expect(findOrigin("BASE:USDC")?.label).toBe("USDC on Base");
    expect(findOrigin(ORIGINS[3]!.assetId)?.id).toBe(ORIGINS[3]!.id);
  });

  it("scales between USD and token units", () => {
    expect(usdToUnits(1_500_000n, 18)).toBe(1_500_000_000_000_000_000n);
    expect(unitsToUsd(1_500_000_000_000_000_000n, 18)).toBe(1_500_000n);
    expect(usdToUnits(1_500_000n, 6)).toBe(1_500_000n);
    expect(usdToUnits(1_500_000n, 7)).toBe(15_000_000n);
  });
});

describe("MockTopUpProvider", () => {
  it("advances waiting → processing → completed over time", async () => {
    let now = 0;
    const mock = new MockTopUpProvider({ now: () => now, autoDepositMs: 5_000, processingMs: 8_000, feeBps: 10 });
    const q = await mock.quote({ originAsset: "base:usdc", amount: parseUsd("20"), recipient: USER });
    expect(q.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(q.amountOut).toBe(19_980_000n);

    expect((await mock.status(q.quoteId)).status).toBe("waiting");
    now = 5_000;
    expect((await mock.status(q.quoteId)).status).toBe("processing");
    now = 13_000;
    const done = await mock.status(q.quoteId);
    expect(done).toMatchObject({ status: "completed", amountOut: 19_980_000n });
    expect(done.destinationTxHashes).toHaveLength(1);
  });

  it("supports manual deposit and forced outcomes", async () => {
    let now = 0;
    const mock = new MockTopUpProvider({ now: () => now, autoDepositMs: null, processingMs: 1_000 });
    const q = await mock.quote({ originAsset: "arb:usdc", amount: parseUsd("5"), recipient: USER });
    now = 1_000_000;
    expect((await mock.status(q.quoteId)).status).toBe("waiting");
    mock.setOutcome(q.quoteId, "refunded");
    await mock.submitDepositTx({ quoteId: q.quoteId, txHash: "0x1" });
    now += 1_000;
    expect(await mock.status(q.quoteId)).toMatchObject({ status: "refunded", refundedAmount: 5_000_000n });
  });

  it("errors like the real provider", async () => {
    const mock = new MockTopUpProvider();
    await expect(mock.quote({ originAsset: "base:usdc", amount: parseUsd("0.5"), recipient: USER })).rejects.toMatchObject({ code: "AMOUNT_TOO_LOW" });
    await expect(mock.status("0xnope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const dry = await mock.quote({ originAsset: "base:usdc", amount: parseUsd("5"), recipient: USER, dry: true });
    expect(dry.depositAddress).toBeUndefined();
    await expect(mock.status(dry.quoteId)).rejects.toMatchObject({ code: "NOT_A_LIVE_QUOTE" });
  });
});

describe("user-facing copy", () => {
  // BilbyPay no-crypto UX rule.
  const BANNED = /\b(chain|chains|onchain|bridge|bridging|swap|swaps|swapping|token|tokens|crypto|blockchain|gas|intent|intents|deposit address|wallet|nep141|nep245|slippage|1click|near|aurora|monad)\b/i;

  it("error messages avoid crypto jargon", () => {
    for (const [code, msg] of Object.entries(USER_MESSAGES)) {
      expect(msg, code).not.toMatch(BANNED);
      expect(new TopUpError(code as keyof typeof USER_MESSAGES).userMessage).toBe(msg);
    }
  });

  it("status messages avoid crypto jargon", async () => {
    let now = 0;
    const mock = new MockTopUpProvider({ now: () => now, autoDepositMs: 1, processingMs: 1 });
    const statuses = ["completed", "failed", "refunded"] as const;
    for (const outcome of statuses) {
      const q = await mock.quote({ originAsset: "base:usdc", amount: parseUsd("5"), recipient: USER });
      mock.setOutcome(q.quoteId, outcome);
      now += 0;
      expect((await mock.status(q.quoteId)).message).not.toMatch(BANNED);
      now += 10;
      expect((await mock.status(q.quoteId)).message).not.toMatch(BANNED);
    }
  });

  it("origin labels avoid crypto jargon", () => {
    for (const o of ORIGINS) expect(o.label).not.toMatch(/\b(chain|bridge|swap|token)\b/i);
  });
});
