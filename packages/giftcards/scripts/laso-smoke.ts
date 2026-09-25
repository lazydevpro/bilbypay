/**
 * Buys ONE real gift card from Laso Finance with the Base USDC float. Real money (~$5.24 for $5).
 *
 *   CONFIRM_SPEND=yes LASO_PRIVATE_KEY=0x… BASE_RPC_URL=https://… pnpm --filter @bilbypay/giftcards smoke:laso
 *
 * Optional: SMOKE_QUERY (brand name to look for, default "starbucks"), SMOKE_COUNTRY (default US),
 * SMOKE_AMOUNT (USD, default 5), SMOKE_KEY (idempotency key, default laso-smoke-<UTC date>),
 * SMOKE_QUOTE_ONLY=yes (sign in, list, quote — stop before paying), LASO_BASE_URL.
 *
 * Idempotent: state lives in packages/giftcards/.smoke/store.json, so re-running with the same
 * SMOKE_KEY after a crash or timeout resumes the SAME payment instead of buying again.
 * The card's code/PIN/URL are written to .smoke/card-<key>.json (mode 0600), never printed.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { formatUsd, parseUsd } from "@bilbypay/core";
import { LasoProvider } from "../src/laso";
import type { IdempotencyStore } from "../src/types";

if (process.env.CONFIRM_SPEND !== "yes") {
  console.error("Refusing to run: this buys a REAL gift card with real USDC. Set CONFIRM_SPEND=yes to proceed.");
  process.exit(1);
}
const key = process.env.LASO_PRIVATE_KEY?.trim();
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("LASO_PRIVATE_KEY (0x + 64 hex) is required.");
  process.exit(1);
}
if (!process.env.BASE_RPC_URL) {
  console.error("BASE_RPC_URL is required (float balance + settlement checks).");
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".smoke");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const storePath = join(dir, "store.json");

/** Tiny durable store: whole-file JSON, written synchronously, owner-only permissions. */
class FileStore implements IdempotencyStore {
  private read(): Record<string, unknown> {
    return existsSync(storePath) ? (JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>) : {};
  }
  async get(k: string) {
    return this.read()[k];
  }
  async set(k: string, v: unknown) {
    const all = this.read();
    all[k] = v;
    writeFileSync(storePath, JSON.stringify(all, null, 2), { mode: 0o600 });
    chmodSync(storePath, 0o600);
  }
}

const account = privateKeyToAccount(key as `0x${string}`);
const laso = new LasoProvider({
  account,
  baseUrl: process.env.LASO_BASE_URL || undefined,
  rpcUrl: process.env.BASE_RPC_URL,
  store: new FileStore(),
});

const query = (process.env.SMOKE_QUERY ?? "starbucks").toLowerCase();
const country = (process.env.SMOKE_COUNTRY ?? "US").toUpperCase();
const amount = parseUsd(process.env.SMOKE_AMOUNT ?? "5");
const idempotencyKey = process.env.SMOKE_KEY ?? `laso-smoke-${new Date().toISOString().slice(0, 10)}`;

console.log(`Float wallet ${account.address}`);
const float = await laso.floatAvailable();
console.log(`Float balance: ${formatUsd(float)} USDC on Base`);

const brands = await laso.catalog(country);
console.log(`Catalog (${country}, USD): ${brands.length} brands`);
const brand = brands.find((b) => b.name.toLowerCase().includes(query) || b.id.startsWith(`${query}:`));
if (!brand) {
  console.error(`No brand matching "${query}". First few: ${brands.slice(0, 15).map((b) => b.id).join(", ")}`);
  process.exit(1);
}
console.log(`Brand: ${brand.name} (${brand.id}) ${formatUsd(brand.minAmount)}–${formatUsd(brand.maxAmount)}`);

const quote = await laso.quote(brand.id, amount);
console.log(`Quote: ${formatUsd(amount)} card costs ${formatUsd(quote.price)} USDC`);
if (quote.price > float) {
  console.error("Float is too low for this card.");
  process.exit(1);
}
if (process.env.SMOKE_QUOTE_ONLY === "yes") {
  console.log("SMOKE_QUOTE_ONLY=yes — stopping before payment.");
  process.exit(0);
}

console.log(`Purchasing with idempotency key "${idempotencyKey}"…`);
let result = await laso.purchase({ brandId: brand.id, amount, idempotencyKey, quote });
for (let i = 0; i < 5 && result.status === "pending"; i++) {
  console.log(`Pending (${result.failureReason ?? "no detail"}); retrying the same payment in 5s…`);
  await new Promise((r) => setTimeout(r, 5000));
  result = await laso.getPurchase(result.providerOrderId);
}

console.log(`Status: ${result.status}  providerOrderId: ${result.providerOrderId}`);
if (result.failureReason) console.log(`Reason: ${result.failureReason}`);
if (result.redemption) {
  const out = join(dir, `card-${idempotencyKey.replace(/[^\w.-]/g, "_")}.json`);
  writeFileSync(out, JSON.stringify(result, null, 2), { mode: 0o600 });
  const fields = Object.keys(result.redemption).filter((k) => (result.redemption as Record<string, unknown>)[k]);
  console.log(`Redemption fields present: ${fields.join(", ")}. Saved (owner-only) to ${out} — not printed.`);
}
console.log(`Float after: ${formatUsd(await laso.floatAvailable())} USDC`);
