/**
 * End-to-end smoke test against a running API (testnet or local), using the mobile app's own HTTP
 * client, pre-authorization guard and authorize flow — every money movement is a real transaction.
 * Needs the API in demo mode (scripts/testnet-up.sh: test SMS codes, faucet, mock gift cards/top-ups).
 *
 *   API_URL=http://localhost:8787 pnpm --filter @bilbypay/server e2e:smoke
 */
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { createHttpApi } from "../../app/src/api/http";
import type { ActionRequest, BilbyApi, Hex, Receipt } from "../../app/src/api/types";
import { authorizeAndSubmit } from "../../app/src/flows/authorize";
import { registerMessage } from "../../app/src/signing/messages";

const API_URL = (process.env.API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const usd = (base: string | bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const phone = () => `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
let chainId = 0;
const txs: string[] = [];

function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(`✗ ${what}`);
  console.log(`✓ ${what}`);
}

function note(r?: Receipt) {
  if (r?.technical) txs.push(`${r.reference}  ${r.technical.explorerUrl}`);
}

class Person {
  readonly account: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());
  readonly phone = phone();
  token: string | null = null;
  phoneToken = "";
  readonly api: BilbyApi = createHttpApi({ baseUrl: API_URL, getToken: () => this.token, timeoutMs: 60_000 });
  constructor(readonly name: string) {}

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
    this.token = (await this.api.register({ phoneToken: v.phoneToken, address: this.account.address, displayName: this.name, issuedAt, signature })).sessionToken;
    return this;
  }

  async act(request: ActionRequest, resolvedPayee?: Hex) {
    const prepared = await this.api.prepareAction(request);
    const { result } = await authorizeAndSubmit({
      api: this.api,
      request,
      prepared,
      account: this.account.address,
      chainId,
      resolvedPayee,
      unlock: (fn) => fn(this.account),
    });
    if (result.status === "failed") throw new Error(`${request.type} failed: ${result.error?.message}`);
    note(result.receipt);
    return { prepared, result };
  }

  async faucet(amount: bigint) {
    const res = await fetch(`${API_URL}/v1/dev/faucet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ amount: amount.toString() }),
    });
    if (!res.ok) throw new Error(`faucet: ${res.status} ${await res.text()}`);
  }

  balance() {
    return this.api.balance();
  }
}

async function main() {
  const health = (await (await fetch(`${API_URL}/health`)).json()) as { chainId: number; devFaucet?: boolean; block: number };
  chainId = health.chainId;
  check(health.devFaucet, `API on chain ${chainId} (block ${health.block}) is in demo mode`);

  const alice = await new Person("Alice").onboard();
  const bob = await new Person("Bob").onboard();
  check(alice.token && bob.token, "Alice and Bob verified their numbers and linked passkey accounts");

  await alice.faucet(200_000_000n);
  check((await alice.balance()).balance === "200000000", "Alice got $200 test money");

  const [r] = (await alice.api.resolve([bob.phone], "US")).results;
  const sent = await alice.act({ type: "send", params: { phone: bob.phone, amount: "20000000", note: "lunch" } }, r!.address);
  check(sent.result.status === "completed" && (await bob.balance()).balance === "20000000", "Alice → Bob $20 to a phone number, settled");

  const carol = new Person("Carol");
  const invite = await alice.act({ type: "send", params: { phone: carol.phone, amount: "15000000" } });
  check(invite.result.status === "waiting" && invite.result.claimLink, `Alice → Carol (not on BilbyPay yet) $15 waits for her: ${invite.result.claimLink}`);
  await carol.onboard();
  const code = invite.result.claimLink!.split("/c/")[1]!;
  const opened = await carol.api.acceptClaim(code, { phoneToken: carol.phoneToken });
  note(opened.receipt);
  check(opened.status === "completed" && (await carol.balance()).balance === "15000000", "Carol joined, opened the link and got $15");

  await alice.act({ type: "burrow_add", params: { amount: "100000000" } });
  const b1 = await alice.balance();
  check(BigInt(b1.burrow.amount) >= 99_000_000n, `Alice put $100 in Burrow (balance ${usd(b1.balance)})`);

  const big = BigInt(b1.balance) + 30_000_000n;
  const breakPay = await alice.act({ type: "send", params: { phone: bob.phone, amount: big.toString() } }, r!.address);
  check(BigInt(breakPay.prepared.summary.fromBurrow) === 30_000_000n && breakPay.result.status === "completed",
    `Alice paid ${usd(big)} with ${usd(b1.balance)} in balance: $30 came out of Burrow in the same payment`);

  const { brands } = await alice.api.catalog("US");
  const brand = brands.find((b) => b.available && !b.denominations) ?? brands.find((b) => b.available)!;
  const giftAmount = brand.denominations?.[0] ?? "10000000";
  await alice.faucet(50_000_000n);
  const gift = await alice.act({ type: "gift_buy", params: { brandId: brand.id, amount: giftAmount } });
  const card = await alice.api.revealGiftCard(gift.result.giftCardId!);
  check(card.code, `Alice bought a ${usd(giftAmount)} ${brand.name} card (mock provider) and can see its code`);

  const before = BigInt((await bob.balance()).balance);
  const origins = (await bob.api.topupOrigins()).origins;
  const quote = await bob.api.topupQuote(origins[0]!.id, "25000000");
  console.log(`  Bob's top-up: send ${usd(quote.amountIn)} ${origins[0]!.label} to ${quote.depositAddress} (demo delivers by itself)`);
  let status = await bob.api.topupStatus(quote.quoteId);
  for (let i = 0; i < 40 && status.status !== "completed"; i++) {
    await sleep(1_500);
    status = await bob.api.topupStatus(quote.quoteId);
  }
  const after = BigInt((await bob.balance()).balance);
  check(status.status === "completed" && after - before === BigInt(status.amountOut!),
    `Bob added ${usd(status.amountOut!)} from another network: USDC reached the treasury, Bob got AUSD`);

  const feed = await alice.api.activity();
  check(feed.items.length >= 5, `Alice's activity shows ${feed.items.length} items`);

  console.log("\nAll good. Receipts:");
  for (const t of txs) console.log(`  ${t}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
