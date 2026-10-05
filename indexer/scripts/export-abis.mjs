// Writes the event-only ABI JSON files Envio reads (indexer/abis/*.json) from the generated
// contract ABIs in packages/core/src/abis.ts. Run after `contracts/script/export-abis.mjs`.
// Node 22.18+ strips the TypeScript syntax of abis.ts natively (it is only `as const`).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const abis = await import(join(here, "../../packages/core/src/abis.ts"));

const eventsOnly = (abi, names) =>
  abi.filter((item) => item.type === "event" && (!names || names.includes(item.name)));

const outputs = {
  "BilbyDirectory.json": eventsOnly(abis.bilbyDirectoryAbi, ["Bound", "Unbound", "BindingUpdated", "RecoveryRequested", "RecoveryCancelled", "RecoveryFinalized"]),
  "BilbyEscrow.json": eventsOnly(abis.bilbyEscrowAbi, ["Deposited", "Claimed", "Refunded", "Cancelled"]),
  "BilbyRouter.json": eventsOnly(abis.bilbyRouterAbi, ["AutoSaveSet", "Swept", "Broken", "Added"]),
  // ERC-20 Transfer + ERC-4626 Deposit/Withdraw, matched on AUSD and stataAUSD for BilbyPay accounts.
  "AccountTokenEvents.json": eventsOnly(abis.erc4626Abi, ["Transfer", "Deposit", "Withdraw"]),
};

for (const [file, abi] of Object.entries(outputs)) {
  writeFileSync(join(here, "../abis", file), JSON.stringify(abi, null, 2) + "\n");
  console.log(`wrote indexer/abis/${file} (${abi.length} events)`);
}
