# BilbyPay indexer (Envio HyperIndex)

An [Envio HyperIndex](https://docs.envio.dev) indexer for BilbyPay on Monad. It follows the three
BilbyPay contracts and every AUSD / stataAUSD movement of BilbyPay accounts, then rolls them up
into:

- the **activity feed** behind `GET /v1/activity` (docs/api.md `ActivityItem`),
- **per-account stats**: pending sends, AUSD in/out, Burrow position and yield, contacts,
- **phone-binding history**, used for the "number recently changed" warning in `/v1/resolve`,
- **protocol analytics**: daily and all-time volume, claim rate, time-to-claim median/p90,
  gift volume, Burrow TVL, active accounts.

It uses Envio 3.13 (`envio@3.13.0`), with the `indexer.onEvent` / `indexer.contractRegister`
API and `createTestIndexer` for tests.

```
indexer/
├── config.yaml            chains (Monad 143 + testnet 10143), contracts, env placeholders
├── schema.graphql         12 entities + 8 enums (see "Data model")
├── abis/                  event-only ABIs generated from packages/core/src/abis.ts
├── src/handlers/          BilbyDirectory.ts, BilbyEscrow.ts, BilbyRouter.ts, BilbyAccount.ts
├── src/lib/               pure logic: transfer classifier, stats/histograms, Burrow maths
├── src/client.ts          typed GraphQL client for the server/app (no envio import)
├── queries/activity.graphql   the documents the client sends (src/queries.ts is generated from it)
└── test/                  createTestIndexer scenarios + unit tests
```

## How it indexes

| Source | Events | Why |
|---|---|---|
| `BilbyDirectory` | `Bound`, `Unbound` | phone ↔ account bindings, rebinds |
| `BilbyEscrow` | `Deposited`, `Claimed`, `Refunded`, `Cancelled` | sends and gifts to phone numbers |
| `BilbyRouter` | `AutoSaveSet`, `Swept`, `Added`, `Broken` | Burrow settings and the moves the router makes |
| `BilbyAccount` (dynamic) | ERC-20 `Transfer`, ERC-4626 `Deposit` / `Withdraw` | AUSD balance moves and stataAUSD shares of BilbyPay users |

**Following only BilbyPay users' tokens.** AUSD is a busy token, and BilbyPay users are a small
subset of its holders. So instead of indexing AUSD, every BilbyPay user is registered at runtime as
a `BilbyAccount` "contract". This happens through `contractRegister` on `Bound`, `Deposited`
(sender), `Claimed` (recipient) and the router events. The token events are then registered as
**wildcard** events with a `where` filter on their indexed topics:

```ts
where: ({ chain }) => ({ params: [{ from: chain.BilbyAccount.addresses }, { to: chain.BilbyAccount.addresses }] })
```

HyperSync therefore returns only `Transfer` logs whose `from` or `to` topic is a BilbyPay account,
from any token. The handler keeps only AUSD and stataAUSD. `Deposit`/`Withdraw` are filtered on
`owner`. As users join, the address set grows, and Envio re-queries for new addresses from the
block where they registered, including earlier logs in that same block.

**Turning transfers into a feed.** Money that moves into or out of a BilbyPay contract is already
described by that contract's own event. For example, a send to a phone number emits AUSD
`Transfer(user→escrow)` and then `Deposited`. So `src/lib/classify.ts` classifies each AUSD
transfer:

| class | example | feed item | stats |
|---|---|---|---|
| `direct` | user → user | `sent` + `received`, contact edge | payments, direct volume |
| `external_out` | user → exchange | `sent` | payments, cash-out volume |
| `external_in` | exchange → user | `received` | top-up volume |
| `escrow_in` / `escrow_out` | user ↔ escrow | from escrow events | from escrow events |
| `burrow_in` / `burrow_out` | user ↔ router/stata, Aave payout | from router/vault events | Burrow flows |

An Aave withdrawal pays AUSD from the aToken, which is an address we don't track. The share burn
that comes earlier in the same tx sets `BurrowPosition.lastBurnTx`, so that payout is labelled
`burrow_out`, not "received from a stranger". The same idea labels vault moves: the stataAUSD
`Deposit`/`Withdraw` creates the `BurrowEvent`, and the router event later in the tx relabels its
source (`AUTO_SAVE` / `ADD` / `BREAK`). Moves that bypass the router stay `DIRECT` and get their
own feed row.

## Data model

| Entity | What it holds |
|---|---|
| `Account` | current phone binding, first/last bind and rebind times, AUSD in/out/net, sent/received/gift counts and volumes, `pendingOutgoing`, auto-save settings, last active. Derived lists: `activity`, `bindings`, `depositsSent`, `depositsClaimed`, `burrow`, `burrowEvents`, `contacts` |
| `Phone` | the account a phoneKey resolves to now, `boundAt`, `rebindCount`, `lastReboundAt`, deposits sent to it |
| `PhoneBinding` | append-only Bound/Unbound history with `isRebind` |
| `EscrowDeposit` | Pending → Claimed/Refunded/Cancelled, kind TRANSFER/GIFT, giftId, claimedBy, paidTo, `timeToClaim` |
| `ActivityItem` | one feed row per account: kind, status, amount, counterparty (address / BilbyPay account / phoneKey), expiry, tx |
| `BurrowPosition` | shares, deposited/withdrawn/net, value and earned at the last share price, sweep/add/break counters |
| `BurrowEvent` | each stataAUSD deposit/withdraw with source and share price |
| `TokenTransfer` | each AUSD/stataAUSD log that touches an account, with its class (audit trail and receipts) |
| `ContactEdge` | from→to payment count/volume/last time, used for "recent contacts" |
| `DailyStats` | UTC day: active accounts (any binding, payment, receipt or Burrow move that day) and new accounts, bindings, rebinds, payments, direct/external volume, escrow deposit/claim/refund/cancel, gifts, time-to-claim sum/count, Burrow in/out, sweeps |
| `GlobalStats` | the same all-time, plus pending escrow value, **claim rate**, **avg / median / p90 time-to-claim** (from a log-scale histogram), Burrow TVL, holders, auto-save users, stataAUSD share price |
| `AccountDay` | marker row that dedupes `DailyStats.activeAccounts` |

Every row is per chain (`disable_default_cross_chain: true`), so mainnet and testnet never mix.
Amounts are AUSD base units (6 decimals) as `BigInt`. Timestamps are unix seconds.

**Correctness notes**
- **BigInt**: all money is `bigint` end to end. Only share price uses WAD (1e18) fixed point.
  `Number()` is used only on time sums, for averages.
- **Idempotency**: ids are deterministic (`txHash-logIndex`, `depositId`, `dep-/claim-/refund-<id>`).
  Every handler checks the row its event creates, and returns early if it already exists. Escrow
  status changes only move out of `Pending`. Counters that depend on state (auto-save users,
  bound phones, Burrow holders) are counted on transitions, so replaying an event does not
  double-count. Envio itself processes each log once and rolls back on reorgs.

## Mapping to the app

`src/client.ts` (`createIndexerClient({ url, chainId })`):

| App / API need | Client call | Source |
|---|---|---|
| `GET /v1/activity?cursor=` | `activity(account, { limit, cursor })` → `{ items, nextCursor }` | `ActivityItem`, keyset-paginated on (blockNumber, logIndex) |
| `/v1/balance` `burrow.amount/earned`, `pendingOut`; profile `autoSave` | `account(account)` | `Account`, `BurrowPosition`, `GlobalStats.sharePriceWad` |
| `/v1/resolve` `recentlyChanged` | `phone(phoneKey)` + `recentlyChanged(row, now, cooldown)` | `Phone.lastReboundAt` |
| recent contacts | `recentContacts(account)` | `ContactEdge` |
| stats / Burrow stats screen, pitch dashboard | `stats(days)` | `GlobalStats`, `DailyStats`, `_meta` |

The server still adds what only it knows: counterparty display names and masked phones (from
`counterparty.address` / `phoneKey`), notes, claim links, gift card ids, and `gift_bought`. That
last one reaches the chain as a plain `sent` to the treasury, which the server can relabel.
`failed` never reaches the chain. The live Burrow `amount` uses the last share price the indexer
saw. `availableNow` and `ratePercent` still come from the stataAUSD/Aave views.

## Run it

```bash
pnpm install                       # from the repo root (indexer is a workspace package)
cd indexer
cp .env.example .env               # set ENVIO_API_TOKEN and the three contract addresses + start block
pnpm codegen                       # generates .envio/types.d.ts from config.yaml + schema.graphql
pnpm test                          # handler scenarios + unit tests (offline, no Docker)
pnpm dev                           # Postgres + Hasura in Docker, indexer, GraphQL at http://localhost:8080 (password: testing)
```

When BilbyPay is deployed, set `ENVIO_MONAD_{DIRECTORY,ESCROW,ROUTER}_ADDRESS` and
`ENVIO_MONAD_START_BLOCK`. Those are the only placeholders. Until then, the default addresses
(`0x…B1001/2/3`) never emit logs, so the indexer runs but stays empty. To index the staging
deployment on testnet, set `ENVIO_TESTNET_SKIP=false` and the `ENVIO_TESTNET_*` values.

After a contract change: run `forge build`, then `node contracts/script/export-abis.mjs`, then
`pnpm --filter @bilbypay/indexer abis`. After editing `queries/activity.graphql`, run `pnpm queries`.

### Deploy

- **Envio Cloud** (hosted, free for hackathon winners): connect the GitHub repo in the Envio
  dashboard, or use `npx envio-cloud indexer add --name bilbypay --repo <owner>/bilbypay`. Then set
  the root directory to `indexer` and the config file to `config.yaml`. Add the `ENVIO_*` variables
  with `envio-cloud indexer env set` (`ENVIO_API_TOKEN` is not needed there). Each push deploys a
  version. `envio-cloud deployment endpoint <indexer> <commit>` prints the GraphQL URL that you pass
  to `createIndexerClient`.
- **Self-host**: `pnpm start` (`envio start`) against your own Postgres
  (`ENVIO_PG_HOST/PORT/USER/PASSWORD/DATABASE`) and Hasura (`HASURA_GRAPHQL_ENDPOINT`,
  `HASURA_GRAPHQL_ADMIN_SECRET`), with `ENVIO_API_TOKEN` for HyperSync.

## What is verified, what is not

Verified here:
- `envio codegen` succeeds against `config.yaml` + `schema.graphql` (Envio 3.13.0), and
  `tsc --noEmit` passes on the handlers, client and tests.
- 26 tests pass (`pnpm test`):
  - 6 `createTestIndexer` scenarios that run the real handlers and the real `where` filters on
    simulated logs: bindings and rebinds; escrow send→claim with time-to-claim; gift refund and
    cancel; direct/external transfers and other tokens; the account-filter drop (an unregistered
    address's log never reaches a handler); and Burrow auto-save→break→direct deposit, with
    yield and TVL.
  - Unit tests for the classifier, histogram quantiles and Burrow maths.
  - Client tests: request shape, pagination, API mapping. One test checks that every field the
    GraphQL documents select exists in `schema.graphql`.

Not verified (the sandbox had no network to Monad or HyperSync, and no Docker daemon):
- `envio dev` / `envio start` against Monad. `envio dev` stops at
  `Failed starting Docker containers: Failed connecting to Docker or Podman`.
  `143.hypersync.xyz` and `rpc.monad.xyz` were unreachable. Monad (143) and Monad testnet (10143)
  are both in Envio's HyperSync chain list (`packages/cli/src/config_parsing/chain_helpers.rs`).
- The GraphQL documents against a live Hasura. Field names are checked against the schema, and
  `chainId` / `_meta` follow Envio's e2e tests, but no query was executed.
- Log order inside the deployed stataAUSD. The handlers rely on the order in
  `aave-dao/aave-v3-origin` `ERC4626StataTokenUpgradeable`, which was read for this work: in
  `_withdraw`, `_burn`, then `POOL.withdraw` (AUSD from the aToken to the receiver), then
  `Withdraw`. In `_deposit`, `transferFrom(caller)`, then mint, then `Deposit`. The tests simulate
  that order, but it was not checked against the bytecode at `0x9e1A…fE76`.
- BilbyPay contracts are not deployed yet, so addresses and start block are placeholders.

## Known gaps

- **Tracked from first sight.** Balances (`ausdIn/Out/NetFlow`) count from the block where an
  account was first registered. Transfers before that block, or earlier in that same block, are
  not attributed. `ausdNetFlow` equals the AUSD balance for accounts funded after joining.
- A log where neither side is known yet (for example, a top-up earlier in the same block as the
  user's first `Bound`) is stored as `TokenTransfer` class `unattributed` and gets no feed row.
- Unbinding does not stop tracking an account's tokens. Envio cannot unregister dynamic addresses,
  and the account is still a BilbyPay user.
- Timestamps are GraphQL `Int` (32-bit signed: fine until 2038).
