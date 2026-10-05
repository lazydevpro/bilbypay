# Phone directory v2

Implemented and deployed to Monad testnet on 2026-10-01. The contracts passed 23 live testnet checks; the API and web preview run locally. See [testnet v2 setup and testing](testnet-v2.md). No mainnet deployment has been performed.

## Behavior

- Registration requires a fresh phone check and a destination-account signature over an exact operation, phone identifier, account, revision, validity period, chain and contract. The verifier also signs; the contract checks both signatures.
- A binding lasts at most 365 days. Its controller can renew it with a new phone check, or revoke receiving on that number. Changing to a different number requires an explicit revocation of the old alias first.
- An immediate move to another account additionally needs the old controller's signature. Without it, a recovery request pauses receiving for seven days. Either party can cancel. Finalization requires another OTP check after eligibility and fresh consent; there is a seven-day completion window.
- Former holders retain their account keys, profile and balances. A phone alias never becomes authority to spend an existing balance. A profile's historical phone must not be treated as proof of current phone ownership.
- Expired, revoked and pending numbers are unavailable, rather than offered as new invitations. Unknown numbers can still receive a pending payment and claim it after first enrollment.
- Every pending payment commits to a phone ownership epoch. Reassignment or revocation invalidates older claims, enabling an immediate refund to the original sender. The keeper scans for these refunds as well as normal expiry.
- Contact lookup refreshes directory state directly in batches of eight. A separate finalized-event worker reconstructs the database mirror and rewinds on checkpoint changes; it retains historical profiles and money records.
- Before signing, the client independently reads its configured directory and compares the selected recipient. It checks again after unlocking. Escrow authorizations commit to the selected identifier and epoch. The server checks the revision again before relay. It never retargets an existing signed payment.

The app includes phone management, review/cancellation controls and a pending-change notice on Home. Customer copy uses ordinary account and payment language.

## Deployment boundary

These contracts are not proxy upgrades. Directory v2, its associated escrow, and the router need a new deployment. The deploy scripts now write `local-v2.json`, `10143-v2.json`, or `<chainId>-v2.json`, preserving the checked-in v1 manifests.

1. Keep the v1 manifests, database, secrets and refund service available until all old pending payments and gift orders are resolved. New code does not make old v1 escrow claims safe retrospectively.
2. Deploy the v2 bundle and record the directory deployment block. Inspect its configured verifier and escrow-directory relationship.
3. Start a separate server database, for example `DATABASE_PATH=data/bilbypay-v2.db`. Set `DEPLOYMENT_FILE` to the new manifest and `DIRECTORY_START_BLOCK` to the actual deployment block. Use an RPC that supports finalized blocks and historical reads for reconciliation.
4. Set app build pins `EXPO_PUBLIC_DIRECTORY_ADDRESS`, `EXPO_PUBLIC_ESCROW_ADDRESS`, `EXPO_PUBLIC_CHAIN_ID`, and, if needed, `EXPO_PUBLIC_RPC_URL`. Rebuild/restart Metro after changing build-time configuration. Missing pins fail closed in real mode; demo mode uses a separate mock implementation.
5. Configure Envio's v2 addresses/start block if using the optional GraphQL discovery/history service. The API's finalized RPC reconciler runs independently of Envio.

Server startup rejects v1 contracts, mismatched escrow-directory wiring, an existing unscoped database, a database from another deployment, and changes to the database's HMAC pepper. The SQLite schema migration adds storage fields; it does **not** migrate contracts, money, users, or pending claims between deployments. A production migration needs a separate plan for retained user accounts and outstanding obligations.

## Trust and operating limits

- Phone verification and secret HMAC derivation still trust Bilby's services. Raw numbers are not put on-chain. Independent reads prove identifier-to-account consistency, not that a potentially dishonest derivation service used the right phone number. OPRF/federated verification and ENS compatibility remain future work.
- Phone discovery can reveal a public account to someone who knows the number and can perform an authorized lookup. It does not hide that account's public history.
- The on-chain cancellation mechanism is the implemented dispute policy. The app alerts signed-in users; SMS/push notices and an operator adjudication process are not implemented. A legitimately recycled number disputed by its previous controller may need support intervention rather than repeated automatic reassignment.
- Verifier rotation retains the existing owner-only setter. There is no verifier quorum or governance timelock.
- Registration and management record the broadcast hash and verify exact receipt events on retry. This recovers confirmation timeouts and local result-write failures once the hash is stored. A process failure between node acceptance and hash persistence still needs a relayer outbox to eliminate fully.
- Receipt inclusion is not finality. Finalized cache reconciliation and fresh routing checks handle stale derived state; a historical success receipt should not be treated as a guarantee against reorgs. A signed direct payment has a fixed destination and cannot be redirected, but a later directory change cannot atomically revoke an already signed token authorization.
- Existing gift-claim settlement/fulfilment has a separate partial-failure risk: an on-chain claim that succeeds before its fulfilment record is saved needs operational reconciliation. This change protects claim eligibility and reassignment refunds, not that broader settlement workflow.

## Verification

- Contract suite: consent and operation replay, ERC-1271, revisions, expiry, recovery delay/cancel/window, first enrollment, stale claims, sender refunds and preserved balances.
- API integration on Anvil: real signatures/contracts, independent app lookup, unavailable-number handling, management consent shapes, post-delay OTP, stale registration retry and refund behavior.
- Unit tests: finalized-cache replay/reorg/failure recovery, deployment/pepper binding, transaction-receipt retry validation and client consent/recipient guards.
- App: typecheck, lint, unit tests and a demo browser walkthrough.

### Local results, 2026-10-01

| Area | Result |
| --- | --- |
| Contracts | 56 passed; one RPC-dependent fork test skipped |
| API/server | 111 passed; TypeScript passed |
| Core | 8 passed; TypeScript passed |
| Indexer | 30 passed; TypeScript and code generation passed |
| App | 171 passed in the full suite, followed by five passing country-prefill regression tests; TypeScript passed |
| App lint | No errors; five existing style warnings |
| Web demo | Enrollment, number settings, revocation and renewal checked; balance remained $250 throughout |

The initial browser walkthrough used a fictional number and mock mode. Subsequent deployment validation used real Monad testnet contracts with test assets: 23 live checks passed, including recovery freeze, cancellation, revocation refunds and renewal. Seven-day recovery finalization and lease expiry remain covered locally with controlled time. Current regression gates: 123 server tests and 183 app tests passed, with typechecks and no lint errors. No physical-device validation was performed for this deployment. Screenshots and the live test report are saved in `reports/phone-directory-v2/`.

Reference: [original evaluation](research/phone-registry-evaluation.md), [API specification](api.md), [indexer setup](../indexer/README.md).
