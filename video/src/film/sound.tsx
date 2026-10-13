import React from 'react'
import { Audio, Sequence, interpolate, staticFile } from 'remotion'
import { ARRIVE, BIO, BUBBLES, CARD_IN, CHIP_IN, COLLAPSE, CONTACTS, CONTRACT, CTA, DROP, FLIP, GAS_IN, GRID_IN, HITS, HOP, HOP_BACK, JUMP, LIFT, LOGO, NAME_IN, PAID, PAY_BTN, PULL, PUSH, RETURN, RUN, SEED_IN, SENT, TAP_PRIYA, TO_HOLE, TO_ICON, TO_PHONE, ZIPS, AMOUNT } from './cues'
import { FPS, filmFrames, framesPerBeat, type Track } from './tracks'
import type { Take } from './voice'

/**
 * Sound: the music, the film's own effects on top, and the voice.
 *
 * The effects are placed here, on the picture's cues, rather than mixed into the music — so
 * every whoosh and click stays on its moment whichever track is underneath. Generate the
 * one-shots with the skill's `scripts/sfx.mjs --out public/film/sfx` (`--list` says what each
 * is for). The voice is laid the same way: each line of the one take on its beat, with the
 * music ducked under it.
 */

type Hit = { at: number; sfx: string; volume: number }

export const HITS_LIST: Hit[] = [
  // Problem: each piece of crypto clutter lands; the pile collapses into one number.
  { at: 0.3, sfx: 'arrive1', volume: 0.45 },
  ...Array.from({ length: 12 }, (_, i) => ({ at: SEED_IN[0] + (i * (SEED_IN[1] - SEED_IN[0])) / 12, sfx: 'tick', volume: 0.22 })),
  { at: GAS_IN, sfx: 'pop', volume: 0.6 },
  { at: COLLAPSE[0], sfx: 'stop', volume: 0.6 },
  { at: CHIP_IN, sfx: 'ding', volume: 0.5 },
  // The turn: Bilby jumps out on the drop.
  { at: JUMP, sfx: 'pop', volume: 0.8 },
  { at: JUMP, sfx: 'sparkle', volume: 0.35 },
  { at: PUSH[0], sfx: 'fly', volume: 0.5 },
  { at: NAME_IN, sfx: 'cup', volume: 0.6 },
  // How: the icon becomes a phone; each step clicks; sent rewards.
  { at: TO_PHONE[0], sfx: 'swoosh', volume: 0.45 },
  { at: TAP_PRIYA, sfx: 'press', volume: 0.55 },
  { at: AMOUNT[0] + 0.5, sfx: 'click', volume: 0.5 },
  { at: AMOUNT[0] + 1.1, sfx: 'click', volume: 0.5 },
  { at: BIO[0], sfx: 'grab', volume: 0.4 },
  { at: SENT, sfx: 'cup', volume: 0.8 },
  { at: SENT, sfx: 'sparkle', volume: 0.35 },
  { at: RUN[1] - 0.3, sfx: 'ding', volume: 0.6 },
  // Anyone: the tick lifts into a chat; messages pop; the refund swooshes back.
  { at: LIFT[0], sfx: 'swoosh', volume: 0.5 },
  { at: BUBBLES, sfx: 'pop', volume: 0.45 },
  { at: BUBBLES + 0.8, sfx: 'pop', volume: 0.45 },
  { at: CARD_IN, sfx: 'ding', volume: 0.55 },
  { at: RETURN[0], sfx: 'swoosh', volume: 0.45 },
  { at: RETURN[1] - 0.3, sfx: 'ding', volume: 0.5 },
  // Gift: the card flips; into the burrow.
  { at: FLIP[0], sfx: 'bend', volume: 0.55 },
  { at: FLIP[1], sfx: 'sparkle', volume: 0.35 },
  { at: TO_HOLE[0], sfx: 'drop', volume: 0.55 },
  { at: ARRIVE, sfx: 'ding', volume: 0.5 },
  ...[0, 1, 2].map((i) => ({ at: HOP[0] + i * 1.1 + 1.6, sfx: 'drop', volume: 0.4 })),
  { at: PAY_BTN, sfx: 'press', volume: 0.5 },
  { at: HOP_BACK[1], sfx: 'pop', volume: 0.5 },
  { at: PAID, sfx: 'cup', volume: 0.75 },
  // Pull back to the phones, then the crowd.
  { at: PULL[0], sfx: 'fly', volume: 0.5 },
  { at: GRID_IN[0], sfx: 'streak', volume: 0.4 },
  ...Array.from({ length: 10 }, (_, k) => ({ at: ZIPS[0] + k * 0.85 + 1.4, sfx: 'tick', volume: 0.25 + k * 0.02 })),
  // End: everything contracts into Bilby asleep → the icon, three hits, the name.
  { at: CONTRACT[0], sfx: 'swoosh', volume: 0.45 },
  { at: TO_ICON[0], sfx: 'bend', volume: 0.45 },
  ...HITS.map((at) => ({ at, sfx: 'hit', volume: 0.85 })),
  { at: LOGO, sfx: 'cup', volume: 0.7 },
  { at: CTA, sfx: 'ding', volume: 0.4 },
]

const ramp = (f: number, from: [number, number], to: [number, number]) =>
  interpolate(f, from, to, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

/**
 * The whole mix, one fader: −1 dB. Loud hits on a hot commercial track peak just over 0 dBFS;
 * this keeps them under it without touching the balance. Check with `scripts/mix-check.mjs`.
 */
const MASTER = 0.89

/** How far the music comes down under the voice (about −9 dB), and how fast, in frames. */
const DUCK = 0.35
const DUCK_ATTACK = 4
const DUCK_RELEASE = 14

/** The music's level at a frame of the film: 1, or down to `DUCK` while a line is being said. */
function ducking(take: Take | null, fpb: number) {
  const spans = (take?.lines ?? []).map((line) => {
    const start = line.at * fpb
    return [start, start + line.speech * FPS] as const
  })
  return (frame: number) => {
    let under = 0
    for (const [start, end] of spans) {
      const inside = Math.min(
        ramp(frame, [start - DUCK_ATTACK, start], [0, 1]),
        ramp(frame, [end, end + DUCK_RELEASE], [1, 0]),
      )
      under = Math.max(under, inside)
    }
    return 1 - (1 - DUCK) * under
  }
}

function Voice({ take, fpb }: { take: Take; fpb: number }) {
  return (
    <>
      {take.lines.map((line) => (
        <Sequence
          key={line.src}
          from={Math.max(0, Math.round(line.at * fpb - line.lead * FPS))}
          durationInFrames={Math.ceil(line.seconds * FPS) + 1}
        >
          <Audio src={staticFile(line.src)} volume={MASTER} />
        </Sequence>
      ))}
    </>
  )
}

function Music({ track, duck }: { track: Track; duck: (frame: number) => number }) {
  const src = track.src
  if (!src) return null
  const total = filmFrames(track.bpm)
  const fpb = framesPerBeat(track.bpm)
  const gain = track.gain ?? 1
  return (
    <>
      {track.edits.map((edit, i) => {
        if (edit.from === null) return null
        const start = Math.round(edit.beat * fpb)
        const next = track.edits[i + 1]
        const length = (next ? Math.round(next.beat * fpb) : total) - start
        // Every edit is a hard cut, with a couple of frames either side so it does not click.
        // The last one fades out over the tail instead of cutting.
        const level = (f: number) =>
          (i === 0 ? 1 : ramp(f, [0, 2], [0, 1])) *
          (next
            ? ramp(f, [length - 3, length], [1, 0])
            : ramp(f, [length - FPS * 2.5, length], [1, 0]))
        return (
          <Sequence key={i} from={start} durationInFrames={length}>
            <Audio
              src={staticFile(src)}
              trimBefore={Math.round(edit.from * FPS)}
              volume={(f) => MASTER * gain * level(f) * duck(start + f)}
            />
          </Sequence>
        )
      })}
    </>
  )
}

export function Sound({ track, take }: { track: Track; take: Take | null }) {
  const fpb = framesPerBeat(track.bpm)
  return (
    <>
      <Music track={track} duck={ducking(take, fpb)} />
      {take && <Voice take={take} fpb={fpb} />}
      {HITS_LIST.map((h, i) => (
        <Sequence key={i} from={Math.max(0, Math.round(h.at * fpb))} durationInFrames={FPS * 4}>
          <Audio src={staticFile(`film/sfx/${h.sfx}.wav`)} volume={MASTER * h.volume} />
        </Sequence>
      ))}
    </>
  )
}
