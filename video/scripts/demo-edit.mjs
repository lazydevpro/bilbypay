// Run from a folder holding src/{c,b,a}.mp4 (the three recordings, in session order).
// Cut the three phone recordings into one demo: drop fingerprint retries, cap every still
// stretch, speed up waits. Writes out/demo-vertical.mp4 (no audio) and out/edl.json.
//   node edit.mjs [cap=0.7]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const CAP = Number(process.argv[2] ?? 0.7) // seconds of each still stretch kept
const FPS = 30
const CLIPS = [
  { id: 'c', cuts: [], fast: [] },
  { id: 'b', cuts: [[5.8, 7.2], [48.2, 48.55], [48.8, 50.4], [95.95, 96.45]], fast: [] },
  { id: 'a', cuts: [[43.4, 45.4]], fast: [] },
]
// Chapters, in source time.
const CHAPTERS = [
  ['c', 0, 'Sign up with your phone number'],
  ['c', 16.8, 'Pick the name friends will see'],
  ['c', 26.5, 'No seed phrase: your fingerprint signs'],
  ['b', 9.5, 'Start with test dollars'],
  ['b', 12.5, 'Send to any phone number'],
  ['b', 58, 'Not on BilbyPay? They get a link'],
  ['b', 65.5, 'Send a gift card'],
  ['b', 109.5, "Burrow: park what you don't need"],
  ['a', 0, 'Pay more than you have'],
  ['a', 49, 'Burrow covered the difference'],
]

const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString())
const freezes = (f) => {
  const raw = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${f}" -vf freezedetect=n=0.003:d=${CAP} -an -f null - 2>&1`]).toString()
  const out = []
  let s = null
  for (const m of raw.matchAll(/freeze_(start|end): ([0-9.]+)/g)) {
    if (m[1] === 'start') s = +m[2]
    else if (s !== null) { out.push([s, +m[2]]); s = null }
  }
  if (s !== null) out.push([s, Infinity])
  return out
}
const subtract = (ranges, holes) => {
  let r = ranges
  for (const [hs, he] of holes) r = r.flatMap(([s, e]) => (he <= s || hs >= e ? [[s, e]] : [...(hs > s ? [[s, hs]] : []), ...(he < e ? [[he, e]] : [])]))
  return r
}

rmSync('seg', { recursive: true, force: true })
mkdirSync('seg', { recursive: true })
mkdirSync('out', { recursive: true })
const list = []
const edl = []
let t = 0
let n = 0
for (const clip of CLIPS) {
  const src = `src/${clip.id}.mp4`
  const dur = probe(src)
  const drop = freezes(src).map(([s, e]) => [s + CAP, Math.min(e, dur)]).filter(([s, e]) => e - s > 0.05)
  const keep = subtract(subtract([[0, dur]], clip.cuts), drop).filter(([s, e]) => e - s >= 1 / FPS)
  for (const [s, e] of keep) {
    const speed = clip.fast.find(([fs, fe]) => s >= fs && e <= fe)?.[2] ?? 1
    const out = `seg/${String(n++).padStart(4, '0')}.mp4`
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', s.toFixed(3), '-to', e.toFixed(3), '-i', src, '-an',
      '-vf', `setpts=(PTS-STARTPTS)/${speed},fps=${FPS}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', out])
    const len = probe(out)
    edl.push({ clip: clip.id, from: +s.toFixed(3), to: +e.toFixed(3), at: +t.toFixed(3), len: +len.toFixed(3) })
    t += len
    list.push(`file '${out.replace('seg/', '')}'`)
  }
}
writeFileSync('seg/list.txt', list.join('\n'))
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'seg/list.txt', '-c', 'copy', 'out/demo-vertical.mp4'])
const outAt = (clip, time) => {
  const e = edl.find((x) => x.clip === clip && time < x.to) ?? edl.at(-1)
  return +(e.at + Math.max(0, time - e.from)).toFixed(2)
}
const chapters = CHAPTERS.map(([c, s, title]) => ({ at: outAt(c, s), title }))
writeFileSync('out/edl.json', JSON.stringify({ cap: CAP, total: +t.toFixed(2), chapters, segments: edl }, null, 2))
console.log(`segments ${edl.length}, total ${t.toFixed(1)}s`)
for (const c of chapters) console.log(`${String(Math.floor(c.at / 60))}:${(c.at % 60).toFixed(1).padStart(4, '0')}  ${c.title}`)
