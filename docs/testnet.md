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

## Current deployment (Monad testnet, 2026-09-26)

| Contract | Address |
|---|---|
| BilbyDirectory | [`0x246fa171ff0AE45a34Bb88E4E07E04f44CB75Ae7`](https://testnet.monadexplorer.com/address/0x246fa171ff0AE45a34Bb88E4E07E04f44CB75Ae7) |
| BilbyEscrow | [`0x623Fa426793aDf2E61BCc50D269E7CaFfBc16aba`](https://testnet.monadexplorer.com/address/0x623Fa426793aDf2E61BCc50D269E7CaFfBc16aba) |
| BilbyRouter | [`0xa0c141F6465eDaA2E7A2483a310Ac72830986cb0`](https://testnet.monadexplorer.com/address/0xa0c141F6465eDaA2E7A2483a310Ac72830986cb0) |
| MockAUSD (test dollars) | `0xa8A4Ec31029dCDE18Fd2c6df493C333E7160219A` |
| MockStata (Burrow) | `0x89A51d8D453b493672BD4f262eEd32E1223EBea7` |
| Mock USDC (top-ups) | `0xc0BA2A8B2027C1420A264E8732dE63D227929e4d` |

The same addresses are in `contracts/deployments/10143.json`.

| Role | Address |
|---|---|
| Deployer | `0x862FfCB615395c0Ed7667fFEe1A2C5b3c1298582` |
| Relayer / keeper | `0x1815Ca0B977fd516bd9903eAd9F47F26616F63ED` |
| Verifier | `0xe24B1836159AB752a854bD1a1443f4f350190f94` |
| Treasury | `0xE4dd14B08299C7373bd4c1E0b663d7671Aba29a7` |

The treasury started with $10,000 in test dollars.

`e2e:smoke` passed against this deployment: all 11 checks, every step a real testnet transaction. Examples:
- [Alice → Bob $20 by phone number](https://testnet.monadexplorer.com/tx/0xf29c94a8370abfa82248bcf1276195963f13efd69afcc000e6ef8a89b4de357b)
- [$95 payment with $30 taken from Burrow in the same transaction](https://testnet.monadexplorer.com/tx/0x5ef44d1092ac111f54a82782e396dd57f65246d87cc4083a60319397245d3dd2)

A full run costs the relayer about 0.18 MON.

The role keys were generated in the session that deployed and live only in that session's `server/.env.testnet`.
To run the API elsewhere, either:
- re-run `scripts/testnet-up.sh`, which makes new role keys and redeploys; or
- reuse this deployment by setting new verifier/treasury/keeper keys on the contracts (owner = deployer).

> Sandboxed environments that only allow egress through `HTTPS_PROXY`: start Node with `NODE_USE_ENV_PROXY=1`.
> Node's built-in fetch ignores the proxy variables otherwise.

## Rehearsed locally

`scripts/testnet-up.sh` was run against anvil posing as chain 10143, followed by `start:testnet` and
`e2e:smoke`: all 11 checks passed. The real testnet deploy still has to run from a machine or environment
that can reach `testnet-rpc.monad.xyz`.
