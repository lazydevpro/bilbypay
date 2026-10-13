// Validates the indexer ABIs against real Monad testnet v2 logs without Docker or HyperSync:
// fetches receipts for the given tx hashes over RPC and decodes every log the indexer would see
// (BilbyDirectory / BilbyEscrow / BilbyRouter by address; Transfer / Deposit / Withdraw on the
// test AUSD and stataAUSD). Usage: node scripts/check-testnet-events.mjs <file-of-tx-hashes>
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEventLog, toEventSelector } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const rpc = process.env.ENVIO_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
const abi = (f) => JSON.parse(readFileSync(join(here, "../abis", f), "utf8"));
const sources = {
  "0x6ce6a93600d389247971dd2b0f65ff07febe6219": ["BilbyDirectory", abi("BilbyDirectory.json")],
  "0x65cf95ba67831b6a75a58eeb91bd99289a25eaaa": ["BilbyEscrow", abi("BilbyEscrow.json")],
  "0xec93d63127b20b2116d38e176448b515880aabd9": ["BilbyRouter", abi("BilbyRouter.json")],
  "0x281e5e2ffe4f6eeb887a0fe82e9859a7656ad300": ["AUSD", abi("AccountTokenEvents.json")],
  "0xe589463d6ec1e05681dc4a4da209ef9beecc2ed7": ["stataAUSD", abi("AccountTokenEvents.json")],
};
const call = async (method, params) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const json = await res.json().catch(() => ({}));
    if (json.result !== undefined) return json.result;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(`${method} failed`);
};

const hashes = readFileSync(process.argv[2], "utf8").split(/\s+/).filter((h) => /^0x[0-9a-f]{64}$/i.test(h));
const counts = {};
const unknown = {};
let blocks = [Infinity, 0];
for (const hash of hashes) {
  const receipt = await call("eth_getTransactionReceipt", [hash]);
  if (!receipt) continue;
  const block = Number(receipt.blockNumber);
  for (const log of receipt.logs) {
    const src = sources[log.address.toLowerCase()];
    if (!src) continue;
    const [name, contractAbi] = src;
    const indexed = contractAbi.some((e) => toEventSelector(e) === log.topics[0]);
    if (!indexed) { unknown[`${name}:${log.topics[0].slice(0, 10)}`] = (unknown[`${name}:${log.topics[0].slice(0, 10)}`] ?? 0) + 1; continue; }
    const decoded = decodeEventLog({ abi: contractAbi, data: log.data, topics: log.topics });
    const key = `${name}.${decoded.eventName}`;
    counts[key] = (counts[key] ?? 0) + 1;
    blocks = [Math.min(blocks[0], block), Math.max(blocks[1], block)];
  }
}
console.log(JSON.stringify({ txs: hashes.length, blocks, decoded: counts, notIndexed: unknown }, null, 2));
