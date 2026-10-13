// Cut the AI Studio take (public/film/vo-take.wav) into one clip per line at hand-checked times.
// Times come from the take's pause map (ffmpeg silencedetect at -40 dB) and, where two sentences
// ran together, the deepest dip in the loudness envelope (scripts/align-take.mjs explains why
// automatic alignment wasn't trusted for this take). Each line's speaking rate is printed as a
// sanity check: a wrong cut shows up as an implausibly fast or slow line.
//
//   node --no-warnings scripts/cut-take.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { LINES } from '../src/film/voice.ts'

/** [start, end] of each line's speech in the take, seconds. */
const SPANS = [
  [0.3, 7.96], // <sigh> Paying someone in crypto…
  [8.26, 10.33], // What if their phone number was enough?
  [11.01, 12.5], // This is Bilby Pay.
  [12.83, 14.11], // Your number is your wallet.
  [14.68, 15.47], // Pick a contact.
  [15.76, 16.69], // Type an amount.
  [16.88, 18.69], // Confirm with your face or fingerprint.
  [19.03, 22.77], // It lands in about two seconds…
  [23.46, 24.59], // Not on Bilby Pay yet?
  [24.92, 26.09], // <chuckle> Send it anyway.
  [26.28, 29.79], // They get a link to claim it…
  [30.36, 33.77], // Send a gift card the same way…
  [34.3, 36.55], // Set the amount you want to keep handy.
  [36.98, 41.88], // Anything above it tucks itself away…
  [42.17, 47.42], // Pay more than you have…
  [47.83, 49.73], // No seed phrase to lose.
  [50.06, 51.37], // Your passkey is the key.
  [51.99, 57.0], // Built on Monad…
  [57.6, 58.18], // Bilby Pay.
  [58.83, 61.11], // Money that just works.
  [61.55, 62.43], // Try the beta today.
]
if (SPANS.length !== LINES.length) throw new Error(`${SPANS.length} spans for ${LINES.length} lines`)

const input = 'public/film/vo-take.wav'
const dir = 'film/vo/take'
mkdirSync(`public/${dir}`, { recursive: true })
const AIR = 0.08
const syl = (w) => {
  const x = w.toLowerCase().replace(/[^a-z]/g, '')
  const g = x.replace(/(?<=[^aeiouy])e$/, '').match(/[aeiouy]+/g)
  return x ? Math.max(1, g ? g.length : 1) : 0
}
const lines = LINES.map((line, k) => {
  const [s, e] = SPANS[k]
  const from = Math.max(0, s - AIR)
  const to = e + AIR
  const src = `${dir}/${String(k + 1).padStart(2, '0')}.wav`
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-ss', from.toFixed(3), '-to', to.toFixed(3),
    '-af', 'afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse', `public/${src}`])
  const speech = +(e - s).toFixed(3)
  const n = line.text.split(/\s+/).reduce((a, w) => a + syl(w), 0)
  console.log(`${String(k + 1).padStart(2)} ${speech.toFixed(2)}s ${(n / speech).toFixed(1)} syl/s  ${line.text.slice(0, 64)}`)
  return { at: line.at, text: line.text, src, lead: s - from, speech, seconds: +(to - from).toFixed(3) }
})
writeFileSync(`public/${dir}/take.json`, JSON.stringify({ voice: 'take', model: 'gemini-3.8-flash-tts · Sulafat (AI Studio, one take)', lines }, null, 2))
