# BilbyPay current product and UI audit

Date: 30 September 2026. Scope: source review and the existing 390 × 844 Expo Web screenshot set, captured with the mock API and demo key. This is evidence about what is implemented locally, not confirmation of live financial service availability. No app code was changed for this audit.

## Main finding

BilbyPay already has a useful payment core: phone-number recipients, biometric confirmation, gifts that can be opened by someone who has not joined, receipts, automatic returns, and a separate Burrow balance. The current interface presents these as a set of forms and rounded cards. The character is a repeated static picture rather than a companion that responds to a person's journey.

The requested mainstream payment experience also changes product scope. The current spec explicitly excludes fiat funding, cash-out, KYC, debit cards, and multiple currencies. Today, “Add money” asks the customer to send a stablecoin to a deposit address. This cannot become a Wise-like or PayPal-like funding flow through new copy or illustration alone. Evidence: `docs/plans/2026-09-25-bilbypay-spec.md:175`, `app/src/app/topup.tsx:85`, `packages/topup/README.md:3`.

## Current capabilities and screen inventory

The router defines the routes below in `app/src/app/_layout.tsx:24`; tab names are in `app/src/app/(tabs)/_layout.tsx:23`. The screenshot gallery contains 38 views because several routes have multiple steps or states. `_layout`, the root redirect, and the short `/c` redirect are not separate product screens.

| Area | Implemented routes / states | Useful capability to preserve |
|---|---|---|
| Arrival and access | Welcome, phone entry, verification code, create account, unlock | Phone is the public identity; passkey/biometrics protect money. Account creation does not ask for a seed phrase or address. |
| Home | Balance, Burrow summary, Send / Receive / Gift, Add money, recent activity | Clear amount hierarchy and direct access to money actions. |
| Sending | Recipient search/manual number, contacts permission, amount/note, confirmation, completion | Registered recipient and invitation recipient are handled differently. A recently changed account triggers an explicit check. |
| Receiving | Phone number, QR code, share number | QR opens a BilbyPay send link; it is not a crypto address. `app/src/app/receive.tsx:16`. |
| Claiming | Money invitation, gift invitation, optional brand choice, expired/already-opened/error states | Money waits for the intended number and can return if unopened. The app has a meaningful social/gifting moment to build around. |
| Activity | Feed, receipt, waiting/returned/cancelled/completed status, share claim link, cancel pending send | Human payment reference and plain status language already exist. `app/src/api/types.ts:74`, `app/src/app/activity/[id].tsx:72`. |
| Gift cards | Owned cards tab, catalog, brand/recipient-choice detail, amount, four card designs/message, buy for self or send, redemption detail | Card number, PIN, barcode, instructions, copy and provider redemption link. Real provider logo support exists. |
| Burrow | Overview, disclosure/how-it-works, add, move back, auto-save threshold, confirmation/completion | Optional earning balance; auto-save above a threshold; use Burrow for a payment shortfall after explicit confirmation. |
| Account | Profile, phone change, About/disclosures, logout | Basic account management. No customer support or account recovery troubleshooting surface was found in this screen set. |
| Add money | Origin selection, amount, time-limited deposit instructions, waiting/processing/completed/refunded | Current backend is a crypto deposit service, not a bank/card funding service. |
| Developer | Passkey test, account identifier, test payment/signature export | Development tool, guarded by `__DEV__` at the route. It should not appear in consumer demos. |

The action contract confirms the currently supported money actions: send, gift_send, gift_buy, cancel, burrow_autosave, burrow_add, burrow_withdraw (`app/src/api/types.ts:46`; `server/src/routes/money.ts:7`). Request money, bill splitting, bank payout, card funding, conversion, subscriptions, merchant checkout, loyalty rewards and quests are not present in that action model.

## What already works in the product direction

- The original principle is already “no crypto words in the UI” (`docs/plans/2026-09-25-bilbypay-spec.md:30`) and “choose → confirm with Face ID → done” (`:43`). The user's latest instruction removes previous exceptions to that principle.
- Registered recipients can be found by number; unregistered people receive an invitation instead of an address request. Money and gifts share the claim mechanism.
- The backend has idempotent preparation/submission, automatic gift failure returns, and plain language error mapping. These are valuable trust features underneath a playful design. See `server/src/errors.ts:23`, `server/src/errors.ts:103`, and `docs/launch-checklist.md:23`.
- Native haptics are already used for keypad changes, successful confirmation, claims and copy. See `app/src/ui/Keypad.tsx:18`, `app/src/app/confirm.tsx:66`, `app/src/app/claim/[code].tsx:84`, `app/src/app/card/[id].tsx:38`.
- Amounts are prominent, buttons use a 52-point minimum target, and text styles honor user text scaling (`app/src/ui/theme.ts:28`). These strengths should survive the redesign.
- Share sheet text, hosted claim landing copy and Open Graph titles are already expressed as money/gifts. They do not currently advertise the underlying chain (`app/src/flows/drafts.ts:79`; `server/src/share.ts:18`).

## Character and visual system audit

| Asset / implementation | Current state | Design implication |
|---|---|---|
| In-app mascot | `app/src/ui/Mascot.tsx:4` loads one `app/assets/bilby.webp`; `:7` only accepts a size; no emotion or action state. White circle always surrounds the art. | All situations show the same pose. The component cannot express welcome, concentration, success, reassurance, or a helpful hint. |
| Existing 2D art | `assets/mascot/bilby-2d.webp` and the app asset are both about 39 KB; the screenshots show the floppy-eared blue character with a red scarf. | This is the actual visual identity users have seen. |
| Newer 3D assets | `assets/mascot/3d/bilby.glb` about 12 MB; `bilby_lite.glb` about 4.8 MB. Rigged clips: Idle, Hello, Run, Hop, TailWag, Blink (`assets/mascot/3d/README.md:8`). | Existing work can accelerate motion tests, but the runtime is not integrated into the app. The mobile file size also deserves budgeting. |
| Character design drift | New previews show upright ears, peach features and no scarf; existing app art has floppy ears and a red scarf. `assets/mascot/blender/README.md:20` documents the newer form. | Decide which character is canonical before producing dozens of poses. Do not mix the two unintentionally. |
| Animation authoring | Blender source, rig bones and expression parts already exist; happy eyes/open mouth can be swapped (`assets/mascot/blender/README.md:39`). | Rendered transparent poses or short clips could reuse this pipeline. A runtime 3D engine is a separate engineering choice, not a prerequisite for good character behavior. |
| Palette | Sand, cream and brown dominate. Blue and scarf red are accent tokens (`app/src/ui/theme.ts:1`). | The UI scarcely uses the most memorable parts of the mascot palette. It feels muted and generic compared with the character. |
| Typography and components | System type scale, pill buttons, generic rounded cards, line icons, faint shadows. Buttons only change opacity when pressed (`app/src/ui/Button.tsx:55`). | No expressive brand typeface or tactile motion language; uniform geometry makes screens look like templates. |
| Character placement | Welcome, create, unlock, claim, done, Burrow, about and empty states reuse `Mascot`. Home includes it only when recent activity is empty (`app/src/app/(tabs)/index.tsx:70`). | The character literally disappears from the principal home experience once there is activity. It should have an ongoing role without obscuring balances or recipient identity. |
| Progress / reward model | No quests, badges, streaks, points, reward ledger, unlocks or character state were found in app/server feature code. | Gamification needs a defined behavior model and persistence, beyond decorating the same forms. |

Observed screenshot weaknesses (design judgments, not functional failures):

1. Home is a generic balance card, three identical action tiles and an empty feed. There is no personal story, helpful next step, changing scene or sense of progress. Evidence: `reports/web-screenshots-2026-09-30/08-home.jpg`.
2. Burrow is an amount/rate card with the same static mascot. Its name suggests a place, but nothing visually behaves like a place the character inhabits. Evidence: `16-burrow.jpg`.
3. Welcome and successful send use almost the same mascot pose/composition. The important emotional transitions receive no special character performance. Evidence: `01-welcome.jpg`, `30-send-done.jpg`.
4. Gift customization offers four emoji labels rather than a visible collection of illustrated cards. The selection screen feels administrative at the moment with the most potential for delight. Evidence: `33-gift-choice.jpg`; `app/src/ui/GiftDesign.tsx:6`.
5. The mock gift catalog has letter placeholders because every mock logo URL is blank (`app/src/api/mock.ts:69`), not because the app cannot display real logos (`app/src/ui/Avatar.tsx:29`). Improve demo data while designing the actual merchant surfaces.
6. A literal emoji is passed into the single-character BrandLogo fallback for “Let them choose” (`app/src/app/gifts/index.tsx:23`, `app/src/ui/Avatar.tsx:37`), producing a broken glyph in the screenshot. Use an actual icon/illustration for this concept.
7. Card and auto-save subtitles truncate at phone width, notably “temporarily unavaila…” and the Burrow description. More expressive styling must not further reduce room for practical information.
8. Confirmation and success for the typed recipient show “+1” as the person in the captured demo. The formatted number is used as a name (`app/src/app/send/index.tsx:70`), then split as a first name (`app/src/flows/drafts.ts:77`, `app/src/api/mock.ts:340`). Recipient verification should retain a real name plus full or appropriately masked number. This is a payment trust issue to fix before adding delight.
9. The shared claim landing/OG assets use another orange palette (`server/src/share.ts:64`, `server/src/share.ts:119`) with no mascot. The redesign must cover these external entry points too.

## Crypto exposure inventory

The following are the concrete consumer-visible leaks identified in the source. Identifiers used internally for signing/settlement are not leaks merely because they contain the word `address` or `chain`.

| Severity / surface | Evidence | Required response to the new brief |
|---|---|---|
| Critical: Add money origin list | `app/src/app/topup.tsx:154` renders server labels. Production labels are `${symbol} on ${networkLabel}` (`packages/topup/src/assets.ts:108`), e.g. USDC on Base / Arbitrum / Ethereum. Mock labels appear at `app/src/api/mock.ts:79`. | Replace the consumer funding method with actual supported bank/card/local payment rails. Until available, the demo must clearly use simulated money or a limited receive-only funding proposition; renaming a chain to a bank is false. |
| Critical: deposit instructions | `app/src/app/topup.tsx:85` says “Send exactly … {symbol}”; `:89` names the crypto account; `:94` names a network; `:95` screen-reader hint says “deposit address”; `:97` prints the address; `:101` can require a memo. | Remove this flow from the normal consumer experience when supported fiat funding replaces it. An opaque crypto deposit page behind another menu still violates the user's “anywhere” requirement. |
| High: receipt drilldown | `app/src/app/activity/[id].tsx:87` renders TechnicalDetails. `app/src/ui/TechnicalDetails.tsx:15` offers a drilldown, `:27` renders the transaction hash, and `:29` opens the explorer URL. | Customer receipt should use the existing BP reference, status, time, amount, recipient and support. Keep chain tracing in staff tooling. The done page currently shows only reference/time; do not mistakenly treat it as a current hash leak. |
| High: glossary escape hatches | Whole-file exclusions at `app/src/app/topup.tsx:1` and `app/src/ui/TechnicalDetails.tsx:1`; scanner returns early at `app/src/copy/glossary.ts:43`. The original spec allowed technical details (`docs/plans/2026-09-25-bilbypay-spec.md:67`). | Update the older rules and remove consumer exceptions. A passing current glossary test does not prove the new requirement is met. |
| Development/demo exposure | Settings shows Developer tools only in development (`app/src/app/(tabs)/settings.tsx:45`); `/dev/spike` checks `__DEV__` (`app/src/app/dev/spike.tsx:6`). The tool displays RP ID/chain, account identifier and test signing (`app/src/dev/Spike.tsx:42`). | The production route guard exists. Also keep developer navigation out of the consumer demo capture/build; do not claim this currently ships in production. |
| Dynamic copy boundary | `app/src/api/errors.ts:28` displays ApiError.message; top-up status at `app/src/app/topup.tsx:120` and confirmation summary at `app/src/api/types.ts:63` come from the backend. | Include API response copy, provider messages, accessibility text, deep links and share previews in acceptance checks. Static JSX scanning is insufficient. Current server errors deliberately map technical failures to human sentences (`server/src/errors.ts:103`; `packages/topup/src/errors.ts:18`). No raw on-chain error exposure was demonstrated by this audit. |

Good existing boundaries: no customer-facing account address on Home/Receive/Settings; no token selector in Send; human payment references already exist; passkey creation uses the RP name “BilbyPay” (`app/src/account.ts:36`). `Receipt.technical` may remain available to staff/backend tracing, but should not be passed into normal consumer views.

## Product gaps that styling cannot solve

| Mainstream expectation | Current evidence | Needed before promising it |
|---|---|---|
| Add money from a bank or card | Only origin-asset/deposit-address top-up contract (`app/src/api/types.ts:169`; `server/src/routes/topup.ts:14`). `packages/topup/README.md:3` explicitly describes cross-network stablecoin deposits. | Select operating market/corridor and regulated/payment partners; integrate permitted fiat funding, verification, failures, fees, refunds and reconciliation. |
| Cash out to a local bank | No payout action or bank account model in app action schema; fiat off-ramp explicitly out of scope in spec `:176`. | Payout partner, bank details, settlement estimates, tracking, failed/returned payout handling and support. “Move to balance” only moves Burrow money inside BilbyPay. |
| International transfer in local currencies | App is dollars-only; multi-currency excluded in spec `:176`. | Country/currency availability, FX quote with fees and recipient amount, destination payout, rate expiry and delivery estimates. Dollar balance plus an overseas phone number does not itself provide a Wise-like remittance corridor. |
| Customer support and payment problems | Settings lists only change number, Burrow, Add money, About, logout (`app/src/app/(tabs)/settings.tsx:40`). A top-up failure says “contact support” (`server/src/topup.ts:182`), but no in-app support entry exists. | Receipt-linked help, human payment reference, clear issue state, and a reachable support channel. |
| Account recovery confidence | Passkey re-login and change-number exist; live device reinstallation/recovery checks remain in checklist `docs/launch-checklist.md:20`. | Verify actual phone recovery behavior and document what to do if device/passkey is unavailable. Do not use mascot reassurance to cover an undefined recovery outcome. |
| Reliable payment status | Action/claim/refund model exists; launch checklist notes restart-during-submit manual reconciliation (`docs/launch-checklist.md:55`). | Reconciliation and robust processing states before treating every animation as settled success. |
| Rewards and progression | No reward state/action model found. | Define the desired user benefit, event triggers, durable state and anti-abuse rules. Cosmetic progress should remain distinct from the money ledger. |
| Goals | Burrow is one earning balance and threshold, not a collection of goal pots (`app/src/api/types.ts:31`). | A target/deadline/progress model if named goals are introduced. Multiple illustrated Burrows would otherwise imply functionality that does not exist. |
| Broad catalog and card availability | Provider adapters exist, but launch checklist still requires live provider accounts/smokes (`docs/launch-checklist.md:22`, `:46`). Catalog supports country, but current catalog screen does not expose a country selector (`app/src/app/gifts/index.tsx:16`). | Validate partner access, merchant/country availability, price/fees, redemption destinations and customer support before presenting polished merchandise as available everywhere. |

Burrow needs especially careful design treatment. Existing disclosures state that it is not a bank account, is not insured, has variable returns, and can incur loss or withdrawal delay (`app/src/copy/burrow.ts:5`). Those material facts should remain clear in normal language. Removing jargon does not mean disguising the nature or risk of the product. The literal “about N%” explanatory placeholder at `app/src/copy/burrow.ts:12` also deserves replacement with real explanatory copy.

The demo and production top-up catalogs also differ: the mock lists Solana, while the live server filters to EVM origin networks because it needs a compatible refund destination (`server/src/topup.ts:53`). Avoid implying the full mock set is proven live support.

## Recommended implementation boundary for the redesign

1. Preserve existing money workflows and trust controls while rebuilding the shared visual foundation: character states, palette, type, surfaces, icons, depth, tap feedback and motion.
2. Define one canonical Bilby design. Build a small state vocabulary first: welcome, idle, focused, carrying/sending, delivered, gift reveal, resting, reassuring. Match displayed state to actual payment status; no victory animation before success.
3. Make Home the companion's useful home base: visible balance and core actions first, one context-sensitive suggestion, and modest optional progress below. Current empty-state mascot should become a persistent, responsive companion.
4. Use gifts and optional goal progress as the strongest expressive surfaces. They already match the product's emotional strengths. Keep amount entry and final confirmation visually calm and unambiguous.
5. Treat support, receipts, invite landing pages, accessible labels, demo tooling and error states as part of the same redesign. Replace the receipt crypto drilldown with payment help/reference.
6. Plan fiat funding/cash-out as a separate product integration workstream with explicit markets and partner constraints. In research/prototypes, mark unimplemented rails as proposed; do not draw a polished bank funding screen and describe it as working.
7. Reward constructive setup and understanding—finishing verification, checking a recipient, learning a useful feature, setting a personal goal—without pressuring daily spending, larger transfers or greater exposure to Burrow. Persistent progression is new feature work.

## Evidence limits

- Screenshots are web renders of demo data, not verification of Android haptics, biometric dialogs, live financial rails or provider availability.
- Launch checklist evidence is dated 26 September 2026 and reports remaining mainnet/device/provider work. This audit did not rerun those checks.
- Read-only source and asset inspection was used. No secrets, .env values, or live customer records were needed.
