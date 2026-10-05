# BilbyPay indexer (Envio HyperIndex)

An [Envio HyperIndex](https://docs.envio.dev) indexer for BilbyPay on Monad. It follows the three
BilbyPay contracts and every AUSD / stataAUSD movement of BilbyPay accounts, then rolls them up
into:

- the **activity feed** behind `GET /v1/activity` (docs/api.md `ActivityItem`),
- **per-account stats**: pending sends, AUSD in/out, Burrow position and yield, contacts,
- **phone-binding history**, including when a number changes account,
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
| `BilbyDirectory` | `Bound`, `Unbound`, `BindingUpdated`, `RecoveryRequested`, `RecoveryCancelled`, `RecoveryFinalized` | phone ↔ account bindings, verification expiry, revision/epoch and delayed changes |
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
| `Phone` | last bound account, revision, phone epoch, expiry/revocation and pending change, rebind history, deposits sent to it. Consumers must evaluate time-dependent availability. |
| `PhoneBinding` | append-only Bound/Unbound history with `isRebind` |
| `DirectoryChange` | ordered v2 lifecycle events with source directory, revision, block/log location and operation fields |
| `EscrowDeposit` | Pending → Claimed/Refunded/Cancelled, authorized `phoneEpoch`, kind TRANSFER/GIFT, giftId, claimedBy, paidTo, `timeToClaim` |
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

The table describes available GraphQL client capabilities. The current server's `/v1/resolve` performs
direct chain reads for each contact in batches of at most eight and refreshes its SQLite mirror; it does
not use Envio or the mirror alone to decide whether a recipient is payable. The finalized RPC worker repairs
the mirror separately. Phone key derivation remains centralized HMAC with the server's unchanged secret.

| App / API need | Client call | Source |
|---|---|---|
| `GET /v1/activity?cursor=` | `activity(account, { limit, cursor })` → `{ items, nextCursor }` | `ActivityItem`, keyset-paginated on (blockNumber, logIndex) |
| `/v1/balance` `burrow.amount/earned`, `pendingOut`; profile `autoSave` | `account(account)` | `Account`, `BurrowPosition`, `GlobalStats.sharePriceWad` |
| optional phone history / recent-change presentation | `phone(phoneKey)` + `recentlyChanged(row, now, cooldown)` | `Phone.lastReboundAt` |
| directory discovery/history | `directoryChanges({ afterBlock, afterLog, toBlock, limit })` | `DirectoryChange`, ascending block/log cursor |
| recent contacts | `recentContacts(account)` | `ContactEdge` |
| stats / Burrow stats screen, pitch dashboard | `stats(days)` | `GlobalStats`, `DailyStats`, `_meta` |

The server still adds what only it knows: counterparty display names and masked phones (from
`counterparty.address` / `phoneKey`), notes, claim links, gift card ids, and `gift_bought`. That
last one reaches the chain as a plain `sent` to the treasury, which the server can relabel.
`failed` never reaches the chain. The live Burrow `amount` uses the last share price the indexer
saw. `availableNow` and `ratePercent` still come from the stataAUSD/Aave views.

## Directory v2 and server reconciliation

The directory contract is the routing authority. The Envio database and the server's SQLite table are
rebuildable projections. `BindingUpdated` carries canonical revision, phone epoch, verification expiry and
revocation state. `RecoveryRequested` follows that event and sets the pending change; another
`BindingUpdated` clears pending state. `Bound` / `Unbound` retain historical counters. Renewing the same
account's number does not count as a reassignment.

Elapsed time produces no event. Use `directoryStatus(phone, now)` (or direct contract resolution), checking
revocation, `now >= validUntil` and live pending recovery (`now <= pendingExpiresAt`). `Account.isBound` and
`GlobalStats.boundPhones` describe recorded, unreleased links; they are not live counts of payable aliases.
A revoked binding can retain the former account in `Phone` as history. Phone epochs use GraphQL BigInt
strings; never convert revisions/epochs to JavaScript Number.

`server/src/directory-cache.ts` implements the ingestion path used by the server:

1. Read the RPC's **finalized** head; no silent fallback to latest.
2. Verify the durable checkpoint block hash. If it diverges or the finalized head regresses, clear only the
   directory mirror and restart at the configured deployment block.
3. Scan at most 100 inclusive blocks per window, deduplicate the phone keys emitted by directory events,
   and read `getBinding` + `getPendingChange` at that window's end block.
4. Check the anchor hash again, then apply snapshots and advance the cursor in one SQLite transaction.
   A crash or database error retries the same window. Empty windows also advance the cursor.
5. Reject a snapshot older than the mirror's `observed_block` so backfill cannot overwrite a newer direct
   read. On a fork reset, replay repairs the projection. Retain all profiles, balances and payment history.

The RPC must support finalized block tags and historical reads for the configured range. Unsupported reads
or unknown event ABIs stop reconciliation. There is no webhook side effect inside Envio handlers. Selected
recipients still receive direct chain checks before authorization; indexer readiness is not a finality proof.
Changing a phone binding never substitutes a new payee into an already signed payment.

The optional GraphQL `DirectoryChanges` operation provides ordered discovery events and accepts ordinary
client headers for authenticated endpoints. An external consumer must check `directoryAddress`, confirm
finality/block hashes independently and handle reorg rollback; a monotonic cursor alone cannot remove events
that later disappear. Never publish privileged GraphQL credentials in the mobile app. No live Envio or Hasura
endpoint was exercised for this change. Envio's per-chain rollback support is documented in its
[v3.13 release overview](https://docs.envio.dev/blog/developer-update-september-2026).

### Deployment compatibility

This ABI requires new Directory/Escrow/Router deployments and a new server database; update app contract
pins and both server/indexer deployment start blocks together. Do not overwrite the v1 deployment manifest
or point v2 clients at it. Keep existing escrow funds and historical records on their original version.
Regenerate ABIs with the commands below and reindex from the v2 deployment block. No deployment is performed
by this source change.

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
- 30 tests pass (`pnpm test`):
  - 8 `createTestIndexer` scenarios that run the real handlers and the real `where` filters on
    simulated logs: bindings and rebinds; escrow send→claim with time-to-claim; gift refund and
    cancel; direct/external transfers and other tokens; the account-filter drop (an unregistered
    address's log never reaches a handler); and Burrow auto-save→break→direct deposit, with
    yield and TVL; verification renewal; and v2 recovery/cancellation/finalization/revocation with escrow epochs.
  - Unit tests for the classifier, histogram quantiles and Burrow maths.
  - Client tests: request shape, pagination, API mapping, directory expiry and pending boundaries. One test checks that every field the
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
- V2 BilbyPay contracts have not been deployed by this change. V2 addresses/start blocks must be configured
  separately; any existing v1 deployment manifest is not compatible with these handlers.

## Known gaps

- **Tracked from first sight.** Balances (`ausdIn/Out/NetFlow`) count from the block where an
  account was first registered. Transfers before that block, or earlier in that same block, are
  not attributed. `ausdNetFlow` equals the AUSD balance for accounts funded after joining.
- A log where neither side is known yet (for example, a top-up earlier in the same block as the
  user's first `Bound`) is stored as `TokenTransfer` class `unattributed` and gets no feed row.
- Unbinding does not stop tracking an account's tokens. Envio cannot unregister dynamic addresses,
  and the account is still a BilbyPay user.
- Timestamps are GraphQL `Int` (32-bit signed: fine until 2038).
