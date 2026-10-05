# BilbyPay API v1 (server ↔ app contract)

The single source of truth for `server/` and `app/`. Changing a shape here means changing both.

## Directory v2 deployment boundary

These identity flows require **new Directory, Escrow and Router deployments**, a fresh application database,
and updated client contract pins. They cannot be enabled against the existing v1 deployment manifest.
Keep the v1 manifest and records intact; existing escrow deposits must complete/refund under their original
contracts. Reusing v1 addresses or prepared signatures with this ABI is unsupported.

Set the server's new deployment file and `DIRECTORY_START_BLOCK` to the actual v2 deployment block; configure
the indexer's contract addresses/start block to match. Build the client with matching
`EXPO_PUBLIC_CHAIN_ID`, `EXPO_PUBLIC_DIRECTORY_ADDRESS`, `EXPO_PUBLIC_ESCROW_ADDRESS` and an independently
configured `EXPO_PUBLIC_RPC_URL`. A start block of zero is convenient for local tests, not an automatic
production discovery strategy. This change prepares implementation; it does not deploy or migrate live state.

For a clean v2 instance, set `DATABASE_PATH=data/bilbypay-v2.db` (a new, nonexistent file) alongside the new
deployment file. Keep the old database, secrets and v1 service configuration separately until old payments
have been drained/refunded. Startup refuses a populated database without a v2 deployment scope, and refuses
changing its chain, directory, escrow or `PHONE_PEPPER`. A private HMAC sentinel checks pepper consistency;
the pepper itself is never stored in this metadata or logged. SQL schema upgrades alone do not migrate
contract state. Do not delete the guard metadata to force a mixed deployment to start.

The finalized RPC reconciler stores a cursor scoped to chain, directory and start block, scans at most
100 blocks per window, and commits state snapshots plus cursor atomically. It verifies saved block hashes
and rebuilds the directory mirror on divergence, retaining account profiles and money records. Unavailable
finalized/historical reads stop reconciliation; there is no implicit fallback to latest. Contact resolution
and payment authorization still perform current direct reads. See [indexer reconciliation notes](../indexer/README.md#directory-v2-and-server-reconciliation).

## Conventions

- Base URL: `EXPO_PUBLIC_API_URL` (e.g. `https://api.bilbypay.com`). All routes below are under `/v1` unless noted.
- JSON in and out. **Money is a string of AUSD base units (6 decimals)**: `"12500000"` = $12.50. Never floats.
- Timestamps: ISO-8601 strings.
- Auth: `Authorization: Bearer <sessionToken>` where marked 🔒.
- Errors: HTTP 4xx/5xx with body `{ "error": { "code": "SNAKE_CASE", "message": "Human sentence with a next step." } }`.
  `message` is safe to show to users as-is (spec §3a glossary — no crypto words). Codes the app must handle:
  `OTP_INVALID`, `OTP_EXPIRED`, `RATE_LIMITED`, `PHONE_INVALID`, `SESSION_EXPIRED`, `INSUFFICIENT_FUNDS`,
  `BURROW_BUSY` (Aave liquidity short; body adds `availableNow`), `RECIPIENT_RECENTLY_CHANGED`, `ACTION_EXPIRED`,
  `ALREADY_CLAIMED`, `CLAIM_EXPIRED`, `WRONG_PHONE`, `GIFT_UNAVAILABLE`, `NOT_FOUND`, `INTERNAL`,
  `INVALID_REQUEST` (bad params), `PHONE_REQUIRED` (403: signed-in account has no number yet — go to the phone step),
  `CONFIRMATION_FAILED` (bad signature, checked before anything moves), `ALREADY_DONE` (authorization already used),
  `RECIPIENT_CHANGED` (409: binding changed; select the recipient and review again),
  `PHONE_UNAVAILABLE` (409: expired/revoked number cannot receive),
  `PHONE_CHANGE_PENDING` (409: delayed number change; response may include `availableAt`),
  `GIFT_PROCESSING` (409: card not ready to reveal yet). An expired `phoneToken` returns `OTP_EXPIRED`; a stale
  `issuedAt` on register/sign-in returns `ACTION_EXPIRED`. Unknown codes: show `message`.
- Idempotency: every `POST .../submit` is idempotent per action id — resubmitting returns the first result.
- EIP-712 payloads are sent as `TypedDataJson` (`@bilbypay/core`: `serializeTypedData` / `hydrateTypedData`);
  uint fields are decimal strings.

## Identity

`phoneKey = HMAC-SHA256(PHONE_PEPPER, E.164)` is computed on the server. The derived key is public on-chain
and sent to the app internally for independent directory checks; the raw phone and secret pepper are not
published on-chain. Phones are normalised to E.164 (`libphonenumber-js`), with the app sending its region as a hint.
Addresses, derived keys, signatures and transaction hashes are implementation data and never appear in
consumer screens. An independent chain read validates key → account; the server remains trusted for
phone → key derivation and phone verification. Display names are presentation metadata.

### `POST /v1/otp/start`
`{ phone: string, region?: "US" }` → `{ ok: true, expiresInSeconds: 600 }`
Rate limit: 5 per phone per hour, 20 per IP per hour. In dev/test mode (`OTP_PROVIDER=test`) no SMS is sent and
the code is always `000000` for numbers starting `+1555` or any number when `OTP_TEST_ALL=1`.

### `POST /v1/otp/verify`
`{ phone, code }` → `{ phoneToken: string, phone: "+14155550123", phoneMasked: "+1 •••• 0123" }`
`phoneToken` is a short-lived (15 min) signed token carrying `phoneKey` + E.164. It proves the number; it **never** moves money.

### `POST /v1/accounts/registration/prepare`
After OTP verification, prepare the exact destination consent to sign:

```ts
{ phoneToken: string; address: Hex; controllerConsent?: boolean }
// response
{
  id: string;
  operation: "bind" | "requestRecovery" | "finalizeRecovery";
  typedData: TypedDataJson;
  phoneKey: Hex;
  revision: string;
  validUntil: string;
  availableAt?: string;
}
```

The client verifies the pinned directory address, chain ID, version `"2"`, operation-specific primary type,
destination account, phone key, revision and expiry before signing. Directory messages contain
`phoneKey`, `account`, `issuedAt`, `deadline`, `expectedRevision`, `validUntil` (all integer fields uint256).
`Bind`, `RequestRecovery` and `FinalizeRecovery` are distinct primary types to prevent cross-operation replay.

New enrollment and renewal use `bind`. Immediate reassignment also requires the existing controller's
signature; `controllerConsent: true` selects that path but does not substitute for the signature.
Without controller consent, reassignment uses a seven-day recovery delay enforced by the contract.
During a live recovery both new payments and claims are blocked. After the delay the candidate obtains
a fresh OTP and prepares again to receive `finalizeRecovery`; the completion window lasts seven days.
A binding lease lasts at most 365 days. Changing an account's number requires explicitly revoking its
old number before enrolling the new one. Rate limit: 30 preparations per IP per hour.

### `POST /v1/accounts/register`
Submit prepared consent to enroll, renew, request recovery, or complete recovery.

```
{ phoneToken, address, displayName, issuedAt: number /*unix s*/, signature: Hex,
  registrationId: string, consentSignature: Hex, controllerSignature?: Hex }
```
`signature` = EIP-191 `personal_sign` by `address` of:
```
BilbyPay: link phone to this account
Phone: +14155550123
Account: 0xabc…
Issued: 1790000000
```
`consentSignature` signs the preparation's EIP-712 payload with the destination account. Server checks the
phone token, login signature (issuedAt within five minutes), consent and exact current revision, then obtains
the verifier attestation and relays the selected operation. The contract verifies account/controller consent.

→ `{ status: "registered" | "pending", sessionToken, profile: Profile | null, availableAt?: string }`.
Pending recovery does not create an active profile for a new account. Existing account profiles and balances
remain accessible when a phone alias is revoked, expires or is reassigned. Phone possession never grants
spending authority over the previous account. The recent-change warning is separate from the enforced delay.

### 🔒 `GET /v1/accounts/phone`

```ts
{
  status: "active" | "expired" | "revoked" | "pending" | "reassigned" | "unlinked";
  phone: string | null;
  phoneMasked: string | null;
  phoneKey: Hex | null;
  validUntil: string | null;
  revision: string;
  pending: { account: Hex; availableAt: string } | null;
}
```

The app displays the number, status and available time. The internal account and key are never displayed.

### 🔒 `POST /v1/accounts/phone/prepare` and `POST /v1/accounts/phone/submit`

Prepare with `{ operation: "revoke" | "cancelRecovery" }` → `{ id, operation, typedData }`.
The controller signs `Revoke(phoneKey,expectedRevision,deadline)` or
`CancelRecovery(phoneKey,expectedRevision,deadline)` under directory domain version `"2"`.
The pending candidate may also cancel their recovery. Submit `{ id, signature }` →
`{ ok: true, ...phoneStatus }`. Revocation also invalidates older pending payments through the phone epoch.
Management preparation is limited to 30 requests per account per hour. Repeated successful submissions
return the saved result; a changed revision requires a fresh preparation.

### `POST /v1/session`
Returning user / new phone / reinstall (after passkey sign-in yields the same address).
`{ address, issuedAt, signature }` with message
```
BilbyPay: sign in
Account: 0xabc…
Issued: 1790000000
```
→ `{ sessionToken, profile: Profile | null }` (`profile` null = account never registered a number → app goes to phone step).

### 🔒 `GET /v1/me` → `Profile`
```ts
type Profile = {
  address: Hex; displayName: string; phone: string; phoneMasked: string;
  phoneStatus?: "active" | "expired" | "revoked" | "pending" | "reassigned" | "unlinked";
  autoSave: { enabled: boolean; threshold: string };
  createdAt: string;
}
```

## Balances

### 🔒 `GET /v1/balance`
```ts
{
  balance: string;            // spendable AUSD
  burrow: {
    amount: string;           // stataAUSD convertToAssets(shares)
    earned: string;           // amount − net deposited (never negative in UI; clamp ≥ 0)
    availableNow: string;     // maxWithdraw (Aave free liquidity)
    ratePercent: number;      // variable, e.g. 4.2 — show "about 4.2% a year, changes over time"
  };
  pendingOut: string;         // sum of my unclaimed sends (escrow)
}
```

## Contacts

### 🔒 `POST /v1/resolve`
`{ phones: string[] (≤ 200), region?: string }` →
```ts
{ results: Array<{
  phone: string;                  // as sent
  e164: string | null;            // null = not a valid number
  status: "registered" | "invite" | "invalid" | "unavailable";
  displayName?: string;           // registered only
  address?: Hex;                  // registered only — for signing; the UI never shows it
  recentlyChanged?: boolean;      // number moved to a new account within the cooldown → warn sender
  directory?: DirectoryProof;
}> }

type DirectoryProof = {
  phoneKey: Hex;
  revision: string;
  ownershipEpoch: string;
  validUntil: string | null;
  pending: boolean;
};
```
Rate limited (enumeration): 500 numbers per account per day.
`invite` is reserved for a never-enrolled number. Expired, revoked or pending bindings are `unavailable`;
they must not silently become invitation payments. Contact resolution refreshes routing state directly from
the chain in bounded batches. The server's database is a rebuildable mirror, not the binding authority.

## Money actions: prepare → sign → submit

Every money movement is the same three steps so the app has one code path and one Face ID:

1. 🔒 `POST /v1/actions` `{ type, params }` → `PreparedAction`
2. App shows `summary`, user confirms with Face ID, app signs every entry of `toSign` with the account key
   (one mera signing session → one biometric prompt).
3. 🔒 `POST /v1/actions/:id/submit` `{ signatures: Record<key, Hex> }` → `ActionResult`

```ts
type PreparedAction = {
  id: string;
  type: ActionType;
  expiresAt: string;                  // sign + submit before this (typically 10 min)
  summary: {
    title: string;                    // "Send $20.00 to Maya"
    lines: Array<{ label: string; value: string }>;  // e.g. { label: "From Burrow", value: "$60.00" }
    total: string;                    // base units the user pays
    fromBurrow: string;               // "0" unless the balance is short
    warnings: Array<{ code: string; message: string }>;  // e.g. RECIPIENT_RECENTLY_CHANGED
  };
  toSign: Array<{ key: string; typedData: TypedDataJson }>;
  /** What the app must verify before signing (defence against a compromised server). */
  expect: {
    payer: Hex; amount: string; payee?: Hex;
    directory?: DirectoryProof;
    terms?: { phoneKey: Hex; phoneEpoch: string; expiry: number; kind: number; giftId: Hex; salt: Hex };
  };
};

type ActionResult = {
  id: string;
  status: "completed" | "waiting" | "failed";
  receipt?: Receipt;
  claimLink?: string;          // https://bilbypay.com/c/<code> — share sheet text/URL
  giftCardId?: string;         // gift_buy
  error?: { code: string; message: string };
};

type Receipt = {
  reference: string;           // short human ref, e.g. "BP-7K2Q-9XMA"
  amount: string;
  counterparty?: { name: string; phoneMasked?: string };
  at: string;
  technical?: { txHash: Hex; explorerUrl: string };  // diagnostics only; never shown/shared in consumer flows
};
```

App-side check before signing (required): for each typedData, `message.from` / `message.owner` / `message.user`
equals the account; for payment authorizations `message.value` ≤ `expect.amount`; for `send` to a registered
contact, `message.to` equals the resolved `address`. The app independently reads the pinned directory through
its configured RPC and checks recipient, revision, ownership epoch, expiry and pending state before signing.
The server checks again before submission. The signed payment destination remains fixed: a changed binding
requires another recipient review and fresh signatures; it is never silently substituted.
Escrow authorization nonces bind `BilbyEscrow.Terms.v2`, including the exact `uint64 phoneEpoch` immediately
after `phoneKey`; the app recomputes the nonce. Directory checks narrow the review/submission race but do
not make a direct token transfer dynamically resolve a phone at execution.

### Action types

| type | params | toSign keys | on submit |
|---|---|---|---|
| `send` | `{ phone, amount, note? }` | `payment` (TransferWithAuthorization → recipient, or ReceiveWithAuthorization → escrow with terms nonce), `burrowPermit`? (stataAUSD permit to router, only if balance short) | registered → `AUSD.transferWithAuthorization` (or `router.topUpAndCall`); invite → `escrow.depositWithAuthorization` (or via router). Result `completed` (registered) or `waiting` + `claimLink` (invite). |
| `gift_send` | `{ phone, brandId? /*null = recipient's choice*/, amount, message?, design? }` | `payment` (ReceiveWithAuthorization → escrow, kind GIFT), `burrowPermit`? | escrow GIFT deposit → `waiting` + `claimLink`. Card is bought only when claimed. |
| `gift_buy` | `{ brandId, amount }` | `payment` (TransferWithAuthorization → treasury), `burrowPermit`? | relay payment, then buy the card from the provider float. `completed` + `giftCardId`. If the purchase fails the server refunds the user automatically (treasury → user) and returns `failed` with `GIFT_UNAVAILABLE`. |
| `cancel` | `{ activityId }` | `cancel` (BilbyEscrow Cancel) | `escrow.cancel` → `completed`. |
| `burrow_autosave` | `{ enabled, threshold }` | `autoSave` (SetAutoSave), `ausdPermit` (AUSD permit to router: max if enabling, 0 if disabling) | `router.setAutoSave`, then an immediate sweep if enabling. |
| `burrow_add` | `{ amount }` | `payment` (ReceiveWithAuthorization → router) | `router.addWithAuthorization`. |
| `burrow_withdraw` | `{ amount }` | `burrowPermit` | `router.breakToBalance`. `BURROW_BUSY` if > availableNow. |

`amount` params are base-unit strings. Share-permit value = `previewWithdraw(shortfall)` + 0.1% headroom.

## Activity

### 🔒 `GET /v1/activity?cursor=` → `{ items: ActivityItem[], nextCursor?: string }`
```ts
type ActivityItem = {
  id: string;
  kind: "sent" | "received" | "gift_sent" | "gift_received" | "gift_bought" | "burrow_in" | "burrow_out" | "refund";
  status: "completed" | "waiting" | "refunded" | "cancelled" | "failed";
  amount: string;
  counterparty?: { name: string; phoneMasked?: string };
  note?: string;
  giftCardId?: string;
  claimLink?: string;          // waiting sends/gifts — "Share again"
  canCancel?: boolean;
  expiresAt?: string;          // waiting — "Returns to you on Oct 20 if not opened"
  receipt?: Receipt;
  createdAt: string;
}
```

## Claims (recipient)

### `GET /v1/claims/:code` (public)
```ts
{
  code: string;
  kind: "money" | "gift";
  amount: string;
  senderName: string;
  note?: string;
  gift?: { brandId: string | null; brandName?: string; brandLogoUrl?: string; brandArtworkUrl?: string; design?: string; message?: string };
  status: "waiting" | "opened" | "returned";
  expiresAt: string;
  phoneMasked: string;         // "+1 •••• 0123" so the recipient knows which number to verify
}
```

### 🔒 `POST /v1/claims/:code/accept`
`{ phoneToken, brandId? }` — caller must be signed in (session) **and** hold a phoneToken for the claim's number
(`WRONG_PHONE` otherwise). If the account isn't registered to that number yet, the app calls
the registration prepare/submit flow first. Server: verifier signs `Claim`, relayer calls `escrow.claim`; for gifts the treasury
receives the money and the server buys the card (brand from params when recipient's choice).
→ `{ status: "completed", amount, giftCardId?, receipt }`.
The contract requires an active directory binding to this recipient, no live recovery, an unexpired deposit,
and the same phone epoch committed when the sender paid. Reassignment or revocation therefore cannot hand
an older pending payment to a new number holder. The sender can cancel it or recover it after expiry.

## Gift cards

### `GET /v1/giftcards/catalog?country=US` (public)
```ts
{ brands: Array<{
  id: string; name: string; logoUrl: string; artworkUrl?: string; category?: string; country: string;
  minAmount: string; maxAmount: string; denominations?: string[];  // fixed-value brands
  feePercent: number;            // folded into the price shown
  available: boolean;            // false when the float is low → "temporarily unavailable" before paying
}> }
```

### `POST /v1/giftcards/quote` (public) `{ brandId, amount }` → `{ brandId, amount, price: string /*what the user pays*/, available: boolean }`

### 🔒 `GET /v1/giftcards` → `{ cards: Array<{ id; brandId; brandName; logoUrl; artworkUrl?: string; amount; status: "ready" | "processing" | "failed"; createdAt; from?: string }> }`

`artworkUrl` is optional provider product artwork; `brandArtworkUrl` carries the same image on a gift claim. Display the supplied image without recoloring, cropping, or placing labels over it. Keep the product name and amount outside the artwork. Providers may supply a merchant mark on a background rather than a decorative card. Older cards and claims may have only `logoUrl`/`brandLogoUrl`; keep a logo or text fallback.

### 🔒 `GET /v1/giftcards/:id/reveal` → `{ code?: string; pin?: string; url?: string; barcode?: { format: string; value: string }; instructions?: string }`
Codes are decrypted only here, only for the owner, and never logged.

## Share links (not under /v1)

- `GET /c/:code` — HTML page with Open Graph tags (`og:title` "Arjun sent you $20", `og:image` `/og/:code.png`)
  and a button to open `bilbypay://claim/:code` or the store listing.
- `GET /og/:code.png` — 1200×630 PNG preview.
- `GET /.well-known/apple-app-site-association`, `GET /.well-known/assetlinks.json` — passkey + universal links.

## Top-up (stretch, Aurora Intents)

### 🔒 `GET /v1/topup/origins` → `{ origins: Array<{ id: string; label: string; symbol: string; networkLabel: string }> }`
### 🔒 `POST /v1/topup/quote` `{ originAsset: string /*e.g. "base:usdc"*/, amount }` →
`{ quoteId; depositAddress; depositMemo?; originAsset; amountIn; amountInBaseUnits; amountOut; minAmountOut; expiresAt; etaSeconds? }`
Errors carry the provider's plain-language message (`AMOUNT_TOO_LOW` adds the minimum).
> The provider can only deliver **USDC** on Monad, so top-ups are delivered to the BilbyPay treasury. Once the
> USDC is seen arriving on-chain, the server pays the user the same amount in AUSD (one treasury payment, never
> twice). Refunds go back to the user's own account on the origin network. Only origins where that is possible
> (EVM networks) are offered.
### 🔒 `GET /v1/topup/:quoteId` → `{ status: "waiting" | "processing" | "completed" | "failed" | "refunded"; message: string; amountOut?: string; refundedAmount?: string }` (owner only). `status` stays `processing` until the AUSD credit has been paid; `amountOut` is the credited amount.

## Card funding preview (Ramp sandbox)

This is separate from the cross-network top-up service above. It records practice checkout
sessions only; even a completed provider simulation never changes a Bilby balance.

- 🔒 `GET /v1/funding/options` returns availability, a setup/provider failure reason, US/USD,
  and current `minAmount` / `maxAmount` in six-decimal dollar units. Limits are `"0"` when unavailable;
  do not display them as valid purchase limits.
- 🔒 `POST /v1/funding/sessions` accepts `{ amount, returnUrl, idempotencyKey }` and returns
  an owner-scoped session. Retry the same request with the same key after an uncertain response.
- 🔒 `GET /v1/funding/sessions/:id` returns the owner's session with status `pending`, `processing`,
  `completed`, `failed`, `cancelled`, or `expired`. Returning from checkout is not payment evidence.
- `POST /v1/funding/webhooks/ramp/:id` accepts only cryptographically verified Ramp demo callbacks,
  bound to that session's unique receiver, asset, amount, and provider purchase.

Production funding cannot be enabled by changing the environment mode. See
[Ramp sandbox setup](ramp-sandbox.md) for required configuration and verification limits.

## Implementation notes (server behaviour beyond the shapes above)

- `BURROW_BUSY.availableNow`: for payments it is balance + what Burrow can release now ("you can pay $X now");
  for `burrow_withdraw` it is Burrow's `maxWithdraw` only.
- `POST /v1/claims/:code/accept` for a gift whose purchase fails after the claim returns `completed` with
  `error: { code: "GIFT_UNAVAILABLE" }`; the money is paid to the recipient's balance instead.
- A failed `gift_buy` returns `failed` with `giftCardId` and `receipt`; the refund appears as a `refund` activity item.
- Recipient's-choice gifts (`gift_send` without `brandId`): the sender pays face value plus the highest catalog fee;
  whatever the chosen card doesn't use goes to the recipient's balance. `GET /v1/claims/:code` shows face value as `amount`.
- Signed messages accept the account in checksummed or lowercase form.
- All deadlines/expiries use chain time.

## Health
`GET /health` → `{ ok: true, chainId, block, relayerBalance, treasuryFloat }`
