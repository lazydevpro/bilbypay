# BilbyPay API v1 (server ↔ app contract)

The single source of truth for `server/` and `app/`. Changing a shape here means changing both.

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
  `GIFT_PROCESSING` (409: card not ready to reveal yet). An expired `phoneToken` returns `OTP_EXPIRED`; a stale
  `issuedAt` on register/sign-in returns `ACTION_EXPIRED`. Unknown codes: show `message`.
- Idempotency: every `POST .../submit` is idempotent per action id — resubmitting returns the first result.
- EIP-712 payloads are sent as `TypedDataJson` (`@bilbypay/core`: `serializeTypedData` / `hydrateTypedData`);
  uint fields are decimal strings.

## Identity

`phoneKey = HMAC-SHA256(PHONE_PEPPER, E.164)` — computed only on the server; never sent to the app, never
on-chain in raw form. Phones are normalised to E.164 (`libphonenumber-js`), with the app sending its region as a hint.

### `POST /v1/otp/start`
`{ phone: string, region?: "US" }` → `{ ok: true, expiresInSeconds: 600 }`
Rate limit: 5 per phone per hour, 20 per IP per hour. In dev/test mode (`OTP_PROVIDER=test`) no SMS is sent and
the code is always `000000` for numbers starting `+1555` or any number when `OTP_TEST_ALL=1`.

### `POST /v1/otp/verify`
`{ phone, code }` → `{ phoneToken: string, phone: "+14155550123", phoneMasked: "+1 •••• 0123" }`
`phoneToken` is a short-lived (15 min) signed token carrying `phoneKey` + E.164. It proves the number; it **never** moves money.

### `POST /v1/accounts/register`
Links a verified number to a passkey account (new user, or an existing user changing number).
```
{ phoneToken, address, displayName, issuedAt: number /*unix s*/, signature: Hex }
```
`signature` = EIP-191 `personal_sign` by `address` of:
```
BilbyPay: link phone to this account
Phone: +14155550123
Account: 0xabc…
Issued: 1790000000
```
Server: checks token + signature (issuedAt within 5 min), verifier signs `Bind`, relayer submits
`BilbyDirectory.bind`, stores profile. → `{ sessionToken, profile: Profile }`.
If the number was bound to a *different* account before, the rebind is recorded (`reboundAt`) and senders will
see `recentlyChanged: true` for `REBIND_COOLDOWN_DAYS` (default 7).

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
  status: "registered" | "invite" | "invalid";
  displayName?: string;           // registered only
  address?: Hex;                  // registered only — for signing; the UI never shows it
  recentlyChanged?: boolean;      // number moved to a new account within the cooldown → warn sender
}> }
```
Rate limited (enumeration): 500 numbers per account per day.

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
  expect: { payer: Hex; amount: string; payee?: Hex };
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
  technical?: { txHash: Hex; explorerUrl: string };  // only behind "technical details"
};
```

App-side check before signing (required): for each typedData, `message.from` / `message.owner` / `message.user`
equals the account; for payment authorizations `message.value` ≤ `expect.amount`; for `send` to a registered
contact, `message.to` equals the resolved `address`.

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
  gift?: { brandId: string | null; brandName?: string; brandLogoUrl?: string; design?: string; message?: string };
  status: "waiting" | "opened" | "returned";
  expiresAt: string;
  phoneMasked: string;         // "+1 •••• 0123" so the recipient knows which number to verify
}
```

### 🔒 `POST /v1/claims/:code/accept`
`{ phoneToken, brandId? }` — caller must be signed in (session) **and** hold a phoneToken for the claim's number
(`WRONG_PHONE` otherwise). If the account isn't registered to that number yet, the app calls
`/v1/accounts/register` first. Server: verifier signs `Claim`, relayer calls `escrow.claim`; for gifts the treasury
receives the money and the server buys the card (brand from params when recipient's choice).
→ `{ status: "completed", amount, giftCardId?, receipt }`.

## Gift cards

### `GET /v1/giftcards/catalog?country=US` (public)
```ts
{ brands: Array<{
  id: string; name: string; logoUrl: string; category?: string; country: string;
  minAmount: string; maxAmount: string; denominations?: string[];  // fixed-value brands
  feePercent: number;            // folded into the price shown
  available: boolean;            // false when the float is low → "temporarily unavailable" before paying
}> }
```

### `POST /v1/giftcards/quote` (public) `{ brandId, amount }` → `{ brandId, amount, price: string /*what the user pays*/, available: boolean }`

### 🔒 `GET /v1/giftcards` → `{ cards: Array<{ id; brandId; brandName; logoUrl; amount; status: "ready" | "processing" | "failed"; createdAt; from?: string }> }`

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
> Today the service delivers **USDC** on Monad (AUSD isn't listed by the provider yet — see packages/topup/README.md).
### 🔒 `GET /v1/topup/:quoteId` → `{ status: "waiting" | "processing" | "completed" | "failed" | "refunded"; message: string; amountOut?: string; refundedAmount?: string }` (owner only)

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
