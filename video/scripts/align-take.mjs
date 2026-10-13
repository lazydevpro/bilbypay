// Cut a one-take voiceover made outside the pipeline (e.g. AI Studio) into one clip per line.
//
// Comma pauses in a calm read are often as long as sentence pauses, so pause length alone can't
// place the cuts. Instead: count the syllables heard (peaks in the loudness envelope), count the
// script's syllables, and pick, by dynamic programming, the pause for each line boundary where the
// syllables heard so far best match the script's (scaled), preferring longer pauses.
// Prints each line's speaking rate so a bad cut stands out.
//
//   node --no-warnings scripts/align-take.mjs public/film/vo-take.wav public/film/vo/take
// Writes <outDir>/NN.wav and <outDir>/take.json (lines: text, src, lead, speech, seconds).
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { LINES } from '../src/film/voice.ts'

const [input, outDir] = process.argv.slice(2)
if (!input || !outDir) throw new Error('usage: align-take.mjs <take.wav> <outDir>')
mkdirSync(outDir, { recursive: true })

/** Syllables of expression tags read before a line, by line index (sigh, chuckle). */
const TAG = { 0: 1, 9: 2 }
const NOISE = process.env.NOISE ?? '-36dB'

const total = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input]).toString())

// ── Pauses
const raw = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${input}" -af silencedetect=noise=${NOISE}:d=0.12 -f null - 2>&1`]).toString()
const pauses = []
let open = null
for (const m of raw.matchAll(/silence_(start|end): ([0-9.]+)/g)) {
  if (m[1] === 'start') open = Number(m[2])
  else if (open !== null) { pauses.push({ s: open, e: Number(m[2]) }); open = null }
}
if (open !== null) pauses.push({ s: open, e: total })
const head = pauses[0] && pauses[0].s < 0.05 ? pauses.shift().e : 0
const tail = pauses.length && pauses.at(-1).e >= total - 0.05 ? pauses.pop().s : total
const cands = pauses.filter((p) => p.s > head && p.e < tail).map((p) => ({ ...p, mid: (p.s + p.e) / 2, dur: p.e - p.s }))

// ── Syllables heard: loudness peaks (10 ms frames, smoothed over 70 ms, ≥ 110 ms apart, prominent)
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', input, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 })
const FR = 160
const env = []
for (let o = 0; o + FR * 2 <= pcm.length; o += FR * 2) {
  let sum = 0
  for (let k = 0; k < FR; k++) { const v = pcm.readInt16LE(o + k * 2) / 32768; sum += v * v }
  env.push(Math.sqrt(sum / FR))
}
const sm = env.map((_, i) => { let a = 0, n = 0; for (let j = i - 3; j <= i + 3; j++) if (env[j] !== undefined) { a += env[j]; n++ } return a / n })
const peaks = []
for (let i = 1; i < sm.length - 1; i++) {
  if (sm[i] < 0.015 || sm[i] < sm[i - 1] || sm[i] < sm[i + 1]) continue
  let lo = sm[i]
  for (let j = Math.max(0, i - 12); j < i; j++) lo = Math.min(lo, sm[j])
  if (sm[i] - lo < 0.25 * sm[i]) continue
  if (peaks.length && i - peaks.at(-1) < 11) { if (sm[i] > sm[peaks.at(-1)]) peaks[peaks.length - 1] = i; continue }
  peaks.push(i)
}
const peakTimes = peaks.map((i) => i * 0.01)
const heardBefore = (t) => { let n = 0; for (const p of peakTimes) if (p < t) n++; return n }

// ── Script syllables: vowel groups per word (rough English), plus tags
const syl = (w) => {
  const x = w.toLowerCase().replace(/[^a-z]/g, '')
  if (!x) return /\d/.test(w) ? 1 : 0
  const g = x.replace(/(?<=[^aeiouy])e$/, '').match(/[aeiouy]+/g)
  return Math.max(1, g ? g.length : 1)
}
const sylls = LINES.map((l, i) => l.text.split(/\s+/).reduce((a, w) => a + syl(w), 0) + (TAG[i] ?? 0))
const cum = []
sylls.reduce((a, b, i) => (cum[i] = a + b), 0)
const scale = peakTimes.length / cum.at(-1)
console.log(`syllable peaks heard ${peakTimes.length}, script ${cum.at(-1)} (x${scale.toFixed(2)}), pauses ${cands.length}`)

// ── DP: boundary k (after line k) at candidate pause i
const K = LINES.length - 1
const N = cands.length
if (N < K) throw new Error(`only ${N} pauses for ${K} boundaries; try NOISE=-40dB`)
const INF = 1e18
const fit = (i, k) => { const d = heardBefore(cands[i].mid) - cum[k] * scale; return (d * d) / 3 }
const pause = (i) => 0.5 / Math.max(cands[i].dur, 0.05)
const cost = Array.from({ length: N }, () => Array(K).fill(INF))
const prev = Array.from({ length: N }, () => Array(K).fill(-1))
for (let i = 0; i < N; i++) cost[i][0] = fit(i, 0) + pause(i)
for (let k = 1; k < K; k++) for (let i = k; i < N; i++) for (let j = k - 1; j < i; j++) {
  if (cost[j][k - 1] === INF) continue
  const c = cost[j][k - 1] + fit(i, k) + pause(i)
  if (c < cost[i][k]) { cost[i][k] = c; prev[i][k] = j }
}
let best = -1, bestCost = INF
for (let i = K - 1; i < N; i++) if (cost[i][K - 1] < bestCost) { bestCost = cost[i][K - 1]; best = i }
const picks = []
for (let i = best, k = K - 1; k >= 0; i = prev[i][k], k--) picks.unshift(cands[i])

// ── Cut
const AIR = 0.08
const bounds = [{ s: head, e: head }, ...picks, { s: tail, e: tail }]
const lines = LINES.map((line, k) => {
  const from = Math.max(0, bounds[k].e - AIR)
  const to = Math.min(total, bounds[k + 1].s + AIR)
  const src = `${outDir.replace(/^public\//, '')}/${String(k + 1).padStart(2, '0')}.wav`
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-ss', from.toFixed(3), '-to', to.toFixed(3), '-af', 'afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse', `public/${src}`])
  const speech = bounds[k + 1].s - bounds[k].e
  return { at: line.at, text: line.text, src, lead: AIR, speech: +speech.toFixed(3), seconds: +(to - from).toFixed(3), takeAt: +bounds[k].e.toFixed(3) }
})
writeFileSync(`${outDir}/take.json`, JSON.stringify({ voice: 'take', model: 'gemini-3.8-flash-tts (AI Studio, one take)', lines }, null, 2))
for (const [k, l] of lines.entries()) {
  const heard = heardBefore(bounds[k + 1].s) - heardBefore(bounds[k].e)
  console.log(`${String(k + 1).padStart(2)} ${l.takeAt.toFixed(2).padStart(6)}s ${l.speech.toFixed(2)}s  syl ${String(heard).padStart(2)}/${String(sylls[k]).padStart(2)}  ${(sylls[k] / l.speech).toFixed(1)} syl/s  ${l.text.slice(0, 58)}`)
}
console.log(`cost ${bestCost.toFixed(2)}`)
