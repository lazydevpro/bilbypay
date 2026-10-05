# Living Bilby implementation

## Screen direction

The character supports the task on each screen. Welcome has a doorway, a readable “Hello!” bubble and a raised-paw greeting. Home follows the device's local time, including a curled sleeping character at night. There is no scene picker.

| Context | Composition and character |
| --- | --- |
| Welcome | Doorway, reserved Hello bubble above the approved waving artwork |
| Home | Automatic meadow / evening nook / moonlit garden, varied placement |
| Unlock | Moonlit resting spot, horizontal sleeping artwork; quiet reviewing pose while opening |
| Profile setup | Personal name badge, small greeting; still while typing |
| Recipient search | Compact crouching Bilby with magnifier beside the search field |
| Amount entry | Recipient, amount and keypad take priority |
| Payment review | Compact seated checklist pose, still while checking details |
| Submission | Approved running pose only during the actual request |
| Receive | Personal QR ticket with letter-holding Bilby stamp |
| Gift catalog | Wrapping counter, kneeling gift pose |
| Gift composition | Illustrated occasion card, message and accurate quote |
| Saved gifts | Album composition and seated organizing pose in the empty state |
| Money claim | Open-letter composition; running while opening |
| Confirmed success | Raised arms, happy eyes and a short hop; actual receipt |
| Waiting result | Receiving pose and explicit waiting/sharing status |
| Burrow | Decorative plant and kneeling watering pose beside actual values |
| Activity | Receipt timeline; actual status and value remain primary |

The app renders the ten approved generated PNG illustrations from `app/assets/bilby-poses/` through `app/src/ui/Mascot.tsx`. The character is not redrawn or assembled from vector body parts. The matching design copies and exact original prompts are saved in `bilby-poses-2026-09-30/`.

Each pose retains its complete silhouette and illustrated props. Images use contain sizing in a square stage. The wider sleeping illustration has extra room on Home and unlock; its natural horizontal pose is not rotated. Burrow uses the plant already included in the saving PNG, without adding a second drawn pot. Decorative doorway, landscape and other scenery may use SVG independently of the character.

Four revised frame sheets are integrated for waving, running, gift wrapping and album organizing. They are saved in `app/assets/bilby-sprites/v2/`; exact generation prompts, source sheets and preparation notes are in [bilby-motion-v2/README.md](bilby-motion-v2/README.md). Wave has 36 frames at 24 fps, run has 32 at 32 fps, and gift/album each have 48 at 24 fps. All other moods use the corresponding generated pose PNG with their existing restrained transforms.

## Motion and financial state

- React Native `Animated` controls restrained breathing, nod and confirmation reactions around the approved artwork. It uses the native driver on mobile and the compatible JavaScript driver on web.
- Frame sheets use registered generated keyframes plus intermediate frames prepared offline. Exact atlas steps prevent sliding across neighboring cells. Playback waits for image loading, and its final phase shows the same frame as its starting phase. Static PNGs do not independently animate their eyes, ears or limbs.
- Active animation clocks and transforms are stopped and cleaned up when animation is disabled or the component leaves its active state.
- Animation requires foreground, visible tab, route focus, loaded preferences and system reduced motion off.
- Settings contains the persisted motion switch. Missing storage/accessibility state leaves Bilby still.
- Reduced motion keeps the corresponding illustration still. A preference or visibility change freezes the current sprite phase; initial loading uses a poster identical to frame zero. Resuming keeps the configured frame rate.
- Review is deliberately still. Pending/unknown/failed results never trigger a successful-payment celebration.
- No animation changes an amount, fabricated progress, or financial promise. The Burrow plant is decorative and never tied to an expected return.

## Consumer language

Consumer routes omit addresses, hashes, network/token selectors and technical disclosure panels. API errors are translated or safely replaced; financial review blocks if required detail cannot be presented safely. Add money currently points to receiving from a friend and explicitly says bank/card funding is unavailable. This UI work does not add a fiat funding integration.

## Verification after PNG and sprite integration

- Full app TypeScript check passed.
- Expo lint passed with no errors and five existing array-style warnings in `api/types.ts`, `copy/burrow.ts` and `signing/guard.test.ts`.
- 125 unit tests passed across 12 files, including authorization, copy guardrails, motion lifecycle, stepped atlas boundaries, playback timing, preferences and time boundaries.
- Android JavaScript/Hermes export succeeded with all ten pose assets, four v2 sprite sheets and four matching posters, with a pre-existing `@noble/hashes/crypto.js` package-export warning and Metro's file-resolution fallback. Export output: `/private/tmp/bilbypay-android-motion-v2`.
- Web artwork checked at 390 × 844; Burrow's amount and watering pose checked at 320 × 740. Current captures are in `reports/living-bilby-2026-09-30/`; rejected older vector captures are marked in its `superseded-vector/` folder.
- Revised Welcome artwork checked at 390 × 844 and its tap advances the loaded 1920 × 1920 v2 atlas in exact 232 px steps. Fresh browser preview reported no runtime errors. Interactive old/new comparisons, frame stepping and convenience GIFs are in `reports/bilby-motion-v2/`. Earlier motion preference verification turned motion off, checked Home at rest, and restored the preference.
- A simulated $10 gift purchase completed with its $0.25 fee, card details and updated $239.75 balance. The fresh browser preview reported no runtime errors. Completion uses a single navigation replacement to avoid competing stack actions.

Physical Android animation performance and biometrics have not been verified by these checks. The web flow uses only fictional demo data; no real money moves.

## Local web preview

Run from `app/` with dependencies installed:

```sh
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_URL=mock EXPO_PUBLIC_DEMO_KEY=1 node ../node_modules/expo/bin/cli start --web --localhost --port 8081
```

This is a simulated environment. Demo verification code: `000000`. The mock account data lives in memory and may reset when its module reloads during development.
