/**
 * Manual smoke test against the real Aurora Intents / 1Click API. Moves no funds.
 *
 *   pnpm --filter @bilbypay/topup smoke:quote
 *
 * Env:
 *   TOPUP_PROVIDER     aurora (default when INTENTS_API_KEY is set) | oneclick (default otherwise)
 *   INTENTS_API_KEY    Aurora Studio key, or 1Click JWT
 *   INTENTS_BASE_URL   optional override
 *   TOPUP_DESTINATION  usdc (default) | ausd | raw asset id
 *   SMOKE_ORIGIN       default base:usdc
 *   SMOKE_AMOUNT       dollars, default 5
 *   SMOKE_RECIPIENT    Monad address, default 0x…01 (fine for dry quotes)
 *   SMOKE_LIVE=1       also request a LIVE quote (creates a real deposit address; still moves nothing
 *                      unless someone sends money to it)
 *   SMOKE_STATUS=<quoteId|depositAddress>  just poll status for an existing top-up and exit
 */
import { formatUsd, parseUsd } from "@bilbypay/core";
import { IntentsTopUpProvider, MONAD_DESTINATIONS, TopUpError, type IntentsBackend } from "../src";

const env = process.env;
const backend = (env.TOPUP_PROVIDER ?? (env.INTENTS_API_KEY ? "aurora" : "oneclick")) as IntentsBackend;
const provider = new IntentsTopUpProvider({
  backend,
  apiKey: env.INTENTS_API_KEY,
  baseUrl: env.INTENTS_BASE_URL || undefined,
  destination: env.TOPUP_DESTINATION || undefined,
  logger: (level, msg, details) => console.error(`[${level}] ${msg}`, JSON.stringify(details, null, 2)),
});
const recipient = (env.SMOKE_RECIPIENT ?? "0x0000000000000000000000000000000000000001") as `0x${string}`;
const origin = env.SMOKE_ORIGIN ?? "base:usdc";
const amount = parseUsd(env.SMOKE_AMOUNT ?? "5");

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

async function main() {
  console.log(`backend=${provider.backend} (${provider.name}) destination=${provider.destination}`);

  if (env.SMOKE_STATUS) {
    const s = await provider.status(env.SMOKE_STATUS);
    console.log(json({ ...s, raw: undefined }));
    console.log("raw:", json(s.raw));
    return;
  }

  // 1. Catalogue: is our destination (and AUSD) listed?
  try {
    const tokens = await provider.listTokens();
    const monad = tokens.filter((t) => t.blockchain === "monad");
    console.log(`\n${tokens.length} assets listed; Monad:`);
    for (const t of monad) console.log(`  ${t.symbol}\t${t.decimals}\t${t.assetId}`);
    console.log(`destination listed: ${tokens.some((t) => t.assetId === provider.destination)}`);
    console.log(`AUSD (${MONAD_DESTINATIONS.ausd.assetId}) listed: ${tokens.some((t) => t.assetId === MONAD_DESTINATIONS.ausd.assetId)}`);
    const ausdAnywhere = tokens.filter((t) => t.symbol?.toUpperCase() === "AUSD");
    if (ausdAnywhere.length) console.log("AUSD entries:", json(ausdAnywhere.map((t) => t.raw)));
  } catch (err) {
    console.error("token list failed:", describe(err));
  }

  // 2. Dry quote.
  const dry = await provider.quote({ originAsset: origin, amount, recipient, dry: true });
  console.log(`\nDRY ${origin} ${formatUsd(amount)} → ${formatUsd(dry.amountOut)} (min ${formatUsd(dry.minAmountOut)}), eta ${dry.etaSeconds}s`);
  console.log("raw:", json(dry.raw));

  // 3. Optional live quote (real deposit address).
  if (env.SMOKE_LIVE === "1") {
    const live = await provider.quote({ originAsset: origin, amount, recipient, refundTo: env.SMOKE_REFUND_TO });
    console.log(`\nLIVE quoteId=${live.quoteId}`);
    console.log(`Send exactly ${live.amountInBaseUnits} base units of ${origin} to ${live.depositAddress}${live.depositMemo ? ` memo ${live.depositMemo}` : ""}`);
    console.log(`before ${live.expiresAt}. Expect ~${formatUsd(live.amountOut)} at ${recipient} on Monad.`);
    console.log(`Then: SMOKE_STATUS=${live.quoteId} pnpm --filter @bilbypay/topup smoke:quote`);
    console.log("raw (keep this, it contains the provider signature):", json(live.raw));
  }
}

function describe(err: unknown) {
  return err instanceof TopUpError ? `${err.code} (${err.httpStatus ?? "-"}) ${err.message} ${json(err.raw)}` : String(err);
}

main().catch((err) => {
  console.error("smoke failed:", describe(err));
  process.exit(1);
});
