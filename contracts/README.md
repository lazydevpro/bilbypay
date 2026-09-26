# BilbyPay contracts

Foundry project. Solidity 0.8.28, OpenZeppelin 5.4.

| Contract | What it does |
|---|---|
| `src/BilbyRouter.sol` | **Burrow**: auto-save above a threshold (`setAutoSave` + keeper `sweep`), "Add to Burrow" (`addToBurrow`), "Move to balance" (`breakToBalance`), and **break-and-pay in one transaction** (`topUpAndCall`). Never holds funds at rest; can only move a user's Burrow money back to that same user. |
| `src/mocks/MockBurrowVault.sol` | Testnet stand-in for Aave **stataAUSD** (ERC-4626 + permit) with `accrue` (simulate earnings) and `liquidityCap` (simulate limited Aave liquidity). |
| `src/mocks/MockAUSD.sol` | Testnet/unit-test dollar with EIP-2612 permit + EIP-3009, like AUSD. `mint` is open. |

## Setup

```bash
git submodule update --init --recursive
cd contracts
forge build
```

## Test

```bash
forge test                                            # unit tests (mocks)
forge test --match-contract Fork --fork-url monad     # same flow vs REAL mainnet AUSD + Aave stataAUSD (no funds spent)
```

## Testnet (Monad testnet, chain 10143)

Testnet AUSD's faucet is owner-restricted, so the testnet stack uses our own test dollar + mock vault.
Real AUSD/stataAUSD behaviour is covered by the mainnet fork test.

```bash
cp .env.example .env        # testnet-only keys; .env is gitignored
# fund the RELAYER address with testnet MON (https://faucet.monad.xyz). The spike user needs no MON.
set -a; . ./.env; set +a
forge script script/DeployBurrowTestnet.s.sol --rpc-url monad_testnet --broadcast   # writes deployments/monad-testnet.json
forge script script/SpikeBurrow.s.sol --rpc-url monad_testnet --broadcast           # auto-save → sweep → break-and-pay
```

## Testnet deployment (2026-09-26)

| | Address |
|---|---|
| Test dollar (MockAUSD) | `0x0deef9c91174108bd764A489CC349b778B78c861` |
| Burrow vault (MockBurrowVault) | `0x5bD706BbfD0B06df4234C5AB044d7eFb957ec59e` |
| BilbyRouter | `0xa365F51817eb50082498bDbA12894083E34f8094` |

Spike run (user `0xcA908dc4…216d8` held **0 MON** and sent **0 transactions**; the relayer paid everything):

| Step | Tx |
|---|---|
| Mint $140 test dollars | `0x67a16d767572f2c0d595de8395d3193e177ce803f50b9c3e6fff92841b2194dc` |
| Auto-save on, keep $40 (user-signed) | `0x21f32356d2ff36bfe38b48233e6ed3287753fd3706d6e2bfab3e58b38c78842c` |
| Sweep $100 into Burrow | `0xc90462e5b15883fb2ce167819dd9333713aed8d0a4375e0f5b5d09ccc7d4dbfc` |
| Pay $100 with $40 balance: break $60 + pay, **one tx** | `0x304d951fd7b63315d59e31615e0e3e3e96584be373ebd851e8b956f0d44d084a` |

Result: balance $0 · Burrow $40 · payee +$100 · router holds $0.

## Mainnet addresses used

| | |
|---|---|
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |
| Aave stataAUSD | `0x9e1AcC5BFbf34e2E579763cE14042d957719fE76` |

Before mainnet: `lockCalls()` the router allow-list, add the escrow's deposit function (payer must be its first argument).
