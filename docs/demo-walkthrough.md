# Demo walkthrough (≤ 3 min)

Three Android screen recordings of one real session on Monad testnet (13 Oct 2026, 6:03–6:21 pm):
sign-up → $100 test grant → send $10 to a number not on BilbyPay → Starbucks gift card → add $20 to Burrow →
a $25.25 Target gift with $20 in the balance, the rest from Burrow.

## Files

- `video/out/bilbypay-demo.mp4`: **the submission cut**, 2:49, with the founder's voiceover (normalised to −16 LUFS,
  peak −1.5 dBFS) over the launch film's music, ducked under the voice (about −13 dB in pauses).
- `video/out/bilbypay-demo-silent.mp4`: 1920×1080, **2:49**, no audio. Intro card, the phone framed on paper
  with a chapter label per step, then an outro card with the beta link.
- `video/out/bilbypay-demo-vertical-silent.mp4`: the phone recording alone, 616×1280, 2:43, no audio.

## How it was cut

`video/scripts/demo-edit.mjs` (run in a folder holding `src/{c,b,a}.mp4`) takes the three recordings in order (c → b → a):

- every stretch where the screen is still for more than 0.7 s is cut down to 0.7 s (ffmpeg `freezedetect`),
  which removes about 70 s of waiting without any visible jump;
- the three failed fingerprint touches ("Not recognised") and two flashes of the prompt's red "!" are cut out.

Raw 237 s → 162.8 s of phone footage. The framing is the `Demo` composition (`video/src/demo/Demo.tsx`),
which reads the chapter times from `video/public/demo/edl.json`.

```bash
npx remotion render Demo out/bilbypay-demo-silent.mp4 --muted
```

## Voiceover timing

At about 2.5 words a second. Suggested lines; say them your way. When the voiceover's ready, it gets laid over
the silent cut with ffmpeg (or the `Demo` composition gets an `<Audio>`).

| # | Time | Length | On screen | Suggested line |
|---|---|---|---|---|
| | 0:00 | 2.5 s | Intro card | This is BilbyPay, running on Monad testnet. |
| 01 | 0:02.5 | 11 s | Sign up with your phone number | To sign up, I type my phone number and the code I'm texted. In test mode, the code is six zeros. |
| 02 | 0:13.8 | 5 s | Pick the name friends will see | Then I pick the name my friends will see. |
| 03 | 0:19.1 | 15 s | No seed phrase: your fingerprint signs | There's no seed phrase and no password. BilbyPay creates a passkey, so my fingerprint is what signs. Then I link my number, so money sent to it reaches this wallet. |
| 04 | 0:33.8 | 3 s | Start with test dollars | Testnet accounts start with a hundred test dollars. |
| 05 | 0:36.8 | 27 s | Send to any phone number | To pay someone, I just type their number. This one isn't on BilbyPay yet, and that's fine. Ten dollars, one look at the details, and I confirm with my fingerprint. No address, no gas. |
| 06 | 1:03.4 | 5 s | Not on BilbyPay? They get a link | They get a link to claim it. If they never open it, it comes back to me. |
| 07 | 1:08.0 | 30 s | Send a gift card | Gift cards work the same way. I pick Starbucks, fifty dollars and a little card, then choose who it's for by phone number. One fingerprint, and it's ready to share. |
| 08 | 1:38.4 | 19 s | Burrow: park what you don't need | Money I'm not using can sit in my Burrow, where it earns a rate that changes over time. I'll move twenty dollars in. I can move it back whenever I like. |
| 09 | 1:57.1 | 34 s | Pay more than you have | Now I have twenty dollars, and I want to send a twenty-five dollar Target gift card. BilbyPay offers to take the missing five twenty-five from my Burrow, in the same payment. One fingerprint again. |
| 10 | 2:31.3 | 14 s | Burrow covered the difference | The gift is sent. My balance is zero, and my Burrow covered the rest. |
| | 2:45.3 | 4 s | Outro card | BilbyPay. Try the beta at bilbypay dot pages dot dev. |
