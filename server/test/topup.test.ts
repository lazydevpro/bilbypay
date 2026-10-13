/**
 * Top-ups: the provider delivers USDC to the treasury, the server checks the delivery on-chain and
 * credits the user the same amount in AUSD, exactly once. Real anvil chain + contracts; the
 * provider is the package's mock with its delivery hashes swapped for real USDC transfers.
 */
import { type Deployment, mockAusdAbi } from "@bilbypay/core";
import { MockTopUpProvider, type QuoteParams, type TopUpStatusResult } from "@bilbypay/topup";
import type { Hono } from "hono";
import { type Address, createPublicClient, createWalletClient, erc20Abi, type Hex, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db";
import { MockGiftCardProvider } from "../src/giftcards/mock";
import { createServices, type Services } from "../src/services";
import { TopUpService } from "../src/topup";
import { AppUser } from "./helpers/app";
import { ANVIL_KEYS, type Anvil, deployAll, deployMockToken, startAnvil } from "./helpers/chain";

/** Mock provider whose "completed" deliveries point at transactions the test chooses. */
class TestProvider extends MockTopUpProvider {
  lastQuote?: QuoteParams;
  deliveries = new Map<string, Hex[]>();
  override async quote(params: QuoteParams) {
    this.lastQuote = params;
    return super.quote(params);
  }
  override async status(id: string): Promise<TopUpStatusResult> {
    const st = await super.status(id);
    return st.status === "completed" ? { ...st, destinationTxHashes: this.deliveries.get(id) ?? [] } : st;
  }
}

let anvil: Anvil;
let config: ReturnType<typeof loadConfig>;
/** A second chain standing in for the network a live provider delivers to (Monad mainnet for a testnet server). */
let remote: Anvil;
let remoteUsdc: Address;
let deliverRemote: (amount: bigint) => Promise<Hex>;
let d: Deployment;
let usdc: Address;
let services: Services;
let app: Hono<any>;
let provider: TestProvider;
let treasury: Address;
let mintAusd: (to: Address, amount: bigint) => Promise<void>;
/** Sends USDC to the treasury the way the provider's delivery would; returns the tx hash. */
let deliver: (amount: bigint) => Promise<Hex>;
let alice: AppUser;
let bob: AppUser;

beforeAll(async () => {
  anvil = await startAnvil();
  const treasuryKey = generatePrivateKey();
  const verifierKey = generatePrivateKey();
  treasury = privateKeyToAccount(treasuryKey).address;
  d = await deployAll(anvil.rpcUrl, {
    deployer: ANVIL_KEYS[0],
    verifier: privateKeyToAccount(verifierKey).address,
    treasury,
    keeper: privateKeyToAccount(ANVIL_KEYS[2]).address,
  });
  usdc = await deployMockToken(anvil.rpcUrl, ANVIL_KEYS[0]);
  config = loadConfig({
    CHAIN_ID: "143",
    RPC_URL: anvil.rpcUrl,
    POLLING_INTERVAL_MS: "20",
    AUSD_ADDRESS: d.ausd,
    STATA_ADDRESS: d.stata,
    DIRECTORY_ADDRESS: d.directory,
    ESCROW_ADDRESS: d.escrow,
    ROUTER_ADDRESS: d.router,
    USDC_ADDRESS: usdc,
    RELAYER_PRIVATE_KEY: ANVIL_KEYS[1],
    KEEPER_PRIVATE_KEY: ANVIL_KEYS[2],
    VERIFIER_PRIVATE_KEY: verifierKey,
    TREASURY_PRIVATE_KEY: treasuryKey,
    PHONE_PEPPER: "topup-pepper",
    TOKEN_SECRET: `0x${"55".repeat(32)}`,
    GIFT_CODE_KEY: `0x${"66".repeat(32)}`,
    OTP_PROVIDER: "test",
    PUBLIC_BASE_URL: "https://bilbypay.test",
    KEEPER_DEBOUNCE_MS: "0",
    DATABASE_PATH: ":memory:",
  });
  // Deposits "arrive" only when the test says so; completion follows immediately.
  provider = new TestProvider({ autoDepositMs: null, processingMs: 0, feeBps: 0 });
  services = createServices(config, { db: openDb(":memory:"), giftProvider: new MockGiftCardProvider(), topup: provider });
  app = createApp(services);

  const chain = { ...monad, rpcUrls: { default: { http: [anvil.rpcUrl] } } };
  const minter = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS[0]), chain, transport: http(anvil.rpcUrl) });
  const mint = async (token: Address, to: Address, amount: bigint) => {
    const hash = await minter.writeContract({ address: token, abi: mockAusdAbi, functionName: "mint", args: [to, amount] });
    await services.chain.client.waitForTransactionReceipt({ hash });
    return hash;
  };
  mintAusd = async (to, amount) => void (await mint(d.ausd, to, amount));
  deliver = (amount) => mint(usdc, treasury, amount);

  remote = await startAnvil();
  remoteUsdc = await deployMockToken(remote.rpcUrl, ANVIL_KEYS[0]);
  const remoteChain = { ...monad, rpcUrls: { default: { http: [remote.rpcUrl] } } };
  const remoteMinter = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS[0]), chain: remoteChain, transport: http(remote.rpcUrl) });
  const remoteClient = createPublicClient({ chain: remoteChain, transport: http(remote.rpcUrl) });
  deliverRemote = async (amount) => {
    const hash = await remoteMinter.writeContract({ address: remoteUsdc, abi: mockAusdAbi, functionName: "mint", args: [treasury, amount] });
    await remoteClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  alice = await new AppUser(app, "+1 555 555 0301", "Alice").onboard();
  bob = await new AppUser(app, "+1 555 555 0302", "Bob").onboard();
  await mintAusd(treasury, 1_000_000_000n); // the treasury's AUSD float
});

afterAll(() => {
  anvil?.stop();
  remote?.stop();
});

const ausd = (a: Address) => services.chain.ausdBalance(a);
const usdcOf = (a: Address) => services.chain.client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const status = (u: AppUser, quoteId: string) => u.call("GET", `/v1/topup/${encodeURIComponent(quoteId)}`);

async function quote(u: AppUser, amount: bigint) {
  const res = await u.call("POST", "/v1/topup/quote", { originAsset: "base:usdc", amount: amount.toString() });
  expect(res.status).toBe(200);
  return res.body.quoteId as string;
}

describe("top-up: USDC delivered to the treasury, credited as AUSD", () => {
  it("offers only origins where refunds can go back to the user's own account", async () => {
    const res = await alice.call("GET", "/v1/topup/origins");
    const ids: string[] = res.body.origins.map((o: { id: string }) => o.id);
    expect(ids).toContain("base:usdc");
    expect(ids.some((id) => /solana|tron|near/i.test(id))).toBe(false);
  });

  it("asks the provider to deliver to the treasury and refund to the user", async () => {
    await quote(alice, 25_000_000n);
    expect(provider.lastQuote?.recipient).toBe(treasury);
    expect(provider.lastQuote?.refundTo).toBe(alice.address);
  });

  it("waits, then credits AUSD 1:1 once the USDC is seen arriving in the treasury", async () => {
    const id = await quote(alice, 25_000_000n);
    expect((await status(alice, id)).body.status).toBe("waiting");

    provider.simulateDeposit(id);
    // Provider says completed, but nothing has arrived on-chain yet: no credit.
    expect((await status(alice, id)).body.status).toBe("processing");
    expect(await ausd(alice.address)).toBe(0n);

    provider.deliveries.set(id, [await deliver(25_000_000n)]);
    const floatBefore = await ausd(treasury);
    const done = await status(alice, id);
    expect(done.body).toMatchObject({ status: "completed", amountOut: "25000000" });
    expect(await ausd(alice.address)).toBe(25_000_000n);
    expect(await ausd(treasury)).toBe(floatBefore - 25_000_000n);
    expect(await usdcOf(alice.address)).toBe(0n);
    const feed = await alice.call("GET", "/v1/activity");
    expect(feed.body.items[0]).toMatchObject({ kind: "received", status: "completed", amount: "25000000", note: "Added money" });

    // Polling again and the keeper never pay twice.
    await status(alice, id);
    await services.keeper.tick();
    expect(await ausd(alice.address)).toBe(25_000_000n);
  });

  it("credits what actually arrived when it is less than the quote", async () => {
    const id = await quote(bob, 10_000_000n);
    provider.simulateDeposit(id);
    provider.deliveries.set(id, [await deliver(9_990_000n)]);
    expect((await status(bob, id)).body).toMatchObject({ status: "completed", amountOut: "9990000" });
    expect(await ausd(bob.address)).toBe(9_990_000n);
  });

  it("the same delivery can't be credited to a second top-up", async () => {
    const first = await quote(alice, 5_000_000n);
    const second = await quote(alice, 5_000_000n);
    const hash = await deliver(5_000_000n);
    provider.simulateDeposit(first);
    provider.simulateDeposit(second);
    provider.deliveries.set(first, [hash]);
    provider.deliveries.set(second, [hash]);
    const before = await ausd(alice.address);
    expect((await status(alice, first)).body.status).toBe("completed");
    expect((await status(alice, second)).body.status).toBe("processing");
    expect(await ausd(alice.address)).toBe(before + 5_000_000n);
  });

  it("the keeper settles top-ups nobody is polling", async () => {
    const id = await quote(bob, 3_000_000n);
    provider.simulateDeposit(id);
    provider.deliveries.set(id, [await deliver(3_000_000n)]);
    const before = await ausd(bob.address);
    await services.keeper.tick();
    expect(await ausd(bob.address)).toBe(before + 3_000_000n);
  });

  it("the keeper still credits top-ups when another job's scan fails (Worker alarm path)", async () => {
    const id = await quote(bob, 1_000_000n);
    provider.simulateDeposit(id);
    provider.deliveries.set(id, [await deliver(1_000_000n)]);
    const before = await ausd(bob.address);
    const scan = services.keeper.scanTransfers;
    services.keeper.scanTransfers = async () => { throw new Error("rpc rate limited"); };
    try {
      await expect(services.keeper.tick()).rejects.toThrow("rpc rate limited");
    } finally {
      services.keeper.scanTransfers = scan;
    }
    expect(await ausd(bob.address)).toBe(before + 1_000_000n);
  });

  it("a restart after the credit was sent but before it was recorded doesn't pay again", async () => {
    const id = await quote(bob, 4_000_000n);
    provider.simulateDeposit(id);
    provider.deliveries.set(id, [await deliver(4_000_000n)]);
    // Simulate the crash: record 'crediting', send the payment, then "lose" the completion.
    const nonce = `0x${"ab".repeat(32)}` as Hex;
    services.db
      .prepare("UPDATE topups SET status = 'crediting', credit_amount = '4000000', credit_nonce = ? WHERE quote_id = ?")
      .run(nonce, id);
    const before = await ausd(bob.address);
    await services.treasury.pay(bob.address, 4_000_000n, "test.crash", nonce);
    expect(await ausd(bob.address)).toBe(before + 4_000_000n);
    expect((await status(bob, id)).body.status).toBe("completed");
    expect(await ausd(bob.address)).toBe(before + 4_000_000n);
  });

  it("refunded top-ups credit nothing; status is owner-only", async () => {
    const id = await quote(alice, 6_000_000n);
    provider.setOutcome(id, "refunded");
    provider.simulateDeposit(id);
    const before = await ausd(alice.address);
    expect((await status(alice, id)).body.status).toBe("refunded");
    expect(await ausd(alice.address)).toBe(before);
    expect((await status(bob, id)).status).toBe(404);
  });
});

describe("top-up delivered on another network (live provider on a testnet server)", () => {
  /** Same database, treasury and credit chain; deliveries are read from `remote` instead. */
  const crossNetwork = () =>
    new TopUpService(
      services.db,
      { ...config, topup: { ...config.topup, delivery: { chainId: 143, rpcUrl: remote.rpcUrl, usdc: remoteUsdc }, crossNetwork: true } },
      services.chain,
      provider,
      services.treasury,
      services.activity,
      createPublicClient({ chain: { ...monad, rpcUrls: { default: { http: [remote.rpcUrl] } } }, transport: http(remote.rpcUrl) }),
    );

  it("credits test dollars once for USDC seen arriving on the delivery network, from the keeper path", async () => {
    const topups = crossNetwork();
    const q = await topups.quote(alice.address, "arb:usdc", 5_000_000n);
    expect(provider.lastQuote).toMatchObject({ recipient: treasury, refundTo: alice.address, originAsset: "arb:usdc" });
    provider.simulateDeposit(q.quoteId);
    // A USDC transfer on the credit chain is not a delivery on the delivery network.
    provider.deliveries.set(q.quoteId, [await deliver(5_000_000n)]);
    const before = await ausd(alice.address);
    await topups.settlePending();
    expect(await ausd(alice.address)).toBe(before);

    provider.deliveries.set(q.quoteId, [await deliverRemote(4_988_323n)]);
    await topups.settlePending(); // what the Worker's alarm runs via keeper.tick()
    await topups.settlePending();
    expect(await ausd(alice.address)).toBe(before + 4_988_323n);
    expect((await topups.status(alice.address, q.quoteId)).status).toBe("completed");
    expect(await ausd(alice.address)).toBe(before + 4_988_323n);
  });

  it("keeps each top-up small while real money is credited as test dollars", async () => {
    await expect(crossNetwork().quote(alice.address, "base:usdc", 25_000_001n)).rejects.toMatchObject({ status: 400 });
  });

  it("ignores delivery references that aren't transaction ids on that network", async () => {
    const topups = crossNetwork();
    const q = await topups.quote(bob.address, "base:usdc", 2_000_000n);
    provider.simulateDeposit(q.quoteId);
    provider.deliveries.set(q.quoteId, ["not-a-hash" as Hex, `0x${"12".repeat(32)}` as Hex]);
    const before = await ausd(bob.address);
    expect((await topups.status(bob.address, q.quoteId)).status).toBe("processing");
    expect(await ausd(bob.address)).toBe(before);
  });
});

describe("top-up config", () => {
  const base = {
    RELAYER_PRIVATE_KEY: ANVIL_KEYS[1],
    VERIFIER_PRIVATE_KEY: ANVIL_KEYS[2],
    TREASURY_PRIVATE_KEY: ANVIL_KEYS[0],
    PHONE_PEPPER: "p",
    TOKEN_SECRET: `0x${"55".repeat(32)}`,
    GIFT_CODE_KEY: `0x${"66".repeat(32)}`,
    AUSD_ADDRESS: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    STATA_ADDRESS: "0x9e1AcC5BFbf34e2E579763cE14042d957719fE76",
    DIRECTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
    ESCROW_ADDRESS: "0x0000000000000000000000000000000000000002",
    ROUTER_ADDRESS: "0x0000000000000000000000000000000000000003",
    DATABASE_PATH: ":memory:",
  };

  it("a testnet server with a live provider verifies deliveries on Monad mainnet", () => {
    const c = loadConfig({ ...base, CHAIN_ID: "10143", RPC_URL: "https://testnet.example", USDC_ADDRESS: "0x51C923016b405518A356d95eCBEfDA27CabCD538", TOPUP_PROVIDER: "oneclick" });
    expect(c.topup.provider).toBe("oneclick");
    expect(c.topup.env.TOPUP_PROVIDER).toBe("oneclick");
    expect(c.topup.delivery).toEqual({ chainId: 143, rpcUrl: "https://rpc.monad.xyz,https://rpc1.monad.xyz", usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" });
    expect(c.topup.crossNetwork).toBe(true);
  });

  it("mock top-ups on testnet stay on the testnet", () => {
    const c = loadConfig({ ...base, CHAIN_ID: "10143", RPC_URL: "https://testnet.example", USDC_ADDRESS: "0x51C923016b405518A356d95eCBEfDA27CabCD538" });
    expect(c.topup.provider).toBe("mock");
    expect(c.topup.delivery).toMatchObject({ chainId: 10143, rpcUrl: "https://testnet.example" });
  });

  it("refuses the cross-network delivery settings on mainnet", () => {
    expect(() => loadConfig({ ...base, CHAIN_ID: "143", TOPUP_PROVIDER: "oneclick", TOPUP_DELIVERY_RPC_URL: "https://rpc.monad.xyz" })).toThrow(/testnet-only/);
    const c = loadConfig({ ...base, CHAIN_ID: "143", RPC_URL: "https://mainnet.example", TOPUP_PROVIDER: "oneclick" });
    expect(c.topup.delivery).toMatchObject({ chainId: 143, rpcUrl: "https://mainnet.example" });
  });
});
