import { hydrateTypedData, mockAusdAbi, type Deployment } from "@bilbypay/core";
import { createWalletClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { registerMessage } from "../src/auth";
import { loadConfig } from "../src/config";
import { createServices, type Services } from "../src/services";
import { fromJson } from "../src/util";
import { AppUser } from "./helpers/app";
import { ANVIL_KEYS, deployAll, startAnvil, testClient, type Anvil } from "./helpers/chain";

let anvil: Anvil;
let deployment: Deployment;
let services: Services;
let sender: AppUser;
let original: AppUser;
let replacement: AppUser;
let another: AppUser;
let app: ReturnType<typeof createApp>;
let preparedSend: Awaited<ReturnType<AppUser["prepare"]>>;
let oldClaim: string;

beforeAll(async () => {
  anvil = await startAnvil();
  const verifier = generatePrivateKey();
  const treasury = generatePrivateKey();
  deployment = await deployAll(anvil.rpcUrl, { deployer: ANVIL_KEYS[0], verifier: privateKeyToAccount(verifier).address, treasury: privateKeyToAccount(treasury).address, keeper: privateKeyToAccount(ANVIL_KEYS[2]).address });
  services = createServices(loadConfig({
    CHAIN_ID: "143", RPC_URL: anvil.rpcUrl, POLLING_INTERVAL_MS: "20", DATABASE_PATH: ":memory:",
    AUSD_ADDRESS: deployment.ausd, STATA_ADDRESS: deployment.stata, DIRECTORY_ADDRESS: deployment.directory, ESCROW_ADDRESS: deployment.escrow, ROUTER_ADDRESS: deployment.router,
    RELAYER_PRIVATE_KEY: ANVIL_KEYS[1], VERIFIER_PRIVATE_KEY: verifier, TREASURY_PRIVATE_KEY: treasury, KEEPER_PRIVATE_KEY: ANVIL_KEYS[2],
    PHONE_PEPPER: "directory-v2-test", TOKEN_SECRET: `0x${"33".repeat(32)}`, GIFT_CODE_KEY: `0x${"44".repeat(32)}`, OTP_PROVIDER: "test", KEEPER_DEBOUNCE_MS: "0",
  }));
  await services.chain.verifyDomains();
  app = createApp(services);
  sender = await new AppUser(app, "+15555550301", "Sender").onboard();
  original = await new AppUser(app, "+15555550302", "Original").onboard();
  replacement = new AppUser(app, original.phone, "Replacement");
  another = await new AppUser(app, "+15555550303", "Another").onboard();
  const minter = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS[0]), chain: monad, transport: http(anvil.rpcUrl) });
  for (const account of [sender.address, original.address]) {
    await services.chain.client.waitForTransactionReceipt({ hash: await minter.writeContract({ address: deployment.ausd, abi: mockAusdAbi, functionName: "mint", args: [account, 100_000_000n] }) });
  }
});
afterAll(() => { services?.db.close(); anvil?.stop(); });

async function manage(user: AppUser, operation: "revoke" | "cancelRecovery") {
  const p = await user.call("POST", "/v1/accounts/phone/prepare", { operation });
  expect(p.status).toBe(200);
  const signature = await user.account.signTypedData(hydrateTypedData(p.body.typedData) as never);
  return user.call("POST", "/v1/accounts/phone/submit", { id: p.body.id, signature });
}

describe("directory v2 through the real API and contracts", () => {
  it("requires independent destination consent, with no write on missing or wrong consent", async () => {
    const fresh = new AppUser(app, "+15555550304", "Fresh");
    await fresh.verifyPhone();
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await fresh.account.signMessage({ message: registerMessage({ phone: fresh.e164!, address: fresh.address, issuedAt }) });
    const base = { phoneToken: fresh.phoneToken, address: fresh.address, displayName: fresh.name, issuedAt, signature };
    expect((await fresh.call("POST", "/v1/accounts/register", base, false)).status).toBe(400);
    const p = await fresh.call("POST", "/v1/accounts/registration/prepare", { phoneToken: fresh.phoneToken, address: fresh.address }, false);
    const consentSignature = await sender.account.signTypedData(hydrateTypedData(p.body.typedData) as never);
    const wrong = await fresh.call("POST", "/v1/accounts/register", { ...base, registrationId: p.body.id, consentSignature }, false);
    expect(wrong.body.error.code).toBe("CONFIRMATION_FAILED");
    expect((await services.chain.resolve(services.accounts.phoneKeyOf(fresh.e164!))).account).toBeNull();
  });

  it("rebuilds a lost discovery mirror from finalized directory events", async () => {
    await testClient(anvil.rpcUrl).mine({ blocks: 100 });
    services.db.prepare("DELETE FROM phone_bindings").run();
    const result = await services.directoryCache.runOnce();
    expect(result.caughtUp).toBe(true);
    expect(services.accounts.binding(services.accounts.phoneKeyOf(original.phone))).toMatchObject({ address: original.address, revision: "1" });
    expect((await original.call("GET", "/v1/me")).body.displayName).toBe("Original");
  });

  it("requires a seven-day review, freezes discovery and preserves the old account's funds", async () => {
    preparedSend = await sender.prepare("send", { phone: original.phone, amount: "1000000" });
    const gift = await sender.act("gift_send", { phone: original.phone, amount: "10000000", brandId: null });
    oldClaim = gift.result.claimLink!.split("/c/")[1]!;
    await replacement.verifyPhone();
    const result = await replacement.register();
    expect(result.body).toMatchObject({ status: "pending", profile: null });
    expect(Date.parse(result.body.availableAt)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const resolution = await sender.call("POST", "/v1/resolve", { phones: [original.phone] });
    expect(resolution.body.results[0]).toMatchObject({ status: "unavailable", directory: { pending: true, revision: "2" } });
    expect((await replacement.register()).body.error.code).toBe("PHONE_CHANGE_PENDING");
    expect((await sender.prepare("send", { phone: original.phone, amount: "1000000" })).body).toMatchObject({ error: { code: "PHONE_CHANGE_PENDING" } });
    expect((await original.call("GET", "/v1/me")).body).toMatchObject({ phoneStatus: "pending", address: original.address });
    expect((await original.balance()).balance).toBe("100000000");
    expect((await original.act("send", { phone: another.phone, amount: "1000000" })).result.status).toBe("completed");
  });

  it("refuses a previously reviewed payment after the recipient revision changes", async () => {
    const before = await services.chain.ausdBalance(original.address);
    const result = await sender.submit(preparedSend.body.id, await sender.sign(preparedSend.body));
    expect(result.body).toMatchObject({ status: "failed", error: { code: "RECIPIENT_CHANGED" } });
    expect(await services.chain.ausdBalance(original.address)).toBe(before);
  });

  it("lets the existing controller cancel a number takeover and keeps the revision monotonic", async () => {
    expect((await manage(original, "cancelRecovery")).body).toMatchObject({ ok: true, status: "active", revision: "3" });
    expect((await services.chain.resolve(services.accounts.phoneKeyOf(original.phone))).account).toBe(original.address);
    const accepted = await original.call("POST", `/v1/claims/${oldClaim}/accept`, { phoneToken: original.phoneToken, brandId: "starbucks-us" });
    expect(accepted.body.status).toBe("completed");
  });

  it("reassignment invalidates older unclaimed gifts and refunds their original sender", async () => {
    const originalBalance = await services.chain.ausdBalance(original.address);
    const gift = await sender.act("gift_send", { phone: original.phone, amount: "10000000", brandId: null });
    const code = gift.result.claimLink!.split("/c/")[1]!;
    await replacement.verifyPhone();
    expect((await replacement.register()).body.status).toBe("pending");
    await testClient(anvil.rpcUrl).increaseTime({ seconds: 7 * 86_400 + 1 });
    await testClient(anvil.rpcUrl).mine({ blocks: 1 });
    expect((await replacement.register()).body.error.code).toBe("OTP_EXPIRED");
    await replacement.verifyPhone();
    expect((await replacement.register()).body.status).toBe("registered");
    const reject = await replacement.call("POST", `/v1/claims/${code}/accept`, { phoneToken: replacement.phoneToken, brandId: "starbucks-us" });
    expect(reject.body.error.code).toBe("CLAIM_RECIPIENT_CHANGED");
    expect((await original.call("GET", "/v1/me")).body.phoneStatus).toBe("reassigned");
    expect((await original.balance()).balance).toBe(originalBalance.toString());
    const row = services.claims.get(code)!;
    const before = await services.chain.ausdBalance(sender.address);
    await services.keeper.refundExpired();
    expect(await services.chain.ausdBalance(sender.address)).toBe(before + BigInt(row.amount));
    expect(services.claims.get(code)?.status).toBe("returned");
    expect(await services.chain.ausdBalance(replacement.address)).toBe(0n);
  });

  it("revokes receiving without removing account access; a fresh phone proof renews it", async () => {
    expect((await manage(replacement, "revoke")).body.status).toBe("revoked");
    expect((await replacement.call("GET", "/v1/me")).body.phoneStatus).toBe("revoked");
    const resolution = await sender.call("POST", "/v1/resolve", { phones: [replacement.phone] });
    expect(resolution.body.results[0].status).toBe("unavailable");
    await replacement.verifyPhone();
    expect((await replacement.register()).body.status).toBe("registered");
    expect((await replacement.call("GET", "/v1/accounts/phone")).body.status).toBe("active");
  });

  it("an old successful registration retry cannot overwrite a newer phone profile", async () => {
    const moved = new AppUser(app, "+15555550305", "Original");
    Object.assign(moved, { account: original.account });
    await moved.onboard();
    const old = services.db.prepare("SELECT id,payload FROM directory_requests WHERE account = ? AND phone_key = ? AND operation = 'bind' ORDER BY rowid LIMIT 1").get(original.address, services.accounts.phoneKeyOf(original.phone)) as { id: string; payload: string };
    const { typedData } = fromJson<{ typedData: Parameters<typeof hydrateTypedData>[0] }>(old.payload);
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await original.account.signMessage({ message: registerMessage({ phone: original.phone, address: original.address, issuedAt }) });
    const consentSignature = await original.account.signTypedData(hydrateTypedData(typedData) as never);
    const retry = await original.call("POST", "/v1/accounts/register", { phoneToken: original.phoneToken, address: original.address, displayName: original.name, issuedAt, signature, registrationId: old.id, consentSignature }, false);
    expect(retry.body.error.code).toBe("RECIPIENT_CHANGED");
    expect((await moved.call("GET", "/v1/me")).body).toMatchObject({ phone: moved.phone, phoneStatus: "active" });
  });

  it("never presents an expired known number as a new invitation", async () => {
    await testClient(anvil.rpcUrl).increaseTime({ seconds: 365 * 86_400 + 1 });
    await testClient(anvil.rpcUrl).mine({ blocks: 1 });
    const resolution = await sender.call("POST", "/v1/resolve", { phones: [replacement.phone] });
    expect(resolution.body.results[0].status).toBe("unavailable");
    expect((await replacement.call("GET", "/v1/me")).body.phoneStatus).toBe("expired");
    expect((await sender.prepare("send", { phone: replacement.phone, amount: "1000000" })).body).toMatchObject({ error: { code: "PHONE_UNAVAILABLE" } });
  });
});
