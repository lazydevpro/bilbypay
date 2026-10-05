# Phone number registry evaluation

Date: 2026-10-01. Scope: source inspection and primary-source research, not an implementation or security audit. No live deployment or ODIS service was tested.

## Recommendation

Keep and strengthen `BilbyDirectory`. The real backend already registers phone identifiers on-chain and reads that registry when preparing payments. The web preview uses mock data, and contact search uses a database mirror, which can make the feature appear database-only.

An on-chain directory is useful for independently checking bindings and allowing other applications to resolve the same payment aliases. It does not itself establish phone ownership, remove the lookup service, or protect recipients' transaction history. ENS compatibility is optional and should follow a demonstrated interoperability need.

## What exists today

| Layer | Current implementation | Implication |
| --- | --- | --- |
| Identifier | `server/src/phone.ts:26`: HMAC-SHA256(secret pepper, normalized E.164 phone) | Raw numbers are absent from the registry; deriving lookup keys depends on Bilby's secret. |
| Enrollment | `server/src/accounts.ts:80`: verified phone token plus destination-account signature, then a relayed `bind` transaction | The server checks both proofs before registering. |
| Registry | `contracts/src/BilbyDirectory.sol:14`: account, binding timestamp, replay ordering, binding events | Canonical binding exists on-chain. The contract checks the verifier's signature, not the account signature directly. |
| Contact search | `server/src/accounts.ts:170`: rate-limited SQLite lookup | This endpoint is a cache-backed discovery service. |
| Payment preparation | `server/src/actions.ts:241`: reads `chain.resolve`, then creates authorization for that address | The server reads on-chain state before signing; the payment contract does not resolve the phone dynamically at execution. |
| Client checks | `app/src/signing/guard.ts:116`: compares the prepared payee to the contact lookup | Detects disagreement; both values still originate from the same API. |
| Reassignment warning | `server/src/accounts.ts:164` | The configured seven-day “cooldown” is a warning window, not an enforced waiting period. |
| Indexing | `indexer/src/handlers/BilbyDirectory.ts` handles Bound/Unbound and history | Existing infrastructure can feed discovery. The server currently updates its mirror during registration; reconciliation still needs connecting. |

The repository includes a chain-10143 deployment manifest and a September testnet report. Those are recorded evidence, not confirmation of current live state. No mainnet readiness claim follows from this review.

## What to borrow

ENS separates ownership, registration policy, and address resolution. Its owner-controlled resolver pattern is useful, but a phone number requires a separate authority to verify control. A custom EVM registry does not automatically become discoverable by ENS clients. See [ENS registry documentation](https://docs.ens.domains/registry/ens/) and [ENS resolution](https://docs.ens.domains/web/resolution/).

Celo SocialConnect is the closer reference: issuers attest that an identifier belongs to an account; applications choose issuers they trust. ODIS provides blinded, rate-limited identifier derivation, rather than proof of phone ownership. Multiple attestations may resolve to different accounts, so federation also needs freshness and conflict rules. See [CIP-51](https://github.com/celo-org/celo-proposals/blob/master/CIPs/cip-0051.md), [privacy design](https://github.com/celo-org/social-connect/blob/main/docs/privacy.md), and [protocol details](https://github.com/celo-org/social-connect/blob/main/docs/protocol.md).

Treat this as architecture to evaluate for Monad, not a drop-in Celo deployment. Current configuration, service availability, SDK support, and cryptographic assumptions require separate validation.

## Privacy and authority boundaries

1. **Never publish raw numbers or ordinary phone hashes.** Phone numbers have a small enough search space to enumerate. A public salt does not solve this. Bilby's secret HMAC already improves resistance to offline guessing. [Signal's contact discovery analysis](https://signal.org/blog/private-contact-discovery/) explains the underlying issue.
2. **HMAC protection depends on the secret.** A leak can expose historical public bindings through enumeration. Losing or rotating the pepper also affects discoverability and pending payments; use an explicit version and migration plan.
3. **A known phone can still reveal a payment account through authorized lookup.** From there, public account activity can be correlated. ODIS-style quotas make enumeration more expensive; they do not make this correlation impossible. Deterministic public identifiers and historical events remain linkable.
4. **Independent chain reads verify only identifier → account.** If the same server supplies a dishonest phone → identifier result, reading the chain does not prove the complete relationship. Stronger claims require reviewed, verifiable private derivation with anchored public parameters, or explicit trust in the derivation service.
5. **Phone control is temporary.** SMS verification depends on telecom systems, and numbers can be ported, swapped, or reassigned. NIST explicitly identifies SIM changes and number porting as risks when using PSTN authentication. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html).
6. **The registry verifier is powerful.** Today it can attest an immediate replacement without the previous account's consent. Requiring the new account's signature on-chain would prove destination control, but would not by itself prevent a SIM-swap attacker from supplying their own account. Controller consent, delayed recovery, and verifier governance address different threats.

## Recommended next version

### 1. Make the existing path consistent and independently checkable

- Connect the existing directory indexer to the discovery cache, with reconciliation and finality/reorg handling. Recover from a successful chain write followed by a failed database update.
- Independently read the selected recipient's registry binding in the client before authorization. Explain the remaining identifier-derivation trust accurately.
- Keep a fixed destination in the signed payment. If a binding changes during review, ask the sender to review the recipient again; never silently substitute a new address into an approved payment.
- Keep account names as presentation metadata unless separately verified. An on-chain phone binding does not authenticate someone's displayed name.

### 2. Define number lifecycle rules in the contract and service

- Introduce explicit revision, verification freshness/expiry, revocation, and pending-change state. Specify what happens at expiry; never silently continue a stale binding.
- For ordinary account changes, require current controller consent, fresh phone proof, and new destination consent. Verify relevant signatures on-chain if protection against a compromised backend is a goal.
- For lost-account recovery or legitimately recycled numbers, use a separate delayed reassignment process with notices and a dispute policy. Requiring the former controller forever would strand legitimate new number holders.
- Enforce reassignment delays in the state transition. A UI warning alone is insufficient.
- Retain spending authority in the user's account signer. SMS must not grant access to the previous holder's balance. Define verifier rotation and emergency controls with the same care as reassignment.

### 3. Include pending payments in the policy

The escrow claim path currently accepts a fresh phone token and a verifier-authorized recipient; `BilbyEscrow.claim` does not consult the directory. A new controller of a recycled number could therefore affect still-pending phone-addressed payments even if the old account's balance remains safe.

Define whether reassignment blocks old pending claims, requires sender reconfirmation, or returns funds. Enforce this across the directory, claim service, and escrow. Changing only the directory would leave this policy gap.

### 4. Add shared private discovery only when interoperability needs it

A reviewed OPRF/threshold derivation design can reduce dependence on Bilby's single HMAC secret. It adds quota/Sybil controls, operator availability, key lifecycle, and proof-verification responsibilities. Multiple verification issuers add a separate trust-selection problem. Treat these as later architectural work, not an automatic consequence of putting a mapping on-chain.

## Product experience

The customer flow stays: choose a contact → see their name and number → confirm the amount → send. Enrollment and updates are sponsored behind the scenes. Reading a contract uses RPC and does not require a customer-paid transaction. An exceptional reassignment can say “This number was recently linked to a different account. Check the recipient before sending.”

No wallet addresses, transaction hashes, gas, ENS setup, or blockchain terminology is necessary in the consumer flow.

## Decision

Proceed with hardening the existing on-chain payment directory. Prioritize cache reconciliation, explicit reassignment and pending-payment rules, and client verification. Consider ENS integration or shared private discovery only when other applications need to resolve Bilby identities. The accurate present description is **an on-chain registry with trusted phone verification and server-derived private lookup keys**.
