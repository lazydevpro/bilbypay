# BilbyPay server

The backend behind the app: phone verification, the phone → account directory, the relayer that pays
every fee, claim links, gift cards and the Burrow keeper. The HTTP contract with the app is
[`docs/api.md`](../docs/api.md); this server implements it.

TypeScript (ESM) on Node 22: Hono, viem, zod, jose, `node:sqlite` (no native modules), resvg-wasm for
preview images.

## Run locally

Needs Node 22, pnpm and Foundry (`anvil`, `forge`).

```bash
pnpm install                                    # repo root
git submodule update --init --recursive         # forge-std + OpenZeppelin

# 1. A local chain that looks like Monad (chain 143)
anvil --chain-id 143

# 2. Deploy mocks (MockAUSD, MockStata) + BilbyDirectory/Escrow/Router → contracts/deployments/local.json
#    Roles below are anvil accounts 3 (verifier), 4 (treasury) and 2 (keeper).
cd contracts
VERIFIER=0x90F79bf6EB2c4f870365E785982E1f101E93b906 \
TREASURY=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 \
KEEPER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
cd ..

# 3. Configure and start
cp server/.env.example server/.env    # then fill in, e.g. the block below
pnpm --filter @bilbypay/server dev    # http://localhost:8787
```

A working `server/.env` for that local chain (anvil's public dev keys, never use them anywhere else):

```bash
CHAIN_ID=143
RPC_URL=http://127.0.0.1:8545
DEPLOYMENT_FILE=../contracts/deployments/local.json
RELAYER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
KEEPER_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
VERIFIER_PRIVATE_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
TREASURY_PRIVATE_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
PHONE_PEPPER=dev-pepper
TOKEN_SECRET=0x1111111111111111111111111111111111111111111111111111111111111111
GIFT_CODE_KEY=0x2222222222222222222222222222222222222222222222222222222222222222
OTP_PROVIDER=test
```

Give a user dollars on the local chain (MockAUSD's `mint` is open):

```bash
cast send --rpc-url http://127.0.0.1:8545 --private-key 0xac09…ff80 \
  0x5FbDB2315678afecb367f032d93F642f64180aa3 "mint(address,uint256)" <account> 100000000   # $100
```

With `OTP_PROVIDER=test` no SMS is sent: `+1 555 …` numbers (or any number with `OTP_TEST_ALL=1`) take
the code `000000`.

## Tests

```bash
pnpm --filter @bilbypay/server test        # unit + integration (boots its own anvil)
pnpm --filter @bilbypay/server typecheck
```

`test/integration.test.ts` starts `anvil --chain-id 143` on a random port, deploys the mocks and
contracts from `contracts/out` (running `forge build` first if the artifacts are missing; set
`SOLC=/path/to/solc` when solc can't be downloaded), runs the app in-process and drives it like the
app does: OTP → register → session, sends to registered and unregistered numbers, claims, cancel,
expiry refunds (with `evm_increaseTime`), Burrow add / auto-save / keeper sweeps / one-transaction
break + pay / withdraw / `BURROW_BUSY`, gift cards (buy, failed purchase → refund, gift → bought at
claim, recipient's choice), idempotent resubmits and rebind warnings. Users hold 0 MON throughout.

The Phase 0 spike still runs on its own: `pnpm --filter @bilbypay/server spike:relay:local`.

## How it fits together

| Module | Role |
|---|---|
| `config.ts` | Env → typed config. Addresses come from `DEPLOYMENT_FILE` (or `*_ADDRESS`); EIP-712 token domains from `@bilbypay/core`. |
| `db.ts` | SQLite schema + migrations (`PRAGMA user_version`), sliding-window rate limits. |
| `phone.ts` | E.164 normalisation, `phoneKey = HMAC-SHA256(PHONE_PEPPER, e164)`, masking. |
| `otp/` | `OtpProvider`: `TestOtpProvider` (000000) and `TwilioVerifyProvider` (REST). |
| `auth.ts` | Phone tokens (15 min) and session tokens (30 days), HS256 JWTs; EIP-191 message formats. |
| `chain.ts` / `relayer.ts` | viem reads; one serialized submit queue per server key with local nonces, gas = estimate × 1.075, reverts decoded to human errors *before* any gas is spent. |
| `verifier.ts` / `treasury.ts` | Signs Bind/Claim attestations; the treasury pays refunds by signing EIP-3009 authorizations the relayer submits (it holds no MON). |
| `accounts.ts` | Register (OTP + passkey signature → `BilbyDirectory.bind`), sign-in, resolve, rebind tracking. |
| `actions.ts` | prepare → sign → submit for every money action (see below). |
| `claims.ts` | Escrow claims: verifier attestation → `escrow.claim`; gifts are bought at claim time. |
| `giftcards/` | `GiftCardProvider` interface, `MockGiftCardProvider`, and the service: one purchase per giftId, codes AES-256-GCM encrypted at rest, automatic refunds. |
| `keeper.ts` | Burrow sweeps (watches AUSD `Transfer` logs), expiry refunds, gift reconciliation. |
| `burrow.ts` | `/v1/balance` including Burrow amount, earned and rate. |
| `share.ts` | `/c/:code` share page with Open Graph tags and the `/og/:code.png` preview. |

### Money actions

Every action is prepared with *chain* time (latest block timestamp) for deadlines and expiries, so
the server stays correct even if the chain clock drifts from the wall clock.

- **send, registered** → `TransferWithAuthorization` to their account → `AUSD.transferWithAuthorization`.
- **send, invite / gift_send** → escrow terms `{phoneKey, expiry (14 days), kind, giftId, salt}`; the
  user signs a `ReceiveWithAuthorization` to the escrow whose nonce is `escrowTermsNonce(terms)`, so
  nobody can redirect the deposit → `escrow.depositWithAuthorization`.
- **Balance short?** Prepare checks `maxWithdraw`: enough → adds a `burrowPermit` (stataAUSD permit to
  the router, `previewWithdraw(shortfall)` + 0.1%) and submit uses `router.topUpAndCall` — one
  transaction breaks exactly the shortfall and pays. Not enough → `BURROW_BUSY` with `availableNow`
  (balance + what Burrow can release now) *before* Face ID.
- **gift_buy** → `TransferWithAuthorization` to the treasury, then the card is bought from the provider
  float. A definite provider failure refunds treasury → user automatically; an ambiguous error leaves
  the card `processing` and the keeper retries with the same idempotency key (never double-buys,
  never refunds a card that might exist).
- **cancel / burrow_autosave / burrow_add / burrow_withdraw** → `escrow.cancel`, `router.setAutoSave`
  (+ immediate sweep when enabling), `router.addWithAuthorization`, `router.breakToBalance`.

Submit verifies every signature against the account before touching the chain, and is idempotent
per action id (concurrent resubmits share one execution; later ones get the stored result).

### Burrow keeper

Polls AUSD `Transfer` logs to auto-save users in `KEEPER_BLOCK_RANGE`-block windows from the last
seen block (Monad RPCs keep little history; the first run starts at the head), debounces
`KEEPER_DEBOUNCE_MS`, then calls `router.sweep(user)`. It skips transfers *from* stataAUSD (the user
moving Burrow money to their balance) and never sweeps a user with an action between prepare and
submit. The same loop refunds expired escrow deposits (`escrow.refund`, callable by anyone) and
settles gift orders left processing.

**Rate:** `ratePercent` comes from Aave's current AUSD supply rate (`getReserveData(ausd).currentLiquidityRate`,
compounded per second) when `AAVE_POOL_ADDRESS` is set, cached 5 minutes; otherwise `BURROW_RATE_PERCENT`.
**Earned** = `convertToAssets(shares)` − principal, where principal is tracked in the DB from every
add, sweep and break the server relays (clamped at 0).

## Environment

See [`.env.example`](.env.example) for the full list. The important ones:

| Var | Notes |
|---|---|
| `CHAIN_ID`, `RPC_URL`, `DEPLOYMENT_FILE` | 143 mainnet / 10143 testnet; local anvil also uses 143 with `deployments/local.json`. |
| `RELAYER_PRIVATE_KEY` | Pays all gas. Keep > 10 MON on Monad (gas is charged on the limit). |
| `VERIFIER_PRIVATE_KEY` | Must be the `verifier` of BilbyDirectory and BilbyEscrow. |
| `KEEPER_PRIVATE_KEY` | A router keeper (`router.setKeeper`); defaults to the relayer key. |
| `TREASURY_PRIVATE_KEY` | Must be `BilbyEscrow.treasury`; receives gift money, pays refunds. |
| `PHONE_PEPPER` | HMAC key for phoneKeys. Never rotate: every binding depends on it. |
| `TOKEN_SECRET`, `GIFT_CODE_KEY` | 32 bytes each (hex or base64). |
| `OTP_PROVIDER` | `test` or `twilio` (+ `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`). |
| `PUBLIC_BASE_URL` | Base of claim links and OG images, e.g. `https://bilbypay.com`. |
| `GIFT_PROVIDER` | `mock` (default). Register `laso` / `bitrefill` in `src/giftcards/providers.ts`. |
| `REBIND_COOLDOWN_DAYS` | Senders see `recentlyChanged` for this long after a number moves (default 7). |

## Deploying

- Run **one instance**. Per-user locks, the relayer's nonce queue and the keeper live in-process,
  and SQLite is a local file (`DATABASE_PATH`, on a persistent volume). Put it behind TLS with
  `TRUST_PROXY=1` so per-IP rate limits see the client address.
- Serve it at the domain in the app's associated domains: `/.well-known/apple-app-site-association`
  and `/.well-known/assetlinks.json` come from `public/.well-known/` (replace the placeholders with
  the Apple team id and Android signing fingerprints). The AASA also claims `/c/*` so claim links
  open the app.
- On start the server checks that AUSD's and stataAUSD's on-chain EIP-712 domains match the ones it
  signs against, and refuses to run otherwise.
- Fund the relayer and keeper with MON; the treasury needs none. Deploy contracts with
  `contracts/script/Deploy.s.sol` using the verifier/treasury/keeper addresses of these keys.
- Codes, OTPs, tokens and request bodies are never logged.

## Not covered by tests

- `TwilioVerifyProvider` (needs real credentials; small REST client over Twilio Verify v2).
- The Aave rate lookup (`AAVE_POOL_ADDRESS`), which needs mainnet; the fallback rate is tested.
- Laso / Bitrefill providers live in `packages/giftcards` and plug into `giftcards/providers.ts`.
