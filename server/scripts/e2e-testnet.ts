/**
 * End-to-end run of every BilbyPay flow against a server on Monad testnet, using the mobile app's own HTTP
 * client, pre-signing guard and authorize flow (app/src/api/http.ts, app/src/flows/authorize.ts).
 * Each "phone" holds its key client-side, exactly like the app after the passkey unlock.
 *
 *   pnpm --filter @bilbypay/server e2e:testnet                 # all flows (server must be running on 10143)
 *   pnpm --filter @bilbypay/server e2e:testnet --check-refund  # later: confirm the unopened send was refunded
 *
 * Env: E2E_API_URL (default http://localhost:8787), RPC_URL, RELAYER_PRIVATE_KEY (mints test dollars; testnet only).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mockAusdAbi } from "@bilbypay/core";
import { type Address, createPublicClient, createWalletClient, type Hex, http } from "viem";
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { createHttpApi } from "../../app/src/api/http";
import type { ActionRequest, BilbyApi } from "../../app/src/api/types";
import { authorizeAndSubmit } from "../../app/src/flows/authorize";
import { registerMessage, sessionMessage } from "../../app/src/signing/messages";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = resolve(ROOT, "data/e2e-testnet-state.json");
const API = process.env.E2E_API_URL ?? "http://localhost:8787";
const RPC = process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz";
const CHAIN_ID = 10143;
const USD = 1_000_000n;
const usd = (units: bigint | string) => `$${(Number(BigInt(units)) / 1e6).toFixed(2)}`;

const chain = { ...monadTestnet, rpcUrls: { default: { http: [RPC] } } };
const publicClient = createPublicClient({ chain, transport: http(RPC) });

/** A random +1 555 number so reruns never collide (OTP test mode accepts 000000). */
const testNumber = () => `+1 555 ${String(Math.floor(Math.random() * 1e7)).padStart(7, "0").replace(/(\d{3})(\d{4})/, "$1 $2")}`;

class Phone {
  readonly account: PrivateKeyAccount;
  token: string | null = null;
  phoneToken = "";
  readonly api: BilbyApi;
  constructor(readonly name: string, readonly phone = testNumber(), readonly key: Hex = generatePrivateKey()) {
    this.account = privateKeyToAccount(key);
    this.api = createHttpApi({ baseUrl: API, getToken: () => this.token, fetch });
  }
  get address(): Address {
    return this.account.address;
  }
  async verify() {
    await this.api.otpStart(this.phone, "US");
    const v = await this.api.otpVerify(this.phone, "000000");
    this.phoneToken = v.phoneToken;
    return v;
  }
  async onboard() {
    const v = await this.verify();
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await this.account.signMessage({ message: registerMessage(v.phone, this.address, issuedAt) });
    const res = await this.api.register({ phoneToken: v.phoneToken, address: this.address, displayName: this.name, issuedAt, signature });
    this.token = res.sessionToken;
    return res;
  }
  async signIn() {
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await this.account.signMessage({ message: sessionMessage(this.address, issuedAt) });
    const res = await this.api.session({ address: this.address, issuedAt, signature });
    this.token = res.sessionToken;
    return res;
  }
  /** The app's confirm path: prepare → guard → one unlock → sign all → submit. */
  async act(request: ActionRequest, resolvedPayee?: Hex) {
    const prepared = await this.api.prepareAction(request);
    const t0 = Date.now();
    const { result } = await authorizeAndSubmit({
      api: this.api,
      request,
      prepared,
      account: this.address,
      chainId: CHAIN_ID,
      resolvedPayee,
      unlock: (fn) => fn(this.account),
    });
    return { prepared, result, ms: Date.now() - t0 };
  }
  async balance() {
    return this.api.balance();
  }
  async mon() {
    return publicClient.getBalance({ address: this.address });
  }
}

// ---------------------------------------------------------------- tiny test runner

type Row = { step: string; ok: boolean; detail: string };
const rows: Row[] = [];
const txs: string[] = [];
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
async function step(name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try {
    const detail = (await fn()) ?? "";
    rows.push({ step: name, ok: true, detail: `${detail} (${Date.now() - t0} ms)` });
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    const detail = e instanceof Error ? `${(e as any).code ? `${(e as any).code}: ` : ""}${e.message}` : String(e);
    rows.push({ step: name, ok: false, detail });
    console.log(`❌ ${name} — ${detail}`);
  }
}
const txOf = (r: any): Hex | undefined => r?.receipt?.technical?.txHash;
const note = (r: any) => {
  const h = txOf(r);
  if (h) txs.push(h);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs: number, what: string): Promise<T> {
  const end = Date.now() + timeoutMs;
  let v = await fn();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
    v = await fn();
  }
  return v;
}

async function mint(to: Address, amount: bigint, ausd: Address) {
  const key = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  check(key, "RELAYER_PRIVATE_KEY is needed to mint test dollars");
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(RPC) });
  const hash = await wallet.writeContract({ address: ausd, abi: mockAusdAbi, functionName: "mint", args: [to, amount] });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ---------------------------------------------------------------- flows

async function main() {
  const health = await (await fetch(`${API}/health`)).json();
  check(health.chainId === CHAIN_ID, `server is on chain ${health.chainId}, expected ${CHAIN_ID}`);
  const deployment = JSON.parse(readFileSync(resolve(ROOT, "../contracts/deployments/10143.json"), "utf8"));
  console.log(`Server ${API} on Monad testnet · block ${health.block}\n`);

  const alice = new Phone("Alice");
  const bob = new Phone("Bob");
  const carol = new Phone("Carol"); // not signed up when money is sent
  const dave = new Phone("Dave"); // not signed up when a gift is sent
  const refundee = testNumber(); // never signs up → refund after expiry

  await step("1. Onboard Alice and Bob (number check → passkey signature → on-chain binding)", async () => {
    await alice.onboard();
    await bob.onboard();
    const me = await alice.api.me();
    check(me.phone === alice.phone.replace(/\s/g, ""), `me.phone ${me.phone}`);
    return `Alice ${alice.phone}, Bob ${bob.phone}`;
  });

  await step("2. Sign in again with the same key (stateless re-login)", async () => {
    const res = await alice.signIn();
    check(res.profile?.displayName === "Alice", "profile not restored");
  });

  await step("3. Add money (top-up, mock provider) → balance credited", async () => {
    const { origins } = await alice.api.topupOrigins();
    check(origins.length > 0, "no top-up origins");
    const q = await alice.api.topupQuote(origins[0]!.id, String(25n * USD));
    const done = await until(() => alice.api.topupStatus(q.quoteId), (s) => ["completed", "failed", "refunded"].includes(s.status), 60_000, "top-up");
    check(done.status === "completed", `top-up ${done.status}: ${done.message}`);
    const bal = await until(() => alice.balance(), (b) => BigInt(b.balance) > 0n, 30_000, "balance credit");
    return `balance ${usd(bal.balance)} via ${origins[0]!.id}`;
  });

  await step("4. Top up Alice with more test dollars (testnet mint)", async () => {
    txs.push(await mint(alice.address, 500n * USD, deployment.ausd));
    const b = await until(() => alice.balance(), (x) => BigInt(x.balance) >= 500n * USD, 20_000, "mint");
    return `balance ${usd(b.balance)}`;
  });

  await step("5. Send $20 to Bob (registered) — one confirmation, gasless", async () => {
    const [r] = (await alice.api.resolve([bob.phone], "US")).results;
    check(r?.status === "registered", `resolve: ${r?.status}`);
    const { result, ms } = await alice.act({ type: "send", params: { phone: bob.phone, amount: String(20n * USD), note: "lunch" } }, r!.address);
    note(result);
    check(result.status === "completed", `status ${result.status}`);
    const b = await bob.balance();
    check(BigInt(b.balance) === 20n * USD, `Bob has ${usd(b.balance)}`);
    return `completed in ${ms} ms, Bob ${usd(b.balance)}`;
  });

  let carolCode = "";
  await step("6. Send $15 to Carol (not signed up) → waits for her, claim link", async () => {
    const { result } = await alice.act({ type: "send", params: { phone: carol.phone, amount: String(15n * USD) } });
    note(result);
    check(result.status === "waiting", `status ${result.status}`);
    carolCode = result.claimLink!.split("/c/")[1]!;
    const page = await fetch(`${API}/c/${carolCode}`);
    check(page.ok, `share page ${page.status}`);
    return `link ${result.claimLink}`;
  });

  await step("7. Carol opens the link on her phone, signs up, money lands", async () => {
    const claim = await carol.api.claim(carolCode);
    check(claim.kind === "money" && claim.status === "waiting", JSON.stringify(claim));
    await carol.onboard();
    const accepted = await carol.api.acceptClaim(carolCode, { phoneToken: carol.phoneToken });
    note(accepted);
    check(accepted.status === "completed", `accept ${accepted.status}`);
    const b = await carol.balance();
    check(BigInt(b.balance) === 15n * USD, `Carol has ${usd(b.balance)}`);
    return `Carol ${usd(b.balance)}`;
  });

  await step("8. Alice sees Carol's send as opened", async () => {
    const items = (await alice.api.activity()).items;
    check(items.length > 0, "no activity");
    const opened = items.find((i: any) => i.kind === "sent" && i.amount === String(15n * USD));
    check(opened?.status === "completed", `Carol's send shows ${opened?.status}`);
    return `${items.length} activity items; Carol's send: ${opened.status}`;
  });

  await step("9. Take back an unopened send", async () => {
    const { result } = await alice.act({ type: "send", params: { phone: testNumber(), amount: String(5n * USD) } });
    note(result);
    check(result.status === "waiting", `send ${result.status}`);
    const item = (await alice.api.activity()).items.find((i: any) => i.canCancel);
    check(item, "no cancellable item");
    const { result: c } = await alice.act({ type: "cancel", params: { activityId: item.id } });
    note(c);
    check(c.status === "completed", `cancel ${c.status}`);
  });

  let refundActivityId = "";
  await step("10. Send $3 to a number that never signs up (refund checked after expiry)", async () => {
    const { result } = await alice.act({ type: "send", params: { phone: refundee, amount: String(3n * USD) } });
    note(result);
    check(result.status === "waiting", `status ${result.status}`);
    refundActivityId = (await alice.api.activity()).items.find((i: any) => i.canCancel)?.id ?? "";
    return `expires in ~1 h; run --check-refund afterwards`;
  });

  await step("11. Burrow: add $100", async () => {
    const { result } = await alice.act({ type: "burrow_add", params: { amount: String(100n * USD) } });
    note(result);
    check(result.status === "completed", `status ${result.status}`);
    const b = await alice.balance();
    check(BigInt(b.burrow.amount) >= 99n * USD, `Burrow ${usd(b.burrow.amount)}`);
    return `Burrow ${usd(b.burrow.amount)}, rate ${b.burrow.ratePercent}%`;
  });

  await step("12. Burrow auto-save: keep $50, rest tucked away automatically (keeper)", async () => {
    const { result } = await alice.act({ type: "burrow_autosave", params: { enabled: true, threshold: String(50n * USD) } });
    note(result);
    check(result.status === "completed", `status ${result.status}`);
    const b = await until(() => alice.balance(), (x) => BigInt(x.balance) <= 50n * USD, 60_000, "keeper sweep");
    check(BigInt(b.balance) === 50n * USD, `balance ${usd(b.balance)}`);
    return `balance ${usd(b.balance)}, Burrow ${usd(b.burrow.amount)}`;
  });

  await step("13. Money arriving above the threshold is swept too", async () => {
    await bob.act({ type: "send", params: { phone: alice.phone, amount: String(10n * USD) } }, alice.address).then(({ result }) => note(result));
    const b = await until(() => alice.balance(), (x) => BigInt(x.balance) === 50n * USD && BigInt(x.burrow.amount) > 0n, 60_000, "sweep of incoming money");
    return `balance back to ${usd(b.balance)}`;
  });

  await step("14. Pay $80 with $50 balance → \"Take $30 from Burrow?\" → ONE transaction", async () => {
    const [r] = (await alice.api.resolve([bob.phone], "US")).results;
    const before = await alice.balance();
    const { prepared, result } = await alice.act({ type: "send", params: { phone: bob.phone, amount: String(80n * USD) } }, r!.address);
    note(result);
    check(BigInt(prepared.summary.fromBurrow) === 30n * USD, `fromBurrow ${usd(prepared.summary.fromBurrow)}`);
    check(result.status === "completed", `status ${result.status}`);
    const hash = txOf(result);
    check(hash, "no tx hash in receipt");
    const tx = await publicClient.getTransaction({ hash });
    check(tx.to?.toLowerCase() === deployment.router.toLowerCase(), `tx went to ${tx.to}, expected the router (break + pay)`);
    const after = await alice.balance();
    return `balance ${usd(before.balance)} → ${usd(after.balance)}, Burrow ${usd(before.burrow.amount)} → ${usd(after.burrow.amount)}, 1 tx ${hash}`;
  });

  await step("15. Burrow: turn auto-save off, then move $10 to balance", async () => {
    const off = await alice.act({ type: "burrow_autosave", params: { enabled: false, threshold: "0" } });
    note(off.result);
    check(off.result.status === "completed", `off ${off.result.status}`);
    const w = await alice.act({ type: "burrow_withdraw", params: { amount: String(10n * USD) } });
    note(w.result);
    check(w.result.status === "completed", `withdraw ${w.result.status}`);
    await sleep(6000); // keeper must NOT sweep it back
    const b = await alice.balance();
    check(BigInt(b.balance) >= 10n * USD, `balance ${usd(b.balance)}`);
    return `balance ${usd(b.balance)} stays (auto-save off)`;
  });

  let brandId = "";
  await step("16. Gift card: buy for myself, reveal code in-app", async () => {
    const { brands } = await alice.api.catalog("US");
    const brand = brands.find((b: any) => b.available && !b.denominations) ?? brands.find((b: any) => b.available);
    check(brand, "no available brand");
    brandId = brand.id;
    const amount = brand.denominations?.[0] ?? String(10n * USD);
    const bought = await alice.act({ type: "gift_buy", params: { brandId: brand.id, amount } });
    note(bought.result);
    check(bought.result.status === "completed", `buy ${bought.result.status}`);
    const reveal = await alice.api.revealGiftCard(bought.result.giftCardId!);
    check(reveal.code, "no code");
    return `${brand.name} ${usd(amount)} revealed in ${bought.ms} ms`;
  });

  await step("17. Gift card to Dave (not signed up) → he opens it, picks a brand, card appears", async () => {
    const sent = await alice.act({ type: "gift_send", params: { phone: dave.phone, brandId: null, amount: String(10n * USD), message: "Happy birthday" } });
    note(sent.result);
    check(sent.result.status === "waiting", `send ${sent.result.status}`);
    const code = sent.result.claimLink!.split("/c/")[1]!;
    const claim = await dave.api.claim(code);
    check(claim.kind === "gift", `claim kind ${claim.kind}`);
    await dave.onboard();
    const opened = await dave.api.acceptClaim(code, { phoneToken: dave.phoneToken, brandId });
    note(opened);
    check(opened.status === "completed", `open ${opened.status}`);
    const { cards } = await dave.api.giftCards();
    check(cards.length === 1, `Dave has ${cards.length} cards`);
    const reveal = await dave.api.revealGiftCard(cards[0]!.id);
    check(reveal.code, "no code");
    return `Dave's card ready`;
  });

  await step("18. Only the owner can reveal a gift card", async () => {
    const { cards } = await dave.api.giftCards();
    try {
      await alice.api.revealGiftCard(cards[0]!.id);
    } catch (e: any) {
      return `Alice refused: ${e.code ?? e.message}`;
    }
    throw new Error("Alice could reveal Dave's card");
  });

  await step("19. Errors reach the app as plain language", async () => {
    try {
      await bob.api.prepareAction({ type: "burrow_withdraw", params: { amount: String(999n * USD) } });
    } catch (e: any) {
      check(e.message && !/revert|0x|gas|nonce/i.test(e.message), `message: ${e.message}`);
      return `${e.code}: "${e.message}"`;
    }
    throw new Error("expected an error");
  });

  await step("20. No user ever held or spent MON", async () => {
    const balances = await Promise.all([alice, bob, carol, dave].map((p) => p.mon()));
    const nonces = await Promise.all([alice, bob, carol, dave].map((p) => publicClient.getTransactionCount({ address: p.address })));
    check(balances.every((b) => b === 0n), `MON balances ${balances}`);
    check(nonces.every((n) => n === 0), `user nonces ${nonces} (users should never send transactions)`);
    return "4 users: 0 MON, 0 transactions sent";
  });

  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ at: new Date().toISOString(), alice: { phone: alice.phone, address: alice.address }, refundee, refundActivityId, txs }, null, 2),
  );
  // Keep Alice's key so --check-refund can sign in as her (testnet-only throwaway key, gitignored data/ dir).
  writeFileSync(STATE_FILE.replace(".json", ".key"), alice.key, { mode: 0o600 });
  report();
}

async function checkRefund() {
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  console.log(`Checking refund for the send to ${state.refundee} made at ${state.at}`);
  const key = readFileSync(STATE_FILE.replace(".json", ".key"), "utf8").trim() as Hex;
  const alice = new Phone("Alice", state.alice.phone, key);
  await alice.signIn();
  await step("21. Unopened send refunded to Alice after expiry (keeper)", async () => {
    const items = (await alice.api.activity()).items as any[];
    const item = items.find((i) => i.id === state.refundActivityId);
    check(item, "activity item not found");
    check(item.status === "refunded", `still ${item.status} (expires ${item.expiresAt})`);
    return `${item.status}`;
  });
  report();
}

function report() {
  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} flows passed on Monad testnet (chain ${CHAIN_ID}).`);
  if (txs.length) console.log(`Transactions: ${[...new Set(txs)].length} (first: ${txs[0]})`);
  const out = resolve(ROOT, "data/e2e-testnet-report.json");
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), api: API, rows, txs: [...new Set(txs)] }, null, 2));
  console.log(`Report: ${out}`);
  process.exitCode = failed.length ? 1 : 0;
}

(process.argv.includes("--check-refund") ? checkRefund() : main()).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
