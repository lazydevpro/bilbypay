# @bilbypay/topup

Lets a user add money to their BilbyPay balance on Monad from another network. For example, they
send $5 of USDC from Base and it arrives on Monad. It uses **Aurora Intents (powered by NEAR
Intents)**, specifically the **Swap API** (the 1Click protocol), with deposit addresses. This
package is for the Metropolis bounty "Bring Any-Chain Liquidity to Monad (Aurora Intents)"
(Phase 5 stretch).

The server wraps it as `POST /v1/topup/quote` and `GET /v1/topup/:quoteId` (see `docs/api.md`).

```ts
import { createTopUpProviderFromEnv, parseUsd } from "@bilbypay/topup"; // parseUsd from @bilbypay/core

const topup = createTopUpProviderFromEnv();          // aurora | oneclick | mock, from env
topup.supportedOrigins();                            // [{ id: "base:usdc", label: "USDC on Base", ... }, ...]
const q = await topup.quote({ originAsset: "base:usdc", amount: parseUsd("5"), recipient: userMonadAddress });
// q.depositAddress: the user sends q.amountInBaseUnits of USDC on Base here, before q.expiresAt
await topup.status(q.quoteId);                       // waiting → processing → completed | refunded | failed
await topup.submitDepositTx?.({ quoteId: q.quoteId, txHash }); // optional, speeds up detection
```

All dollar amounts are 6-decimal `bigint`, the same as `@bilbypay/core`.

## Providers

| class | what |
|---|---|
| `IntentsTopUpProvider` (alias `OneClickTopUpProvider`), `backend: "aurora"` | **Aurora Intents API** (default). Base URL `https://intents-api.aurora.dev`. The API key goes in the path. |
| same, `backend: "oneclick"` | **NEAR Intents 1Click API**, called directly. Base URL `https://1click.chaindefuser.com`. Optional `Authorization: Bearer <JWT>`. |
| `MockTopUpProvider` | In-memory. Moves `waiting → processing → completed` as time passes. `simulateDeposit()` and `setOutcome()` are for demos and tests. |

The two backends are wire-compatible. They take the same `QuoteRequest` body and return the same
`QuoteResponse` / status JSON. Aurora's backend is its hosted proxy in front of 1Click, and it is
what Aurora's own swap widget calls. Use `aurora` for the bounty demo. `oneclick` is a fallback
that talks to the same protocol.

### Endpoints and where each one comes from

Aurora Intents API. Source: `@aurora-is-near/intents-swap-widget@7.24.1` (npm). The files are
`src/network.ts`, `src/hooks/useMakeQuote.ts`, `src/hooks/useOneClickExecutionStatus.ts`,
`src/hooks/useMakeQuoteTransfer.ts` and `src/utils/feeServiceTokens.ts`.

| method | path | body / query |
|---|---|---|
| POST | `/api/quote/{apiKey}` | 1Click `QuoteRequest` → `QuoteResponse` |
| GET | `/api/status/{apiKey}?depositAddress=&depositMemo=` | → `GetExecutionStatusResponse` |
| POST | `/api/deposit/submit/{apiKey}` | `{ txHash, depositAddress }` |
| GET | `/api/tokens/{apiKey}` | → `{ asset_stats, tokens }` (the shape of the items in `tokens` is not pinned) |

Staging base: `https://staging-intents-api.aurora.dev`. Get the key from Widget Studio at
<https://studio.aurora.dev>. The widget README says the key "is not secret".

1Click. Source: `@defuse-protocol/one-click-sdk-typescript@0.1.26`. `dist/index.mjs` has
`OpenAPI.BASE` and the `OneClickService` methods. `dist/index.d.ts` has the types.

| method | path |
|---|---|
| GET | `/v0/tokens` |
| POST | `/v0/quote` (`dry: true` gives a preview without a deposit address) |
| GET | `/v0/status?depositAddress=&depositMemo=` |
| POST | `/v0/deposit/submit` `{ txHash, depositAddress, memo? }` |

The quote request we send is `swapType: EXACT_INPUT` (or `EXACT_OUTPUT` with `mode: "exactOut"`),
`depositType: ORIGIN_CHAIN`, `refundType: ORIGIN_CHAIN`, `recipientType: DESTINATION_CHAIN`,
`depositMode: SIMPLE` and `slippageTolerance` in bps. `deadline` is now + 1 hour, the same as the
Aurora widget.

Status mapping: `PENDING_DEPOSIT` and `INCOMPLETE_DEPOSIT` → `waiting`. `KNOWN_DEPOSIT_TX` and
`PROCESSING` → `processing`. `SUCCESS` → `completed`, `REFUNDED` → `refunded`, `FAILED` →
`failed`. Any unknown status → `processing`, and it is logged.

Error mapping (`TopUpError.code` + `userMessage`): the matched substrings are copied from the
widget's error handling. They are "Amount is too low…", "recipient is not valid", "Failed to get
a deposit address", "No quotes found" and "Application key not found". HTTP 401/403/404/429/5xx
are also mapped. User-facing strings follow the no-crypto copy rule, and a test enforces the
banned-word list. Raw provider bodies go only to `TopUpError.raw` and the `logger`, with the API
key redacted.

## Env vars

| var | default | |
|---|---|---|
| `TOPUP_PROVIDER` | `aurora` if `INTENTS_API_KEY` is set, else `mock` | `aurora` \| `oneclick` \| `mock` |
| `INTENTS_API_KEY` | – | Aurora Studio key (aurora) or 1Click JWT (oneclick, optional) |
| `INTENTS_BASE_URL` | per backend | e.g. the staging URL |
| `TOPUP_DESTINATION` | `usdc` | `usdc` \| `ausd` \| raw asset id |
| `TOPUP_SLIPPAGE_BPS` | `50` | |
| `TOPUP_REFERRAL` | – | 1Click `referral` |

## Asset ids

Monad (chain 143) **is supported** as a destination. It goes through HOT's omni bridge, so its
asset ids use the `nep245:v2_1.omni.hot.tg:143_<base58(token address)>` scheme, not the
`nep141:…omft.near` scheme that Base and Arbitrum use.

| asset | id | status |
|---|---|---|
| USDC on Monad `0x7547…b603` | `nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx` | **Verified listed**: in a `/v0/tokens` snapshot and in Aurora's own `apps/intents-connect-demo/src/aave/constants.ts` |
| USDT0 on Monad | `nep245:v2_1.omni.hot.tg:143_4EJiJxSALvGoTZbnc8K7Ft9533et` | verified listed (not used) |
| MON | `nep245:v2_1.omni.hot.tg:143_11111111111111111111` | verified (`@defuse-protocol/intents-sdk` hot-bridge-utils) |
| **AUSD on Monad** `0x0000…012a` | `nep245:v2_1.omni.hot.tg:143_1111Wd6DUHQcTT8PJELEThdiwB` | **Derived only, not seen listed.** AUSD was absent from the catalogue snapshot (no AUSD on any network). |

The `/v0/tokens` snapshot is `github.com/fastnear/explorer-frontend/res/1click_prices.json`
(141 assets, prices dated 2026-02-17). `hotOmniAssetId()` reproduces the listed USDC, USDT0 and
MON ids exactly, and a test checks this. The encoding is right; whether AUSD is *listed* is the
open question. Origin ids in `src/assets.ts` (USDC/USDT on Base, Arbitrum, Ethereum, Solana,
Optimism, Polygon, Avalanche, BNB, NEAR, Tron) are copied from the same snapshot.

### USDC lands, not AUSD

Right now the top-up delivers **USDC on Monad** to the user's address. BilbyPay balances are
AUSD. There are three ways to close the gap, best first:

1. **Intents Connect deposit-and-execute** (`@aurora-is-near/intents-connect`, also an Aurora
   Intents product and the bounty's "contract-level composability" bonus). USDC is bridged to a
   service intermediary on Monad. That intermediary runs a recipe that converts USDC to AUSD on a
   Monad venue and transfers the AUSD to the user, all in one flow. The recipe/step-builder API is
   in that package's README. It is not built here.
2. **Server converts after arrival.** Watch for `completed`, then have the user sign a
   `ReceiveWithAuthorization` for the USDC (native Circle USDC implements EIP-3009; its domain is in
   `@bilbypay/core` `NETWORKS`) to a router that converts USDC to AUSD and credits them. The
   router would need a USDC to AUSD path.
3. **Show USDC as dollars.** The app counts USDC and AUSD together as "your balance". This is
   the simplest demo, but the send flow must then also be able to spend USDC.

If AUSD becomes listed, set `TOPUP_DESTINATION=ausd` and nothing else changes. The smoke script
prints whether it is listed.

### Refund address caveat

For EVM origins, `refundTo` defaults to the user's Monad address on the origin network. That is
correct for an EOA, which is what Mera/passkey-derived keys are (`@bilbypay/core`
`deriveEvmPrivateKey`). If the user ever becomes a smart-contract account not deployed on the
origin network, pass `refundTo` explicitly. For non-EVM origins (Solana, Tron, NEAR), live quotes
require `refundTo`.

## Verified vs assumed

- **Verified from source:** endpoint paths, base URLs, auth styles, request/response field names
  and status enum (SDK + widget source). The Monad destination ids (catalogue snapshot + Aurora
  demo). The HOT id encoding (reproduces the listed ids).
- **Not verified live:** the build sandbox blocks `1click.chaindefuser.com` and
  `intents-api.aurora.dev` (proxy 403 "Host not in allowlist"). No real call was made. The test
  fixtures are hand-built from the SDK types, not captured traffic.
- **Assumed:** the Aurora proxy's error body is `{ message }`, like 1Click (the widget reads
  `response.data.message`). The Aurora `/api/deposit/submit` response body. The Aurora
  `/api/tokens` item shape. Whether the Aurora backend works without Studio fee configuration.
  Minimum amounts; Base USDC probably needs about $1 or more, so the provider reports
  `AMOUNT_TOO_LOW` with the minimum.

## Smoke test (no funds)

```bash
INTENTS_API_KEY=<studio key> pnpm --filter @bilbypay/topup smoke:quote              # catalogue + dry quote
TOPUP_PROVIDER=oneclick pnpm --filter @bilbypay/topup smoke:quote                    # same, direct 1Click (JWT optional)
SMOKE_LIVE=1 SMOKE_RECIPIENT=0xYourMonadAddr INTENTS_API_KEY=… pnpm --filter @bilbypay/topup smoke:quote  # real deposit address
SMOKE_STATUS=<quoteId> INTENTS_API_KEY=… pnpm --filter @bilbypay/topup smoke:quote   # poll
```

## What a human must do to demo a live transfer

1. Get an API key at <https://studio.aurora.dev> (Widget Studio → API key). Put it in
   `server/.env` as `INTENTS_API_KEY`.
2. Run the smoke script with no `SMOKE_LIVE`. Confirm that `destination listed: true` and that
   the dry quote returns about $4.9x for $5.
3. Run `SMOKE_LIVE=1 SMOKE_RECIPIENT=<the demo user's Monad address>` (or use the app's "Add
   money" screen once the server routes exist). Note the deposit address, the exact
   `amountInBaseUnits` and the deadline.
4. From any wallet holding USDC on Base, send exactly that amount (for example **$5 of USDC on
   Base**, `0x8335…2913`) to the deposit address before the deadline. A little Base ETH is needed
   for gas.
5. Optional: pass the tx hash to `submitDepositTx` so it is picked up sooner.
6. Poll with `SMOKE_STATUS=<quoteId>` (or the app). Expect `waiting → processing → completed`,
   usually within about a minute. The status result has `destinationTxHashes`. Open one on
   monadscan: it is the USDC arriving at the user's address, which is the proof of funds arriving
   from another chain.
7. For the bounty's "used within the Monad app" requirement, spend it in BilbyPay (a send or a
   gift). This depends on the USDC→AUSD decision above; with option 3, the send flow must handle
   USDC.

Save the `raw` quote response (it contains the 1Click `signature`) for any dispute.
