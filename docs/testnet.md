# Testnet: deploy and test end to end

Real contracts on **Monad testnet (chain 10143)**; everything else mocked.
| Piece | On testnet |
|---|---|
| BilbyDirectory, BilbyEscrow, BilbyRouter | real contracts |
| Dollars (AUSD) | `MockAUSD`, same signing domain as real AUSD; anyone can mint, so there's a faucet |
| Burrow (Aave stataAUSD) | `MockStata` (ERC-4626 + permit); testnet has no Aave |
| USDC (top-up deliveries) | a second `MockAUSD` |
| SMS codes | test provider: code `000000` for any number |
| Gift cards | mock provider (fake codes) |
| Top-ups | `demo` provider: "arrives" on its own after ~12s and really delivers mock USDC to the treasury, which credits AUSD |
| Passkeys | device-local key (`EXPO_PUBLIC_DEMO_KEY=1`) until the passkey domain is set up |

## 1. Deploy (one command)

Needs Foundry (`forge`, `cast`), `jq`, `bc` and a key with some testnet MON (faucet: https://faucet.monad.xyz).

```bash
git submodule update --init --recursive && pnpm install
DEPLOYER_PRIVATE_KEY=0x… ./scripts/testnet-up.sh
```

The script:
- makes relayer (also the keeper), verifier and treasury keys, and sends the relayer 1 MON (`FUND_MON`);
- deploys everything with `contracts/script/DeployLocal.s.sol`, which refuses real mainnet;
- mints the treasury a $10,000 float;
- writes `contracts/deployments/10143.json` and `server/.env.testnet`.

`server/.env.testnet` holds keys: don't commit it (git ignores it). Re-running reuses the keys.

Commit `contracts/deployments/10143.json` so others (and the indexer) can find the addresses.

## 2. Run the API

```bash
pnpm --filter @bilbypay/server start:testnet     # http://localhost:8787, /health shows devFaucet: true
```

For phones, use your computer's LAN IP, or a tunnel (`cloudflared tunnel --url http://localhost:8787`).
If you use a tunnel, also set `PUBLIC_BASE_URL` in `.env.testnet` so claim links point there.

## 3. Smoke test (no phone needed)

```bash
API_URL=http://localhost:8787 pnpm --filter @bilbypay/server e2e:smoke
```

It drives the API with the app's own client and the checks the app runs before asking for Face ID. Every
money step is a real testnet transaction. It covers:
- onboarding, and the faucet;
- sending to a registered number;
- inviting a new number, who joins and claims;
- Burrow add, then paying more than the balance so the rest comes from Burrow in one transaction;
- a gift card purchase and reveal;
- a top-up converted to AUSD.

It prints explorer links for the receipts.

## 4. The app on phones

```bash
cp app/testnet.env.example app/.env.local   # set EXPO_PUBLIC_API_URL to your LAN IP / tunnel
cd app && npx expo run:ios --device          # or run:android, or eas build --profile development
```

1. Onboard with any number. The code is `000000`.
2. Settings → **Get $100 test money**.
3. Send to a second phone.
4. Invite a third number, then open the link on that phone.
5. Try Burrow, a gift card, and **Add money**.

## Rehearsed locally

`scripts/testnet-up.sh` was run against anvil posing as chain 10143, followed by `start:testnet` and
`e2e:smoke`: all 11 checks passed. The real testnet deploy still has to run from a machine or environment
that can reach `testnet-rpc.monad.xyz`.
