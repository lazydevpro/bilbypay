# BilbyPay — "Your number"

**Launch film · ~75 s on a licensed Pixabay track · motion graphics · one continuous shot · 16:9 (plus a 30 s cut)**

Built: `video/src/film/` → `cd video && npx remotion render Film-launch-vo out/bilbypay-launch-raw.mp4`, then `ffmpeg -i out/bilbypay-launch-raw.mp4 -c:v copy -af alimiter=limit=0.82:level=false -c:a aac -b:a 192k out/bilbypay-launch.mp4`

Status: **rendered 2026-10-13**: `video/out/bilbypay-launch.mp4` (87.3 s, 1080p, −15.6 LUFS, peak −1.2 dBFS), `video/out/bilbypay-ad-30s.mp4` (27.7 s), `video/out/thumbnail-hook.png`, `video/out/thumbnail-brand.png`. Music: MaksymMalko "Product Launch Advertising Music" (Pixabay), 109.95 BPM, edits in `video/src/film/tracks.ts`. Voice: one AI Studio take (Gemini 3.8 Flash TTS, Sulafat, custom style, `<sigh>`/`<chuckle>`/`<short pause>`), cut by `video/scripts/cut-take.mjs`. Mix check: voice median 9.2 LU over the ducked music, lowest 6.2.

---

## Brief

| | |
|---|---|
| Objective | A judge who has never heard of BilbyPay can say, after one watch: "you send dollars to a phone number, it's instant, no crypto stuff" — and wants to try the beta |
| Audience | Monad Metropolis judges (mostly investors) and the public; smart, crypto-literate, watching once, often muted |
| Plays on | Hackathon pitch video (first ~75 s, then the founder on camera), the optional 30 s ad, X; 16:9; works muted (captions carry it) |
| Problem | Paying someone in crypto means asking for a 42-character address, guarding a seed phrase and holding a gas token. Normal people won't do that |
| What it is | A mobile wallet on Monad where your phone number is your wallet |
| How it works | Pick a contact → type an amount → confirm with your face or fingerprint → it lands in about two seconds; the network fee is covered |
| Features | **Pay anyone** (claim link; refunds if never claimed) — *the differentiator, with the phone number itself* · gift cards by text · Burrow (spare money tucked away, back when you need it) · passkey instead of a seed phrase |
| Adds up to | Payments that feel like texting; settled on Monad in under a second for under a cent. Only true numbers: Monad finality ~0.6 s (docs.monad.xyz), our measured send ≈ 2–2.5 s end to end, fees sub-cent and covered |
| Constraints | Testnet beta, **not audited**, test money only — said on screen at the end. No yield/return figures for Burrow. No "instant" claims we didn't measure |
| Call to action | "Try the beta" → bilbypay.pages.dev (web app + Android APK) |
| Voice & music | Warm, calm, slightly playful narrator (Google AI Studio / Gemini TTS, one take). Bright, upbeat, playful track with a clear drop (Pixabay Content License) |

## The idea

Crypto made money global and then made it impossible to hand to a friend. The loop the viewer
is stuck in: copy an address, check it, fear one wrong character. BilbyPay breaks it by turning
the thing everyone already shares, a phone number, into the wallet.

**The protagonist:** Bilby, the mascot, carrying one coin-sized dollar. It's in the app (the
companion and the poses you'll meet again), it has states (lost in the address soup → waving
hello → running with the money → handing it over → tucking it away → asleep, money safe), it
can multiply (a crowd of contacts), and its face *is* the logo.
Arc: buried under a 0x address → pops out waving → runs the money to a number → gifts → saves →
falls asleep → contracts into the app icon.

*Alternative considered:* the phone-number chip ("+91 98··· ··210") as the hero — it multiplies
nicely into a contacts grid, but it can't carry emotion or become the logo. It stays as the
prop Bilby carries the money to.

## The flow

```
 PROBLEM   Ink. A 42-character 0x address crawls across the frame, then a seed-phrase word
           grid, then a red "insufficient gas" chip. They pile up. Music hard-stops.
           "Paying someone in crypto still means a long address, a seed phrase to guard,
            and a gas token you don't have."
                     │  the pile collapses into one small chip: a phone number
 TURN      On the drop, the chip pops and Bilby jumps out of it, waving (hello animation).
           "What if their phone number was enough?"
                     │  push-in on Bilby's face → it becomes the app icon
 WHAT      Icon + wordmark. Caption: Your number is your wallet.
           "This is BilbyPay. Your number is your wallet."
                     │  icon shrinks into a phone screen (the app's Home)
 HOW       On the phone: contact list → Priya → $20 → fingerprint ↔ Face ID → ✓ Sent.
           Bilby runs the coin from one side to Priya's number.
           "Pick a contact. Type an amount. Confirm with your face or fingerprint."
           "It lands in about two seconds, and the network fee is on us."
                     │  lift-out: the "Sent" check flies off the phone and becomes a chat bubble
 FEATURES  Pay anyone: a chat with a claim-link card; Bilby receiving.
           "Not on BilbyPay yet? Send it anyway. They get a link, and if they never claim it,
            it comes back to you."
                     │  the link card flips into a gift card
           Gifts: Bilby holding a wrapped gift.
           "Send a gift card the same way. It opens right inside the app."
                     │  the gift's box becomes a burrow hole
           Burrow: a "Keep $50" line on the balance; $120 arrives and the $70 above the line hops
           into a burrow (Bilby pats the soil). Then pay $80 with $50: $30 hops back out, joins the
           $50, one fingerprint, one tick. Footnote on this frame only.
           "Set the amount you want to keep handy."
           "Anything above it tucks itself away into your savings burrow, where it can earn while it rests."
           "Pay more than you have, and Bilby Pay pulls the difference straight back out, in the same tap."
                     │  pull-back: the burrow is one of many phones in a crowd
           No seed phrase: a passkey glyph on each phone.
           "No seed phrase to lose. Your passkey is the key."
                     │  multiply: phones → a grid of contacts lighting up
 ADDS UP   Grid of contacts pulsing with payments; captions 0.6 s · < 1¢.
           "Built on Monad, every payment settles in under a second, for less than a cent."
                     │  the grid contracts into one: Bilby curls up asleep, money safe
 PAYOFF    Bilby asleep → contracts into the app icon → wordmark, CTA, legal line.
           "BilbyPay. Money that just works. Try the beta today."
```

## Rules

1. One thing on screen: one object, at most one line of type.
2. Never cut. Every section hands an object to the next.
3. The hero object fills at least half the frame height.
4. The picture explains, the words confirm.
5. Background: **ink** while the viewer is stuck with crypto; **ivory** from the moment Bilby
   arrives; ink again only under the final logo.
6. The music cuts the film: everything lands on a beat.

## The hand-offs

| From | Object | Becomes | Move |
|---|---|---|---|
| Problem → Turn | pile of address/seed/gas chips | one phone-number chip | collapse (all chips shrink to the chip's size and position) |
| Turn → What | Bilby's face | app icon | push-in to become |
| What → How | app icon | phone screen (Home) | contract into the app's icon on a phone, camera pulls back |
| How → Pay anyone | "Sent" check | chat bubble with claim card | lift-out |
| Pay anyone → Gifts | claim card | gift card | flip |
| Gifts → Burrow | gift box | burrow hole | morph |
| Burrow → Passkey | burrow scene | one phone of many | pull-back to reveal |
| Passkey → Adds up | phones | contacts grid | multiply |
| Adds up → Payoff | grid | Bilby asleep → icon | contract |

## Every word on screen

```
0x5f3A…e91C… (address crawl)      apple · river · tiger · … (seed words)      Insufficient gas
+91 98··· ··210
Your number is your wallet.
Priya · $20 · Sent ✓ 2.3 s
You've got $24.50 · Tap to claim
Gifts, delivered by text.
Keep $50 · Burrow · $30 from Burrow
Variable rate via Aave on mainnet. Testnet beta uses a stand-in. Not a guaranteed return.
No seed phrase.
0.6 s to final · < 1¢ per payment
Money that just works.
Try the beta · bilbypay.pages.dev
Beta on Monad testnet. Test money only. Not audited.
```

## Voiceover

Write it for the TTS exactly as below (one take, one request). "BilbyPay" is written "Bilby Pay"
so the voice says it as two words.

| # | Section | Voice |
|---|---|---|
| 1 | Problem | Paying someone in crypto still means a long address, a seed phrase to guard, and a gas token you don't have. |
| 2 | Turn | What if their phone number was enough? |
| 3 | What | This is Bilby Pay. Your number is your wallet. |
| 4 | How | Pick a contact. Type an amount. Confirm with your face or fingerprint. |
| 5 | How | It lands in about two seconds, and the network fee is on us. |
| 6 | Pay anyone | Not on Bilby Pay yet? Send it anyway. |
| 7 | Pay anyone | They get a link to claim it, and if they never do, it comes back to you. |
| 8 | Gifts | Send a gift card the same way, and it opens right inside the app. |
| 9a | Burrow | Set the amount you want to keep handy. |
| 9b | Burrow | Anything above it tucks itself away into your savings burrow, where it can earn while it rests. |
| 9c | Burrow | Pay more than you have, and Bilby Pay pulls the difference straight back out, in the same tap. |
| 10 | Passkey | No seed phrase to lose. Your passkey is the key. |
| 11 | Adds up | Built on Monad, every payment settles in under a second, for less than a cent. |
| 12 | Payoff | Bilby Pay. Money that just works. |
| 13 | CTA | Try the beta today. |

~175 words ≈ 65 s of speech in a ~80 s film, leaving the drop and the final hits to the music.

Coverage: ☑ problem ☑ what it is ☑ how it works ☑ each feature (pay anyone, gifts, Burrow,
passkey) ☑ why it's different (number as wallet, claim + refund, no seed phrase, fee covered)
☑ what it adds up to ☑ where to get it

Burrow is said "your Burrow" next to the burrow picture, because spoken it can sound like "borrow" (lending), the opposite meaning. Option: say "your savings burrow" in the voice, keep "Burrow" in the caption.

Honesty notes: "about two seconds" is our measured end-to-end send on the hosted API (2.3–2.5 s);
"under a second" is Monad's settlement (finality ~0.6 s), not our app round trip; no Burrow rate
or return is stated.

## Sound

- **Music:** one Pixabay track (Pixabay Content License: commercial use incl. promoting your
  own product, no attribution required; don't redistribute the track on its own). Candidates
  below; measured with `track-info.mjs` once downloaded, then cut: build under the problem,
  hard stop on "…you don't have.", drop on Bilby's jump, breakdown under the features, final
  hits on the logo.
- **Effects:** whoosh on the collapse, pop on Bilby's jump, tick per step on the phone, coin
  "ding" on Sent, paper flip on the gift, soft thud into the burrow, three hits on the logo.
- **Mix:** voice −12 LUFS · music ducks to 0.35 under each line · master −1 dB + limiter.
