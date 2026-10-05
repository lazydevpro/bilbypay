/**
 * End to end against a real local chain: anvil (chain 143) + the real contracts and mocks, the Hono
 * app in-process, and users that behave like the mobile app (HTTP + a local account key, 0 MON).
 * Steps share one chain and run in order.
 */
import { bilbyRouterAbi, type Deployment, mockAusdAbi, mockStataAbi } from "@bilbypay/core";
import type { Hono } from "hono";
import { type Address, createWalletClient, erc20Abi, type Hex, http, maxUint256, parseEventLogs } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db";
import { MockGiftCardProvider } from "../src/giftcards/mock";
import { createServices, type Services } from "../src/services";
import { AppUser } from "./helpers/app";
import { ANVIL_KEYS, type Anvil, deployAll, startAnvil, testClient } from "./helpers/chain";

const usd = (n: number) => BigInt(Math.round(n * 1_000_000)); // test amounts only
const s = (n: bigint) => n.toString();

let anvil: Anvil;
let d: Deployment;
let services: Services;
let app: Hono<any>;
let provider: MockGiftCardProvider;
let mint: (to: Address, amount: bigint) => Promise<void>;
let setLiquidity: (amount: bigint) => Promise<void>;
const treasuryKey = generatePrivateKey();
const verifierKey = generatePrivateKey();

const users: AppUser[] = [];
const user = (phone: string, name: string) => {
  const u = new AppUser(app, phone, name);
  users.push(u);
  return u;
};

const ausdOf = (a: Address) => services.chain.ausdBalance(a);
const monOf = (a: Address) => services.chain.client.getBalance({ address: a });

beforeAll(async () => {
  anvil = await startAnvil();
  d = await deployAll(anvil.rpcUrl, {
    deployer: ANVIL_KEYS[0],
    verifier: privateKeyToAccount(verifierKey).address,
    treasury: privateKeyToAccount(treasuryKey).address,
    keeper: privateKeyToAccount(ANVIL_KEYS[2]).address,
  });
  const config = loadConfig({
    CHAIN_ID: "143",
    RPC_URL: anvil.rpcUrl,
    POLLING_INTERVAL_MS: "20",
    AUSD_ADDRESS: d.ausd,
    STATA_ADDRESS: d.stata,
    DIRECTORY_ADDRESS: d.directory,
    ESCROW_ADDRESS: d.escrow,
    ROUTER_ADDRESS: d.router,
    RELAYER_PRIVATE_KEY: ANVIL_KEYS[1],
    KEEPER_PRIVATE_KEY: ANVIL_KEYS[2],
    VERIFIER_PRIVATE_KEY: verifierKey,
    TREASURY_PRIVATE_KEY: treasuryKey,
    PHONE_PEPPER: "test-pepper",
    TOKEN_SECRET: `0x${"11".repeat(32)}`,
    GIFT_CODE_KEY: `0x${"22".repeat(32)}`,
    OTP_PROVIDER: "test",
    PUBLIC_BASE_URL: "https://bilbypay.test",
    EXPLORER_URL: "https://explorer.test",
    KEEPER_DEBOUNCE_MS: "0",
    DATABASE_PATH: ":memory:",
  });
  provider = new MockGiftCardProvider();
  services = createServices(config, { db: openDb(":memory:"), giftProvider: provider });
  await services.chain.verifyDomains();
  app = createApp(services);

  const chain = { ...monad, rpcUrls: { default: { http: [anvil.rpcUrl] } } };
  const minter = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS[0]), chain, transport: http(anvil.rpcUrl) });
  const wait = (hash: Hex) => services.chain.client.waitForTransactionReceipt({ hash });
  mint = async (to, amount) => void (await wait(await minter.writeContract({ address: d.ausd, abi: mockAusdAbi, functionName: "mint", args: [to, amount] })));
  setLiquidity = async (amount) =>
    void (await wait(await minter.writeContract({ address: d.stata, abi: mockStataAbi, functionName: "setLiquidity", args: [amount] })));
});

afterAll(() => anvil?.stop());

// --------------------------------------------------------------------- tests

let alice: AppUser;
let bob: AppUser;

describe("identity", () => {
  it("reports health", async () => {
    const res = await app.request("/health");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, chainId: 143 });
    expect(BigInt(body.relayerBalance)).toBeGreaterThan(0n);
  });

  it("rejects wrong and unrequested codes", async () => {
    const u = user("+1 555 555 0199", "Nobody");
    expect((await u.call("POST", "/v1/otp/verify", { phone: u.phone, code: "000000" }, false)).body.error.code).toBe("OTP_EXPIRED");
    await u.call("POST", "/v1/otp/start", { phone: u.phone }, false);
    expect((await u.call("POST", "/v1/otp/verify", { phone: u.phone, code: "123456" }, false)).body.error.code).toBe("OTP_INVALID");
    expect((await u.call("POST", "/v1/otp/start", { phone: "12" }, false)).body.error.code).toBe("PHONE_INVALID");
  });

  it("rate limits code requests per number", async () => {
    const u = user("+1 555 555 0198", "Spammy");
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await u.call("POST", "/v1/otp/start", { phone: u.phone }, false)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("registers Alice and Bob: OTP → passkey signature → on-chain binding", async () => {
    alice = await user("+1 555 555 0101", "Alice").onboard();
    bob = await user("+1 555 555 0102", "Bob").onboard();
    const me = await alice.call("GET", "/v1/me");
    expect(me.body).toMatchObject({ address: alice.address, displayName: "Alice", phone: "+15555550101", phoneMasked: "+1 •••• 0101" });
    const bound = await services.chain.resolve(services.accounts.phoneKeyOf("+15555550101"));
    expect(bound.account).toBe(alice.address);
  });

  it("signs in a returning account; a never-registered account gets profile null", async () => {
    const again = new AppUser(app, alice.phone, "Alice", undefined);
    Object.assign(again, { account: alice.account });
    expect((await again.signIn()).body.profile.displayName).toBe("Alice");
    const fresh = user("+1 555 555 0197", "Fresh");
    const res = await fresh.signIn();
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
    expect((await fresh.call("GET", "/v1/me")).body.error.code).toBe("PHONE_REQUIRED");
    expect((await fresh.call("GET", "/v1/me", undefined, false)).body.error.code).toBe("SESSION_EXPIRED");
  });

  it("resolves contacts", async () => {
    const res = await alice.call("POST", "/v1/resolve", { phones: ["(555) 555-0102", "+1 555 555 0103", "abc"] });
    expect(res.body.results).toMatchObject([
      { phone: "(555) 555-0102", e164: "+15555550102", status: "registered", displayName: "Bob", address: bob.address },
      { phone: "+1 555 555 0103", e164: "+15555550103", status: "invite" },
      { phone: "abc", e164: null, status: "invalid" },
    ]);
  });
});

describe("sending", () => {
  it("sends to a registered contact with a direct authorization; users hold 0 MON", async () => {
    await mint(alice.address, usd(100));
    expect((await alice.balance()).balance).toBe(s(usd(100)));
    const { prepared, result } = await alice.act("send", { phone: "+15555550102", amount: s(usd(10)), note: "lunch" });
    expect(prepared.summary.title).toBe("Send $10.00 to Bob");
    expect(prepared.expect).toMatchObject({ payer: alice.address, amount: s(usd(10)), payee: bob.address, directory: { revision: "1", ownershipEpoch: "0" } });
    expect(prepared.toSign.map((t) => t.key)).toEqual(["payment"]);
    expect(prepared.toSign[0]!.typedData.primaryType).toBe("TransferWithAuthorization");
    expect(result.status).toBe("completed");
    expect(result.receipt?.reference).toMatch(/^BP-/);
    expect(result.receipt?.technical?.explorerUrl).toMatch(/^https:\/\/explorer\.test\/tx\/0x/);
    expect(await ausdOf(bob.address)).toBe(usd(10));
    expect(await ausdOf(alice.address)).toBe(usd(90));
    const bobFeed = await bob.activity();
    expect(bobFeed[0]).toMatchObject({ kind: "received", status: "completed", amount: s(usd(10)), note: "lunch", counterparty: { name: "Alice" } });
  });

  it("is idempotent per action id", async () => {
    const p = await alice.prepare("send", { phone: "+15555550102", amount: s(usd(1)) });
    const sigs = await alice.sign(p.body);
    const [a, b] = await Promise.all([alice.submit(p.body.id, sigs), alice.submit(p.body.id, sigs)]);
    const c = await alice.submit(p.body.id, sigs);
    expect(a.body).toEqual(b.body);
    expect(c.body).toEqual(a.body);
    expect(await ausdOf(bob.address)).toBe(usd(11));
  });

  it("recovers when the relayer key was used outside the server (nonce too low → resync, retry once)", async () => {
    const outside = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS[1]), chain: { ...monad, rpcUrls: { default: { http: [anvil.rpcUrl] } } }, transport: http(anvil.rpcUrl) });
    const hash = await outside.sendTransaction({ to: outside.account.address, value: 0n });
    await services.chain.client.waitForTransactionReceipt({ hash });
    const before = await ausdOf(bob.address);
    const { result } = await alice.act("send", { phone: "+15555550102", amount: s(usd(1)) });
    expect(result.status).toBe("completed");
    expect(await ausdOf(bob.address)).toBe(before + usd(1));
  });

  it("refuses a bad signature before touching the chain", async () => {
    const p = await alice.prepare("send", { phone: "+15555550102", amount: s(usd(1)) });
    const wrong = await bob.sign({ ...p.body, toSign: p.body.toSign.map((t) => ({ ...t, typedData: { ...t.typedData, message: { ...t.typedData.message, from: bob.address } } })) });
    const res = await alice.submit(p.body.id, wrong);
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("CONFIRMATION_FAILED");
  });

  it("refuses to send more than balance + Burrow", async () => {
    const p = await alice.prepare("send", { phone: "+15555550102", amount: s(usd(10_000)) });
    expect(p.status).toBe(400);
    expect((p.body as any).error.code).toBe("INSUFFICIENT_FUNDS");
  });

  let carolCode: string;
  it("sends to an unregistered number: escrow deposit + claim link", async () => {
    const before = await ausdOf(alice.address);
    const { prepared, result } = await alice.act("send", { phone: "+15555550103", amount: s(usd(20)), note: "for the cab" });
    expect(prepared.toSign[0]!.typedData.primaryType).toBe("ReceiveWithAuthorization");
    expect(prepared.toSign[0]!.typedData.message.to).toBe(d.escrow);
    expect(prepared.expect.payee).toBeUndefined();
    expect(result.status).toBe("waiting");
    expect(result.claimLink).toMatch(/^https:\/\/bilbypay\.test\/c\/[A-Za-z0-9]{12}$/);
    carolCode = result.claimLink!.split("/c/")[1]!;
    expect(await ausdOf(alice.address)).toBe(before - usd(20));
    expect(await ausdOf(d.escrow)).toBe(usd(20));
    expect((await alice.balance()).pendingOut).toBe(s(usd(20)));
    const feed = await alice.activity();
    expect(feed[0]).toMatchObject({ kind: "sent", status: "waiting", canCancel: true, claimLink: result.claimLink });
    expect(feed[0].expiresAt).toBeTruthy();
  });

  it("serves the claim, the share page and the preview image", async () => {
    const view = await alice.call("GET", `/v1/claims/${carolCode}`, undefined, false);
    expect(view.body).toMatchObject({ code: carolCode, kind: "money", amount: s(usd(20)), senderName: "Alice", status: "waiting", phoneMasked: "+1 •••• 0103", note: "for the cab" });
    const page = await app.request(`/c/${carolCode}`);
    const html = await page.text();
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(html).toContain('<meta property="og:title" content="Alice sent you $20">');
    expect(html).toContain(`https://bilbypay.test/og/${carolCode}.png`);
    expect(html).toContain(`bilbypay://claim/${carolCode}`);
    const png = await app.request(`/og/${carolCode}.png`);
    expect(png.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await png.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect((await app.request("/c/doesnotexist")).status).toBe(404);
    const aasa = await app.request("/.well-known/apple-app-site-association");
    expect(aasa.headers.get("content-type")).toBe("application/json");
  });

  it("Carol verifies her number, registers and opens it; Bob's number can't", async () => {
    await bob.verifyPhone();
    const wrong = await bob.call("POST", `/v1/claims/${carolCode}/accept`, { phoneToken: bob.phoneToken });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toMatchObject({ code: "WRONG_PHONE", message: expect.stringContaining("+1 •••• 0103") });

    const carol = await user("+1 555 555 0103", "Carol").onboard();
    const res = await carol.call("POST", `/v1/claims/${carolCode}/accept`, { phoneToken: carol.phoneToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "completed", amount: s(usd(20)) });
    expect(await ausdOf(carol.address)).toBe(usd(20));
    expect(await monOf(carol.address)).toBe(0n);
    // Retry-safe for Carol, closed for everyone else.
    expect((await carol.call("POST", `/v1/claims/${carolCode}/accept`, { phoneToken: carol.phoneToken })).body).toEqual(res.body);
    expect((await alice.call("GET", `/v1/claims/${carolCode}`)).body.status).toBe("opened");
    const aliceItem = (await alice.activity()).find((i) => i.claimLink === undefined && i.kind === "sent" && i.amount === s(usd(20)));
    expect(aliceItem).toMatchObject({ status: "completed" });
    expect((await carol.activity())[0]).toMatchObject({ kind: "received", counterparty: { name: "Alice", phoneMasked: "+1 •••• 0101" } });
    expect((await alice.balance()).pendingOut).toBe("0");
  });

  it("the sender can take back an unopened send", async () => {
    const before = await ausdOf(alice.address);
    const { result } = await alice.act("send", { phone: "+15555550105", amount: s(usd(7)) });
    expect(result.status).toBe("waiting");
    const item = (await alice.activity())[0];
    const { prepared, result: cancelled } = await alice.act("cancel", { activityId: item.id });
    expect(prepared.toSign[0]!.typedData.primaryType).toBe("Cancel");
    expect(cancelled.status).toBe("completed");
    expect(await ausdOf(alice.address)).toBe(before);
    const after = (await alice.activity()).find((i) => i.id === item.id);
    expect(after).toMatchObject({ status: "cancelled" });
    expect(after.canCancel).toBeUndefined();
    const code = result.claimLink!.split("/c/")[1]!;
    expect((await alice.call("GET", `/v1/claims/${code}`)).body.status).toBe("returned");
  });

  it("a take-back that loses the race to the recipient fails cleanly (on-chain revert → human error)", async () => {
    const { result } = await alice.act("send", { phone: "+15555550109", amount: s(usd(3)) });
    const code = result.claimLink!.split("/c/")[1]!;
    const item = (await alice.activity())[0];
    const cancel = await alice.prepare("cancel", { activityId: item.id });
    const ivy = await user("+1 555 555 0109", "Ivy").onboard();
    expect((await ivy.call("POST", `/v1/claims/${code}/accept`, { phoneToken: ivy.phoneToken })).body.status).toBe("completed");
    const sentBefore = services.relayer.sentCount;
    const res = await alice.submit(cancel.body.id, await alice.sign(cancel.body));
    expect(res.body).toMatchObject({ status: "failed", error: { code: "ALREADY_CLAIMED" } });
    expect(services.relayer.sentCount).toBe(sentBefore); // refused at estimate time: no gas spent
    expect(await ausdOf(ivy.address)).toBe(usd(3));
  });

  it("refunds unopened sends after expiry (keeper)", async () => {
    const before = await ausdOf(alice.address);
    const { result } = await alice.act("send", { phone: "+15555550104", amount: s(usd(5)) });
    const code = result.claimLink!.split("/c/")[1]!;
    expect(await ausdOf(alice.address)).toBe(before - usd(5));
    await services.keeper.tick();
    expect(await ausdOf(alice.address)).toBe(before - usd(5)); // not yet

    const tc = testClient(anvil.rpcUrl);
    await tc.increaseTime({ seconds: 15 * 86_400 });
    await tc.mine({ blocks: 1 });
    await services.keeper.tick();
    expect(await ausdOf(alice.address)).toBe(before);
    expect((await alice.call("GET", `/v1/claims/${code}`)).body.status).toBe("returned");
    const item = (await alice.activity()).find((i) => i.amount === s(usd(5)) && i.kind === "sent");
    expect(item.status).toBe("refunded");

    const dan = await user("+1 555 555 0104", "Dan").onboard();
    const late = await dan.call("POST", `/v1/claims/${code}/accept`, { phoneToken: dan.phoneToken });
    expect(late.body.error.code).toBe("CLAIM_EXPIRED");
  });
});

describe("burrow", () => {
  it("adds to Burrow with one authorization", async () => {
    const bal = await ausdOf(alice.address);
    const { prepared, result } = await alice.act("burrow_add", { amount: s(usd(30)) });
    expect(prepared.toSign[0]!.typedData.message.to).toBe(d.router);
    expect(result.status).toBe("completed");
    const b = await alice.balance();
    expect(b.balance).toBe(s(bal - usd(30)));
    expect(b.burrow.amount).toBe(s(usd(30)));
    expect(b.burrow.earned).toBe("0");
    expect(b.burrow.ratePercent).toBe(4.2);
  });

  it("shows earnings as assets − principal", async () => {
    const minter = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS[0]), chain: services.chain.chain, transport: http(anvil.rpcUrl) });
    const hash = await minter.writeContract({ address: d.stata, abi: mockStataAbi, functionName: "accrue", args: [usd(3)] });
    await services.chain.client.waitForTransactionReceipt({ hash });
    const b = await alice.balance();
    expect(BigInt(b.burrow.earned)).toBeGreaterThan(usd(2.99));
  });

  it("auto-save: on with one confirmation, sweeps above the threshold now and when money arrives", async () => {
    // A confirm sheet abandoned in an earlier step would (rightly) hold sweeps until it expires.
    services.db.prepare("UPDATE actions SET expires_at = 0 WHERE status = 'prepared'").run();
    const { prepared, result } = await alice.act("burrow_autosave", { enabled: true, threshold: s(usd(20)) });
    expect(prepared.toSign.map((t) => t.key)).toEqual(["autoSave", "ausdPermit"]);
    expect(prepared.toSign[1]!.typedData.message.value).toBe(maxUint256.toString());
    expect(result.status).toBe("completed");
    expect(await ausdOf(alice.address)).toBe(usd(20));
    expect((await alice.call("GET", "/v1/me")).body.autoSave).toEqual({ enabled: true, threshold: s(usd(20)) });

    const burrowBefore = BigInt((await alice.balance()).burrow.amount);
    await mint(alice.address, usd(15));
    await services.keeper.tick();
    expect(await ausdOf(alice.address)).toBe(usd(20));
    expect(BigInt((await alice.balance()).burrow.amount)).toBeGreaterThanOrEqual(burrowBefore + usd(15) - 1n);
    expect((await alice.activity())[0]).toMatchObject({ kind: "burrow_in", note: "Auto-save", amount: s(usd(15)) });
  });

  it("never sweeps while the user is between prepare and submit", async () => {
    const p = await alice.prepare("send", { phone: "+15555550102", amount: s(usd(1)) });
    await mint(alice.address, usd(5));
    await services.keeper.tick();
    expect(await ausdOf(alice.address)).toBe(usd(25));
    const r = await alice.submit(p.body.id, await alice.sign(p.body));
    expect(r.body.status).toBe("completed");
    await services.keeper.tick();
    expect(await ausdOf(alice.address)).toBe(usd(20));
  });

  it("pays more than the balance by breaking Burrow inside the same transaction", async () => {
    const bobBefore = await ausdOf(bob.address);
    const burrowBefore = BigInt((await alice.balance()).burrow.amount);
    const { body: prepared } = await alice.prepare("send", { phone: "+15555550102", amount: s(usd(50)) });
    expect(prepared.summary.fromBurrow).toBe(s(usd(30)));
    expect(prepared.summary.lines).toContainEqual({ label: "From Burrow", value: "$30.00" });
    expect(prepared.toSign.map((t) => t.key)).toEqual(["payment", "burrowPermit"]);
    expect(prepared.toSign[1]!.typedData.message.spender).toBe(d.router);

    const sentBefore = services.relayer.sentCount;
    const nonceBefore = await services.chain.client.getTransactionCount({ address: services.relayer.address });
    const res = await alice.submit(prepared.id, await alice.sign(prepared));
    expect(res.body.status).toBe("completed");
    expect(services.relayer.sentCount - sentBefore).toBe(1);
    expect((await services.chain.client.getTransactionCount({ address: services.relayer.address })) - nonceBefore).toBe(1);

    const hash = res.body.receipt!.technical!.txHash;
    const receipt = await services.chain.client.getTransactionReceipt({ hash });
    expect(parseEventLogs({ abi: bilbyRouterAbi, eventName: "Broken", logs: receipt.logs })[0]!.args.assets).toBe(usd(30));
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
    expect(transfers.some((t) => t.args.from === alice.address && t.args.to === bob.address && t.args.value === usd(50))).toBe(true);
    expect(await ausdOf(alice.address)).toBe(0n);
    expect(await ausdOf(bob.address)).toBe(bobBefore + usd(50));
    expect(BigInt((await alice.balance()).burrow.amount)).toBeLessThanOrEqual(burrowBefore - usd(30) + 1n);
  });

  it("moves money back to the balance; the keeper doesn't sweep it back", async () => {
    const { result } = await alice.act("burrow_withdraw", { amount: s(usd(25)) });
    expect(result.status).toBe("completed");
    expect(await ausdOf(alice.address)).toBe(usd(25));
    await services.keeper.tick();
    expect(await ausdOf(alice.address)).toBe(usd(25));
  });

  it("says BURROW_BUSY before Face ID when Aave liquidity is short", async () => {
    await setLiquidity(usd(1));
    const w = await alice.prepare("burrow_withdraw", { amount: s(usd(5)) });
    expect(w.status).toBe(409);
    expect((w.body as any).error).toMatchObject({ code: "BURROW_BUSY", availableNow: s(usd(1)) });
    const pay = await alice.prepare("send", { phone: "+15555550102", amount: s(usd(30)) });
    expect((pay.body as any).error).toMatchObject({ code: "BURROW_BUSY", availableNow: s(usd(26)) });
    expect((await alice.balance()).burrow.availableNow).toBe(s(usd(1)));
    await setLiquidity(maxUint256);
  });

  it("turning auto-save off revokes the allowance", async () => {
    const { prepared, result } = await alice.act("burrow_autosave", { enabled: false, threshold: "0" });
    expect(prepared.toSign[1]!.typedData.message.value).toBe("0");
    expect(result.status).toBe("completed");
    const allowance = await services.chain.client.readContract({ address: d.ausd, abi: erc20Abi, functionName: "allowance", args: [alice.address, d.router] });
    expect(allowance).toBe(0n);
    expect(await services.chain.autoSave(alice.address)).toEqual({ enabled: false, threshold: 0n });
  });
});

describe("gift cards", () => {
  it("lists the catalog and quotes with the fee folded in", async () => {
    const cat = await (await app.request("/v1/giftcards/catalog?country=US")).json();
    const uber = cat.brands.find((b: any) => b.id === "uber-us");
    expect(uber).toMatchObject({ name: "Uber", available: true, feePercent: 2.5, minAmount: s(usd(15)) });
    const quote = await (await app.request("/v1/giftcards/quote", { method: "POST", body: JSON.stringify({ brandId: "uber-us", amount: s(usd(20)) }) })).json();
    expect(quote).toEqual({ brandId: "uber-us", amount: s(usd(20)), price: s(usd(20.5)), available: true });
  });

  it("buys a card for yourself; only the owner can reveal it", async () => {
    await mint(alice.address, usd(50));
    const treasuryBefore = await services.treasury.balance();
    const { prepared, result } = await alice.act("gift_buy", { brandId: "starbucks-us", amount: s(usd(10)) });
    expect(prepared.expect.payee).toBe(services.treasury.address);
    expect(result).toMatchObject({ status: "completed", giftCardId: expect.stringMatching(/^gc_/) });
    expect(await services.treasury.balance()).toBe(treasuryBefore + usd(10));
    const cards = (await alice.call("GET", "/v1/giftcards")).body.cards;
    expect(cards[0]).toMatchObject({ id: result.giftCardId, brandName: "Starbucks", amount: s(usd(10)), status: "ready" });
    const reveal = await alice.call("GET", `/v1/giftcards/${result.giftCardId}/reveal`);
    expect(reveal.body.code).toMatch(/^[A-Z0-9]{4}-/);
    expect(reveal.body.pin).toMatch(/^\d{4}$/);
    expect((await bob.call("GET", `/v1/giftcards/${result.giftCardId}/reveal`)).status).toBe(404);
  });

  it("refunds automatically when the purchase fails", async () => {
    const before = await ausdOf(alice.address);
    const treasuryBefore = await services.treasury.balance();
    const { result } = await alice.act("gift_buy", { brandId: "test-fail-us", amount: s(usd(5)) });
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ code: "GIFT_UNAVAILABLE", message: expect.stringContaining("back in your balance") });
    expect(await ausdOf(alice.address)).toBe(before);
    expect(await services.treasury.balance()).toBe(treasuryBefore);
    const feed = await alice.activity();
    expect(feed[0]).toMatchObject({ kind: "refund", status: "completed", amount: s(usd(5)) });
    expect(feed[1]).toMatchObject({ kind: "gift_bought", status: "failed" });
  });

  it("shows brands unavailable before paying when the float is low", async () => {
    const saved = provider.float;
    provider.float = usd(1);
    const p = await alice.prepare("gift_buy", { brandId: "starbucks-us", amount: s(usd(10)) });
    expect(p.status).toBe(409);
    expect((p.body as any).error.code).toBe("GIFT_UNAVAILABLE");
    const cat = await (await app.request("/v1/giftcards/catalog")).json();
    expect(cat.brands.find((b: any) => b.id === "starbucks-us").available).toBe(false);
    provider.float = saved;
  });

  it("gift to a number: escrowed, bought only when opened, revealable only by the recipient", async () => {
    const calls = provider.purchaseCalls;
    const { prepared, result } = await alice.act("gift_send", { phone: "+15555550106", brandId: "starbucks-us", amount: s(usd(25)), message: "Happy birthday!", design: "confetti" });
    expect(prepared.summary.title).toBe("Send a $25.00 Starbucks gift card to +1 •••• 0106");
    expect(result.status).toBe("waiting");
    expect(provider.purchaseCalls).toBe(calls);
    const code = result.claimLink!.split("/c/")[1]!;
    const view = (await alice.call("GET", `/v1/claims/${code}`, undefined, false)).body;
    expect(view).toMatchObject({ kind: "gift", amount: s(usd(25)), gift: { brandId: "starbucks-us", brandName: "Starbucks", brandArtworkUrl: "https://cdn.bitrefill.com/primg/w600h400/starbucks-usa.png", message: "Happy birthday!", design: "confetti" } });
    const html = await (await app.request(`/c/${code}`)).text();
    expect(html).toContain("Alice sent you a $25 Starbucks gift card");

    const frank = await user("+1 555 555 0106", "Frank").onboard();
    const treasuryBefore = await services.treasury.balance();
    const res = await frank.call("POST", `/v1/claims/${code}/accept`, { phoneToken: frank.phoneToken });
    expect(res.body).toMatchObject({ status: "completed", giftCardId: expect.stringMatching(/^gc_/) });
    expect(await services.treasury.balance()).toBe(treasuryBefore + usd(25));
    expect(provider.purchaseCalls).toBe(calls + 1);
    const cards = (await frank.call("GET", "/v1/giftcards")).body.cards;
    expect(cards[0]).toMatchObject({ brandName: "Starbucks", amount: s(usd(25)), status: "ready", from: "Alice" });
    expect((await frank.call("GET", `/v1/giftcards/${res.body.giftCardId}/reveal`)).body.code).toBeTruthy();
    expect((await alice.call("GET", `/v1/giftcards/${res.body.giftCardId}/reveal`)).status).toBe(404);
    expect((await frank.activity())[0]).toMatchObject({ kind: "gift_received", giftCardId: res.body.giftCardId, counterparty: { name: "Alice" } });
    // Re-opening doesn't buy twice.
    await frank.call("POST", `/v1/claims/${code}/accept`, { phoneToken: frank.phoneToken });
    expect(provider.purchaseCalls).toBe(calls + 1);
  });

  it("recipient's choice: the recipient picks the brand, change lands in their balance", async () => {
    const { prepared, result } = await alice.act("gift_send", { phone: "+15555550107", amount: s(usd(20)) });
    expect(prepared.summary.total).toBe(s(usd(20.5))); // covers the priciest fee (2.5%)
    const code = result.claimLink!.split("/c/")[1]!;
    const gina = await user("+1 555 555 0107", "Gina").onboard();
    const noBrand = await gina.call("POST", `/v1/claims/${code}/accept`, { phoneToken: gina.phoneToken });
    expect(noBrand.body.error.code).toBe("INVALID_REQUEST");
    const res = await gina.call("POST", `/v1/claims/${code}/accept`, { phoneToken: gina.phoneToken, brandId: "starbucks-us" });
    expect(res.body.status).toBe("completed");
    expect(await ausdOf(gina.address)).toBe(usd(0.5));
  });
});

describe("rebind safety", () => {
  it("a number that moved to a new account shows recentlyChanged and warns the sender", async () => {
    const hank1 = await user("+1 555 555 0108", "Hank").onboard();
    const hank2 = await user("+1 555 555 0108", "Hank").onboard();
    expect(hank2.address).not.toBe(hank1.address);
    const pending = await hank2.call("GET", "/v1/accounts/phone");
    expect(pending.body.status).toBe("pending");
    await testClient(anvil.rpcUrl).increaseTime({ seconds: 7 * 86_400 + 1 });
    await testClient(anvil.rpcUrl).mine({ blocks: 1 });
    await hank2.verifyPhone();
    expect((await hank2.register()).body.status).toBe("registered");
    const res = await alice.call("POST", "/v1/resolve", { phones: ["+15555550108"] });
    expect(res.body.results[0]).toMatchObject({ status: "registered", address: hank2.address, recentlyChanged: true });
    expect((await services.chain.resolve(services.accounts.phoneKeyOf("+15555550108"))).account).toBe(hank2.address);
    const p = await alice.prepare("send", { phone: "+15555550108", amount: s(usd(1)) });
    expect(p.body.summary.warnings[0]!.code).toBe("RECIPIENT_RECENTLY_CHANGED");
    expect((await hank1.call("GET", "/v1/me")).body).toMatchObject({ address: hank1.address, phoneStatus: "reassigned" });
  });
});

describe("invariants", () => {
  it("no user ever held MON", async () => {
    for (const u of users) expect(await monOf(u.address)).toBe(0n);
    expect(await monOf(services.treasury.address)).toBe(0n);
  });

  it("never uses crypto words in user-facing messages", async () => {
    const texts: string[] = [];
    for (const u of users) {
      if (!u.session) continue;
      for (const item of (await u.call("GET", "/v1/activity")).body.items ?? []) texts.push(item.note ?? "", item.counterparty?.name ?? "");
    }
    const errorBodies = [
      await alice.prepare("send", { phone: "+15555550102", amount: s(usd(1_000_000)) }),
      await alice.prepare("burrow_withdraw", { amount: s(usd(1_000_000)) }),
      await alice.call("POST", "/v1/claims/nope/accept", { phoneToken: "x" }),
    ].map((r) => (r.body as any).error?.message ?? "");
    for (const t of [...texts, ...errorBodies]) {
      expect(t).not.toMatch(/\b(transaction|tx|gas|token|wallet|address|chain|blockchain|crypto|AUSD|USDC|MON|escrow|stake|yield|APY|interest)\b/i);
    }
  });
});

