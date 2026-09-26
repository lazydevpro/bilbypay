# BilbyPay on Monad testnet

Everything (contracts, server, keeper, gift cards, top-ups) runs on Monad testnet (chain **10143**) with test money
only. Testnet AUSD's faucet is owner-restricted, so testnet uses an open-mint **test dollar** and a **stataAUSD
stand-in**; real AUSD + Aave stataAUSD behaviour is covered by the mainnet fork test
(`MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc ForkTest`).

## Deployment (2026-09-26)

| | Address |
|---|---|
| BilbyDirectory | `0x816278f2483F6F1f0c0eE9b2F7D822B2F17473e8` |
| BilbyEscrow | `0xb67Df5C158ED85e1914030a950D39e28bCeB205b` |
| BilbyRouter | `0x95C80A0687104d8ecEcA0847e600777Bd4dCd57F` |
| Test dollar (MockAUSD) | `0x0Cc6621ff8b3Bd552eA873DaD6deddB323801494` |
| Burrow stand-in (MockStata) | `0xeCDdF16963b552F684Fdc6F6cCc1866126d290bb` |
| Test USDC (top-up deliveries) | `0x9186167c8a803454DD576bA6b0E571C450C2A22C` |
| Relayer / keeper | `0xf359F0632A3B91771F7D0D4C0C14a1D796921CaB` |
| Verifier | `0xEed76b5694ebd19B9f641F3aBb944a5C6C51Ae82` |
| Treasury | `0x383D7B123f5e33Ab2b8848f8f195585087157229` (funded with $100k test dollars) |

Source of truth: `contracts/deployments/10143.json`. Start block 65890503.

## Run it

```bash
# 1. server (server/.env holds the testnet keys; gitignored)
cd server && node --env-file=.env --import tsx src/main.ts        # or: pnpm dev
curl localhost:8787/health                                         # {"ok":true,"chainId":10143,...}

# 2. every flow, end to end, through the app's own API client + signing guard
pnpm --filter @bilbypay/server e2e:testnet
pnpm --filter @bilbypay/server e2e:testnet --check-refund         # ≥ 61 min later: unopened send refunded
```

`server/.env` for testnet: `CHAIN_ID=10143`, `DEPLOYMENT_FILE=../contracts/deployments/10143.json`,
`USDC_ADDRESS=<test USDC>`, `OTP_PROVIDER=test` + `OTP_TEST_ALL=1` (code **000000** for any number),
`GIFT_PROVIDER=mock`, `ESCROW_EXPIRY_DAYS=0.0425` (~61 min; the escrow minimum is 1 hour).
Fund the relayer with testnet MON at <https://faucet.monad.xyz>; users never need MON.

On testnet the mock top-up really delivers **test USDC to the treasury on-chain** (`server/src/topup-testnet.ts`),
so "Add money" goes through the same on-chain delivery check as mainnet.

## E2E result (2026-09-26): all 21 flows passed

| # | Flow | Result |
|---|---|---|
| 1 | Onboard (number check → key signature → on-chain binding) | ✅ |
| 2 | Sign in again with the same key | ✅ |
| 3 | Add money (top-up) → test USDC delivered + verified → balance credited | ✅ $24.98 |
| 4 | Extra test dollars (mint) | ✅ |
| 5 | Send $20 to a registered number, one confirmation, gasless | ✅ ~2.6 s end-to-end incl. RPC round trips |
| 6–7 | Send to a number not signed up → claim link → they sign up → money lands | ✅ |
| 8 | Sender sees it opened | ✅ |
| 9 | Take back an unopened send | ✅ |
| 10 | Unopened send refunds after expiry (keeper) | ✅ refunded (`--check-refund`, ~65 min later) |
| 11 | Burrow: add | ✅ |
| 12 | Burrow auto-save: keep $50, rest swept by the keeper | ✅ |
| 13 | Incoming money above the threshold is swept too | ✅ |
| 14 | Pay $80 with $50 → $30 from Burrow in **one transaction** (sent to the router) | ✅ |
| 15 | Auto-save off → Move to balance → keeper doesn't sweep it back | ✅ |
| 16 | Gift card for myself → code shown in-app | ✅ |
| 17 | Gift card to someone not signed up → they open it, pick a brand, card appears | ✅ |
| 18 | Only the owner can reveal a card | ✅ |
| 19 | Errors are plain language | ✅ |
| 20 | No user ever held or spent MON; users sent 0 transactions | ✅ |

Report + tx hashes: `server/data/e2e-testnet-report.json` (local, gitignored).

## The app on a phone (testnet)

The app needs a native build (passkeys, secure storage). On testnet it can use a **device-local key instead of a
passkey** (`EXPO_PUBLIC_DEMO_KEY=1`), so it works before the passkey domain exists. That mode is refused on
mainnet (`app/src/config.ts`, tested in `app/src/config.test.ts`), and the app shows a "Test mode" notice.

```bash
cd app
cp .env.testnet.example .env                  # set EXPO_PUBLIC_API_URL=http://<this computer's LAN IP>:8787
npx eas-cli@latest build --profile testnet --platform android   # APK, install on the phone (Expo account)
npx expo start --dev-client                   # phone on the same Wi-Fi; the app loads JS from here
```

iOS needs an Apple Developer account for a device build (`--platform ios`), or Xcode for the simulator.

## Indexer on testnet

`indexer/.env.testnet.example` has the testnet addresses. Copy it to `indexer/.env`, add `ENVIO_API_TOKEN`, then
`pnpm --filter @bilbypay/indexer dev` (needs Docker) or deploy to Envio Cloud.

## Not covered on testnet (by design)

- **Real passkeys**: need the `bilbypay.com` domain with `.well-known` files + an Apple Team ID (runbook A–C).
- **Real gift cards** (Laso, real USDC on Base) and **real top-ups** (Aurora): mainnet smoke tests in
  `docs/launch-checklist.md`.
- **Real SMS**: Twilio on the deployed server.
