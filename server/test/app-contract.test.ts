/**
 * Contract test: the mobile app's own HTTP client, pre-authorization guard and authorize flow
 * (app/src/api/http.ts, app/src/signing/guard.ts, app/src/flows/authorize.ts) driving this server
 * on a real local chain. Catches drift between docs/api.md, the server and the app.
 */
import { hydrateTypedData, type Deployment, mockAusdAbi } from "@bilbypay/core";
import type { Hono } from "hono";
import { type Address, createWalletClient, type Hex, http } from "viem";
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpApi } from "../../app/src/api/http";
import type { ActionRequest, BilbyApi } from "../../app/src/api/types";
import { authorizeAndSubmit } from "../../app/src/flows/authorize";
import { createPinnedDirectoryReader } from "../../app/src/directory/verification";
import type { Recipient } from "../../app/src/flows/drafts";
import { registerMessage, sessionMessage } from "../../app/src/signing/messages";
import { checkDirectoryConsent } from "../../app/src/signing/directory";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db";
import { MockGiftCardProvider } from "../src/giftcards/mock";
import { createServices, type Services } from "../src/services";
import { ANVIL_KEYS, type Anvil, deployAll, startAnvil } from "./helpers/chain";

let anvil: Anvil;
let d: Deployment;
let services: Services;
let app: Hono<any>;
let mint: (to: Address, amount: bigint) => Promise<void>;

/** One phone running the real app code. */
class Phone {
  readonly account: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());
  token: string | null = null;
  readonly api: BilbyApi = createHttpApi({
    baseUrl: "http://bilbypay.test",
    getToken: () => this.token,
    fetch: ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch,
  });
  phoneToken = "";
  constructor(readonly phone: string, readonly name: string) {}

  async verify() {
    await this.api.otpStart(this.phone, "US");
    const v = await this.api.otpVerify(this.phone, "000000");
    this.phoneToken = v.phoneToken;
    return v;
  }

  async onboard() {
    const v = await this.verify();
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await this.account.signMessage({ message: registerMessage(v.phone, this.account.address, issuedAt) });
    const consent = await this.api.prepareRegistration({ phoneToken: v.phoneToken, address: this.account.address });
    const consentSignature = await this.account.signTypedData(hydrateTypedData(consent.typedData) as never);
    const res = await this.api.register({ phoneToken: v.phoneToken, address: this.account.address, displayName: this.name, issuedAt, signature, registrationId: consent.id, consentSignature });
    this.token = res.sessionToken;
    return res;
  }

  /** The app's confirm path: prepare → guard → one unlock → sign all → submit. */
  async act(request: ActionRequest, resolvedPayee?: Hex) {
    let recipient: Recipient | undefined;
    if (request.type === "send" || request.type === "gift_send") {
      const selected = (await this.api.resolve([request.params.phone], "US")).results[0]!;
      if (!selected.e164 || (selected.status !== "registered" && selected.status !== "invite")) throw new Error("Recipient unavailable");
      recipient = { ...selected, status: selected.status, e164: selected.e164, name: selected.displayName ?? selected.e164 };
      request = request.type === "send"
        ? { ...request, params: { ...request.params, phone: selected.e164 } }
        : { ...request, params: { ...request.params, phone: selected.e164 } };
    }
    const prepared = await this.api.prepareAction(request);
    const { result } = await authorizeAndSubmit({
      api: this.api,
      request,
      prepared,
      account: this.account.address,
      chainId: 143,
      resolvedPayee,
      recipient,
      escrow: d.escrow,
      readDirectory: createPinnedDirectoryReader({ chainId: 143, directory: d.directory, rpcUrl: anvil.rpcUrl }),
      unlock: (fn) => fn(this.account),
    });
    return { prepared, result };
  }
}

beforeAll(async () => {
  anvil = await startAnvil();
  const treasuryKey = generatePrivateKey();
  const verifierKey = generatePrivateKey();
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
    PHONE_PEPPER: "contract-pepper",
    TOKEN_SECRET: `0x${"33".repeat(32)}`,
    GIFT_CODE_KEY: `0x${"44".repeat(32)}`,
    OTP_PROVIDER: "test",
    PUBLIC_BASE_URL: "https://bilbypay.test",
    EXPLORER_URL: "https://explorer.test",
    KEEPER_DEBOUNCE_MS: "0",
    DATABASE_PATH: ":memory:",
  });
  services = createServices(config, { db: openDb(":memory:"), giftProvider: new MockGiftCardProvider() });
  await services.chain.verifyDomains();
  app = createApp(services);
  const chain = { ...monad, rpcUrls: { default: { http: [anvil.rpcUrl] } } };
  const minter = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS[0]), chain, transport: http(anvil.rpcUrl) });
  mint = async (to, amount) => {
    const hash = await minter.writeContract({ address: d.ausd, abi: mockAusdAbi, functionName: "mint", args: [to, amount] });
    await services.chain.client.waitForTransactionReceipt({ hash });
  };
});

afterAll(() => anvil?.stop());

const alice = new Phone("+1 555 555 0201", "Alice");
const bob = new Phone("+1 555 555 0202", "Bob");
const carol = new Phone("+1 555 555 0203", "Carol");

describe("app ↔ server contract", () => {
  it("exposes the complete typed consent shape for account-owned number management", async () => {
    const manager = new Phone("+15555550298", "Manager");
    await manager.onboard();
    const status = await manager.api.phoneStatus();
    const prepared = await manager.api.preparePhoneAction("revoke");
    const typed = checkDirectoryConsent(prepared, { account: manager.account.address, chainId: 143, directoryAddress: d.directory, operation: "revoke", phoneKey: status.phoneKey! });
    const result = await manager.api.submitPhoneAction({ id: prepared.id, signature: await manager.account.signTypedData(typed) });
    expect(result.status).toBe("revoked");
    expect((await manager.api.me()).phoneStatus).toBe("revoked");
  });

  it("onboards, signs in again and reads profile + balance", async () => {
    await alice.onboard();
    await bob.onboard();
    await mint(alice.account.address, 500_000_000n);

    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await alice.account.signMessage({ message: sessionMessage(alice.account.address, issuedAt) });
    const again = await alice.api.session({ address: alice.account.address, issuedAt, signature });
    expect(again.profile?.displayName).toBe("Alice");
    expect((await alice.api.me()).phone).toBe("+15555550201");
    expect((await alice.api.balance()).balance).toBe("500000000");
  });

  it("a signed-in account with no number gets PHONE_REQUIRED (app → phone step)", async () => {
    const stranger = new Phone("+1 555 555 0299", "Stranger");
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await stranger.account.signMessage({ message: sessionMessage(stranger.account.address, issuedAt) });
    const res = await stranger.api.session({ address: stranger.account.address, issuedAt, signature });
    expect(res.profile).toBeNull();
    stranger.token = res.sessionToken;
    await expect(stranger.api.me()).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
  });

  it("send to a registered contact passes the app guard", async () => {
    const [r] = (await alice.api.resolve([bob.phone], "US")).results;
    expect(r?.status).toBe("registered");
    const { result } = await alice.act({ type: "send", params: { phone: bob.phone, amount: "20000000", note: "lunch" } }, r!.address);
    expect(result.status).toBe("completed");
    expect((await bob.api.balance()).balance).toBe("20000000");
  });

  it("burrow add, auto-save on/off and move to balance pass the guard", async () => {
    expect((await alice.act({ type: "burrow_add", params: { amount: "100000000" } })).result.status).toBe("completed");
    expect((await alice.act({ type: "burrow_autosave", params: { enabled: true, threshold: "300000000" } })).result.status).toBe("completed");
    expect((await alice.act({ type: "burrow_autosave", params: { enabled: false, threshold: "0" } })).result.status).toBe("completed");
    expect((await alice.act({ type: "burrow_withdraw", params: { amount: "10000000" } })).result.status).toBe("completed");
    const b = await alice.api.balance();
    expect(BigInt(b.burrow.amount)).toBeGreaterThan(89_000_000n);
  });

  it("paying more than the balance takes the rest from Burrow (guard accepts the Burrow permit)", async () => {
    const bal = BigInt((await alice.api.balance()).balance);
    const [r] = (await alice.api.resolve([bob.phone], "US")).results;
    const amount = bal + 30_000_000n;
    const { prepared, result } = await alice.act({ type: "send", params: { phone: bob.phone, amount: amount.toString() } }, r!.address);
    expect(BigInt(prepared.summary.fromBurrow)).toBe(30_000_000n);
    expect(result.status).toBe("completed");
    expect((await alice.api.balance()).balance).toBe("0");
  });

  it("invite send → claim link → Carol opens it with the app client", async () => {
    await mint(alice.account.address, 100_000_000n);
    const { result } = await alice.act({ type: "send", params: { phone: carol.phone, amount: "15000000" } });
    expect(result.status).toBe("waiting");
    const code = result.claimLink!.split("/c/")[1]!;
    const claim = await carol.api.claim(code);
    expect(claim).toMatchObject({ kind: "money", amount: "15000000", senderName: "Alice", status: "waiting" });
    await carol.onboard();
    const accepted = await carol.api.acceptClaim(code, { phoneToken: carol.phoneToken });
    expect(accepted.status).toBe("completed");
    expect((await carol.api.balance()).balance).toBe("15000000");
  });

  it("take back an unopened send", async () => {
    const { result } = await alice.act({ type: "send", params: { phone: "+1 555 555 0277", amount: "5000000" } });
    expect(result.status).toBe("waiting");
    const item = (await alice.api.activity()).items.find((i) => i.canCancel);
    expect(item).toBeTruthy();
    expect((await alice.act({ type: "cancel", params: { activityId: item!.id } })).result.status).toBe("completed");
  });

  it("gift cards: buy for me, reveal; send to a number, opened with a brand pick", async () => {
    const { brands } = await alice.api.catalog("US");
    const brand = brands.find((b) => b.available && !b.denominations)!;
    const bought = await alice.act({ type: "gift_buy", params: { brandId: brand.id, amount: "10000000" } });
    expect(bought.result.status).toBe("completed");
    const reveal = await alice.api.revealGiftCard(bought.result.giftCardId!);
    expect(reveal.code).toBeTruthy();

    const sent = await alice.act({ type: "gift_send", params: { phone: bob.phone, brandId: null, amount: "10000000", message: "Happy birthday" } });
    expect(sent.result.status).toBe("waiting");
    const code = sent.result.claimLink!.split("/c/")[1]!;
    await bob.verify();
    const opened = await bob.api.acceptClaim(code, { phoneToken: bob.phoneToken, brandId: brand.id });
    expect(opened.status).toBe("completed");
    expect((await bob.api.giftCards()).cards).toHaveLength(1);
  });

  it("server errors reach the app as code + human message", async () => {
    await expect(bob.api.prepareAction({ type: "burrow_withdraw", params: { amount: "999000000" } })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("in Burrow"),
    });
  });
});
