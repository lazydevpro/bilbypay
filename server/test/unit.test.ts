import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { registerMessage, signInMessage, Tokens, verifySignedMessage } from "../src/auth";
import { openDb, rateLimit } from "../src/db";
import { decodeRevert, humanizeRevert } from "../src/errors";
import { MockGiftCardProvider, priceWithFee } from "../src/giftcards/mock";
import { GiftCardService } from "../src/giftcards/service";
import { maskPhone, normalizePhone, phoneKey } from "../src/phone";
import { decryptSecret, encryptSecret } from "../src/secrets";
import { EncryptedKvStore } from "../src/giftcards/providers";
import { formatUsdShort, fromJson, KeyedMutex, newClaimCode, newReference, toJson } from "../src/util";
import { encodeErrorResult, type Hex } from "viem";
import { bilbyRouterAbi, mockStataAbi } from "@bilbypay/core";
import { MockTopUpProvider } from "@bilbypay/topup";
import { isNonceTooLow, type TxSender } from "../src/relayer";
import { TestnetDeliveringTopUpProvider } from "../src/topup-testnet";

describe("phone", () => {
  it("normalises to E.164 with a region hint", () => {
    expect(normalizePhone("(415) 555-2671", "US")?.e164).toBe("+14155552671");
    expect(normalizePhone("+44 20 7946 0958")?.e164).toBe("+442079460958");
    expect(normalizePhone("98765 43210", "IN")?.e164).toBe("+919876543210");
    expect(normalizePhone("+1 555 555 0101")?.e164).toBe("+15555550101");
    expect(normalizePhone("not a number")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
  });

  it("phoneKey is HMAC-SHA256(pepper, e164) as bytes32", () => {
    const key = phoneKey("pepper", "+14155552671");
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(key).toBe(`0x${createHmac("sha256", "pepper").update("+14155552671").digest("hex")}`);
    expect(phoneKey("other", "+14155552671")).not.toBe(key);
  });

  it("masks all but the country code and last four digits", () => {
    expect(maskPhone("+14155550123")).toBe("+1 •••• 0123");
    expect(maskPhone("+919876543210")).toBe("+91 •••• 3210");
  });
});

describe("tokens", () => {
  const tokens = new Tokens(new Uint8Array(32).fill(7));

  it("round-trips phone and session tokens", async () => {
    const pk = phoneKey("p", "+15555550101");
    const t = await tokens.phoneToken({ phoneKey: pk, e164: "+15555550101" });
    expect(await tokens.verifyPhoneToken(t)).toEqual({ phoneKey: pk, e164: "+15555550101" });
    const addr = privateKeyToAccount(generatePrivateKey()).address;
    expect(await tokens.verifySessionToken(await tokens.sessionToken(addr))).toBe(addr);
  });

  it("does not accept one kind of token as the other, or a foreign secret", async () => {
    const addr = privateKeyToAccount(generatePrivateKey()).address;
    const session = await tokens.sessionToken(addr);
    const phone = await tokens.phoneToken({ phoneKey: phoneKey("p", "+15555550101"), e164: "+15555550101" });
    await expect(tokens.verifyPhoneToken(session)).rejects.toMatchObject({ code: "OTP_EXPIRED" });
    await expect(tokens.verifySessionToken(phone)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    const other = new Tokens(new Uint8Array(32).fill(8));
    await expect(other.verifySessionToken(session)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });
});

describe("signed messages", () => {
  it("match docs/api.md byte for byte", () => {
    const address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
    expect(registerMessage({ phone: "+14155550123", address, issuedAt: 1790000000 })).toBe(
      "BilbyPay: link phone to this account\nPhone: +14155550123\nAccount: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8\nIssued: 1790000000",
    );
    expect(signInMessage({ address, issuedAt: 1790000000 })).toBe(
      "BilbyPay: sign in\nAccount: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8\nIssued: 1790000000",
    );
  });

  it("verifies EIP-191 signatures (checksummed or lowercase account) and rejects stale or foreign ones", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const issuedAt = Math.floor(Date.now() / 1000);
    const build = (a: `0x${string}`) => signInMessage({ address: a, issuedAt });
    const sig = await account.signMessage({ message: build(account.address) });
    expect(await verifySignedMessage({ address: account.address, issuedAt, signature: sig, build })).toBe(account.address);
    const lower = await account.signMessage({ message: build(account.address.toLowerCase() as Hex) });
    expect(await verifySignedMessage({ address: account.address.toLowerCase(), issuedAt, signature: lower, build })).toBe(account.address);

    const other = privateKeyToAccount(generatePrivateKey());
    await expect(verifySignedMessage({ address: other.address, issuedAt, signature: sig, build })).rejects.toMatchObject({ code: "CONFIRMATION_FAILED" });
    await expect(verifySignedMessage({ address: account.address, issuedAt: issuedAt - 1000, signature: sig, build })).rejects.toMatchObject({
      code: "ACTION_EXPIRED",
    });
  });
});

describe("gift code encryption", () => {
  const key = Buffer.alloc(32, 1);

  it("round-trips and binds the ciphertext to its row", () => {
    const enc = encryptSecret(key, '{"code":"ABCD-1234"}', "gc_1");
    expect(enc).not.toContain("ABCD");
    expect(decryptSecret(key, enc, "gc_1")).toBe('{"code":"ABCD-1234"}');
    expect(() => decryptSecret(key, enc, "gc_2")).toThrow();
    expect(() => decryptSecret(Buffer.alloc(32, 2), enc, "gc_1")).toThrow();
    expect(encryptSecret(key, "x", "a")).not.toBe(encryptSecret(key, "x", "a")); // fresh IV each time
  });
});

describe("util", () => {
  it("keeps bigints through stored JSON", () => {
    const v = { a: 1n, b: [2n, { c: 3n }], d: "x" };
    expect(fromJson(toJson(v))).toEqual(v);
  });

  it("formats share amounts and makes readable references", () => {
    expect(formatUsdShort(20_000_000n)).toBe("$20");
    expect(formatUsdShort(20_500_000n)).toBe("$20.50");
    expect(newReference()).toMatch(/^BP-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(newClaimCode()).toMatch(/^[A-Za-z0-9]{12}$/);
  });

  it("serializes work per key", async () => {
    const m = new KeyedMutex();
    const order: string[] = [];
    const slow = m.run("k", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("first");
    });
    const fast = m.run("k", async () => void order.push("second"));
    await Promise.all([slow, fast]);
    expect(order).toEqual(["first", "second"]);
  });

  it("rate limits in a sliding window", () => {
    const db = openDb(":memory:");
    expect(rateLimit(db, "b", 3, 60_000)).toBe(true);
    expect(rateLimit(db, "b", 3, 60_000, 2)).toBe(true);
    expect(rateLimit(db, "b", 3, 60_000)).toBe(false);
    expect(rateLimit(db, "other", 3, 60_000)).toBe(true);
  });
});

describe("revert mapping", () => {
  it("decodes custom errors, unwraps router CallFailed, and maps to human codes", () => {
    const inner = encodeErrorResult({ abi: mockStataAbi, errorName: "ERC4626ExceededMaxWithdraw", args: ["0x0000000000000000000000000000000000000001", 5n, 1n] });
    expect(decodeRevert(inner)).toBe("ERC4626ExceededMaxWithdraw");
    const wrapped = encodeErrorResult({ abi: bilbyRouterAbi, errorName: "CallFailed", args: [inner] });
    expect(decodeRevert(wrapped)).toBe("ERC4626ExceededMaxWithdraw");
    expect(humanizeRevert({ reason: "authorization is used" }).code).toBe("ALREADY_DONE");
    expect(humanizeRevert({ reason: "NotPending" }).code).toBe("ALREADY_CLAIMED");
    expect(humanizeRevert({ reason: "something odd" }).code).toBe("INTERNAL");
  });
});

describe("gift card service", () => {
  const key = Buffer.alloc(32, 3);
  const giftId = `0x${"ab".repeat(32)}` as Hex;
  const owner = privateKeyToAccount(generatePrivateKey()).address;
  const noTreasury = { pay: async () => ({ hash: `0x${"00".repeat(32)}` }) } as never;
  const activity = { add: () => ({ id: "x", reference: "r" }), update: () => {} } as never;

  it("buys at most once per giftId and encrypts the code at rest", async () => {
    const db = openDb(":memory:");
    const provider = new MockGiftCardProvider();
    const svc = new GiftCardService(db, provider, noTreasury, activity, key);
    const brand = (await svc.findBrand("starbucks-us"))!;
    const input = { giftId, owner, source: "buy" as const, brand, faceValue: 10_000_000n, paid: 10_000_000n, refundTo: owner };
    const [a, b] = await Promise.all([svc.fulfil(input), svc.fulfil(input)]);
    const c = await svc.fulfil(input);
    expect(a.id).toBe(b.id);
    expect(c.id).toBe(a.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM gift_orders").get()).toEqual({ n: 1 });
    expect(provider.float).toBe(10_000n * 1_000_000n - 10_000_000n);
    const row = svc.getOrder(a.id)!;
    expect(row.status).toBe("ready");
    expect(row.provider_order_id).toMatch(/^mock_/);
    const revealed = svc.reveal(owner, a.id);
    expect(row.redemption_enc).not.toContain(revealed.code!);
    expect(() => svc.reveal(privateKeyToAccount(generatePrivateKey()).address, a.id)).toThrow(/couldn't find/);
  });

  it("folds the provider fee into the price, rounded up to the cent", () => {
    expect(priceWithFee(20_000_000n, 2.5)).toBe(20_500_000n);
    expect(priceWithFee(10_000_000n, 0)).toBe(10_000_000n);
    expect(priceWithFee(10_000_001n, 0)).toBe(10_010_000n);
  });
});

describe("gift provider store", () => {
  it("persists provider records encrypted and bound to their key", async () => {
    const db = openDb(":memory:");
    const store = new EncryptedKvStore(db, Buffer.alloc(32, 7));
    await store.set("laso:gift-1", { phase: "done", purchase: { redemption: { code: "SECRET-CODE" } } });
    const raw = db.prepare("SELECT value FROM kv WHERE key = ?").get("giftprovider:laso:gift-1") as { value: string };
    expect(raw.value).not.toContain("SECRET-CODE");
    expect(await store.get("laso:gift-1")).toEqual({ phase: "done", purchase: { redemption: { code: "SECRET-CODE" } } });
    expect(await store.get("missing")).toBeUndefined();
    db.prepare("UPDATE kv SET key = ? WHERE key = ?").run("giftprovider:laso:gift-2", "giftprovider:laso:gift-1");
    await expect(store.get("laso:gift-2")).rejects.toThrow();
  });
});

describe("relayer nonce recovery", () => {
  it("recognises nonce-too-low rejections (viem error and Monad's wording), not other failures", () => {
    expect(isNonceTooLow({ name: "NonceTooLowError" })).toBe(true);
    expect(isNonceTooLow(new Error("x", { cause: { details: "Nonce provided for the transaction (17) is lower than the current nonce of the account." } }))).toBe(true);
    expect(isNonceTooLow({ shortMessage: "nonce too low" })).toBe(true);
    expect(isNonceTooLow(new Error("request timed out"))).toBe(false);
    expect(isNonceTooLow(new Error("insufficient funds for gas"))).toBe(false);
  });
});

describe("testnet top-up delivery", () => {
  const usdc = "0x00000000000000000000000000000000000000c0" as const;
  const treasury = "0x00000000000000000000000000000000000000fe" as const;
  const fakeSender = (hashes: Hex[], failFirst = false) => {
    const calls: { to: string; data: Hex }[] = [];
    let n = 0;
    const sender = {
      send: async (call: { to: string; data: Hex }) => {
        calls.push(call);
        if (failFirst && n++ === 0) throw new Error("boom");
        return { hash: hashes[calls.length - 1]!, receipt: {} };
      },
    } as unknown as TxSender;
    return { sender, calls };
  };

  it("mints test USDC to the quote's recipient once, and reports that real tx as the delivery", async () => {
    let now = 0;
    const inner = new MockTopUpProvider({ now: () => now, autoDepositMs: 0, processingMs: 0 });
    const { sender, calls } = fakeSender(["0xaa", "0xbb"] as Hex[]);
    const p = new TestnetDeliveringTopUpProvider(inner, usdc, sender);
    const q = await p.quote({ originAsset: inner.supportedOrigins()[0]!.id, amount: 5_000_000n, recipient: treasury, refundTo: treasury } as any);
    now = 1;
    const a = await p.status(q.quoteId);
    const b = await p.status(q.quoteId);
    expect(a.status).toBe("completed");
    expect(a.destinationTxHashes).toEqual(["0xaa"]);
    expect(b.destinationTxHashes).toEqual(["0xaa"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.to).toBe(usdc);
    expect(calls[0]!.data.toLowerCase()).toContain(treasury.slice(2));
  });

  it("retries a failed delivery on the next poll", async () => {
    let now = 0;
    const inner = new MockTopUpProvider({ now: () => now, autoDepositMs: 0, processingMs: 0 });
    const { sender, calls } = fakeSender(["0x01", "0xcc"] as Hex[], true);
    const p = new TestnetDeliveringTopUpProvider(inner, usdc, sender);
    const q = await p.quote({ originAsset: inner.supportedOrigins()[0]!.id, amount: 5_000_000n, recipient: treasury, refundTo: treasury } as any);
    now = 1;
    await expect(p.status(q.quoteId)).rejects.toThrow("boom");
    expect((await p.status(q.quoteId)).destinationTxHashes).toEqual(["0xcc"]);
    expect(calls).toHaveLength(2);
  });
});
