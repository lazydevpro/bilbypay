# Monad testnet v2 — 2026-10-01

The v2 contracts are deployed on **Monad testnet, chain 10143**. The API/keeper and Expo web preview run on this computer. All balances, gift codes, savings assets, and top-up deliveries in this environment are for testing.

## Try it

- Web app: http://127.0.0.1:8081
- API health: http://127.0.0.1:8787/health
- Verification code: **000000** (test mode; no SMS is sent).
- Prepared browser account: **Bilby Tester**, **+1 415 555 0199**, initially funded with **$250 test dollars**, with **$245 remaining** after the verified $5 browser payment.
- Recipient for testing: **Test Friend**, **+1 415 555 0198**.

The browser test key is scoped to the API, network, and directory deployment. The session survives a page reload in the same tab. If signed out, choose **I already have an account** in the same browser; a phone number alone cannot recover the previous account's balance. A different browser has a different test key.

The current Add money screen offers receiving from a friend. The backend top-up flow is tested by the integration script, but there is no in-app test-dollar faucet. Gifts use mock codes and cannot be redeemed. No Android device was attached during the deployment checks.

## Deployment

Manifest: `contracts/deployments/10143-v2.json`. Directory creation block: **67216804**.

| Contract | Address |
| --- | --- |
| Directory v2 | `0x6CE6a93600D389247971Dd2B0F65ff07FEbE6219` |
| Escrow v2 | `0x65Cf95BA67831B6A75a58eeB91bd99289A25EaAa` |
| Router | `0xec93D63127b20b2116d38e176448B515880AaBD9` |
| Test dollar | `0x281E5E2fFE4F6EEb887A0fe82E9859a7656ad300` |
| Savings stand-in | `0xe589463D6EC1E05681dc4a4dA209EF9bEECc2Ed7` |
| Test USDC | `0x51C923016b405518A356d95eCBEfDA27CabCD538` |

Owner, relayer and keeper use the funded signer `0x6E743B233A103F804255C31aEECbAE723D93dD4E`. Verifier and treasury have separate keys. The treasury was funded with 100,000 test dollars. Deployment used 1.303518792 test MON; integration and browser tests consume additional gas.

Verified after broadcast: both v2 versions (also checked by the integration script), contract owners and code, verifier roles, escrow treasury/directory/token, router token/savings/escrow, keeper access, treasury funding and historical directory reads. The API reconciles finalized directory events independently of the optional Envio deployment. Envio address examples were updated; no Envio Cloud instance was deployed.

## Restart locally

Run these in separate terminals from the repository root:

```sh
pnpm --filter @bilbypay/server start
```

```sh
pnpm --dir app exec expo start --web --port 8081
```

`server/.env` holds service keys, identity secrets, the new deployment path, exact deployment start block, and `DATABASE_PATH=./data/bilbypay-v2.db`. `app/.env` holds only public testnet pins and the API URL. Both are gitignored. Service/deployment key files are owner-readable/writable only. Runtime data, including test account keys and reports, is gitignored under `server/data/`.

Preserve these keys and the database together. The old v1 manifest remains unchanged. This setup does not migrate old v1 accounts or pending payments.

## Validation

- **23/23 live testnet checks passed**, including phone enrollment, relayed sends, invitation claims and cancellation, Burrow add/withdraw/auto-save, gifts, and v2 recovery/revocation controls.
- Recipient changes are rejected by both the app guard and API before relay.
- Revocation invalidates an older gift and returns it to the sender before normal expiry.
- Four integration users held zero MON and submitted zero transactions themselves; the relayer paid gas.
- **123 server tests** and **183 app tests** passed. Typechecks passed; app lint has no errors and five existing style warnings.
- Browser: fresh enrollment, reload with session retained, $250 funding, recipient lookup, $5 payment confirmation, receipt and updated $245 balance all verified. Receipt reference: **BP-6FET-K657**. Screenshots: `reports/phone-directory-v2/testnet-payment-complete.jpg` and `testnet-ready.jpg`.
- Live report: `reports/phone-directory-v2/testnet-e2e.json`.

The ordinary expiry refund test leaves a $3 test payment waiting for its approximately 61-minute deadline; after that, run `pnpm --filter @bilbypay/server e2e:testnet --check-refund`. Seven-day recovery finalization and lease expiry are tested locally with controlled time; they have not been accelerated or claimed complete on testnet.

To rerun all live tests (fresh test accounts, more test gas):

```sh
pnpm --filter @bilbypay/server e2e:testnet
```

The testnet deployment runner is `server/scripts/deploy-testnet-v2.mjs`. It journals signed transactions before broadcast, resumes the same deployment on retry, checks chain 10143, verifies contract wiring and writes the manifest only after verification. The journal is private runtime data. Do not delete it and rerun to create an accidental second deployment.
