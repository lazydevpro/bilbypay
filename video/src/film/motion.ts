/**
 * The film's motion vocabulary. Everything moves through one of these; nothing is linear.
 *
 * Time here is beats (see `cues.ts`), so a move written as "0.5 beats" stays on the music at
 * any tempo. Springs are the exception — they are physics and run in seconds, so an arrival
 * feels the same weight whatever the track.
 */

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(Math.max(v, lo), hi)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const easeIn = (t: number) => t * t * t
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
/** Fast out of the gate and a long, soft landing — the camera's move. */
export const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
export const expoInOut = (t: number) =>
  t <= 0
    ? 0
    : t >= 1
      ? 1
      : t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2

/** 0 → 1 across [from, to], eased. Holds at either end. */
export function span(
  beat: number,
  from: number,
  to: number,
  ease: (t: number) => number = easeInOut,
) {
  return ease(clamp((beat - from) / (to - from)))
}

/** 1 inside [from, to] with soft edges, 0 outside. For things that come and go. */
export function during(beat: number, from: number, to: number, fadeIn = 0.4, fadeOut = 0.4) {
  return Math.min(
    span(beat, from, from + fadeIn, easeOut),
    1 - span(beat, to - fadeOut, to, easeIn),
  )
}

/**
 * A damped spring, solved exactly rather than stepped, so a fractional frame is as valid as a
 * whole one. `w` is stiffness (natural frequency, rad/s), `z` the damping ratio: below 1
 * overshoots and settles, 1 lands without overshoot.
 */
export function spring(seconds: number, { w = 12, z = 0.75 }: { w?: number; z?: number } = {}) {
  if (seconds <= 0) return 0
  if (z >= 1) return 1 - Math.exp(-w * seconds) * (1 + w * seconds)
  const wd = w * Math.sqrt(1 - z * z)
  return (
    1 -
    Math.exp(-z * w * seconds) * (Math.cos(wd * seconds) + ((z * w) / wd) * Math.sin(wd * seconds))
  )
}

/** A cheap, stable pseudo-random in [0, 1) — the same particle lands in the same place every render. */
export function rand(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Linear blend between two hex colours. */
export function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const k = clamp(t)
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * k)
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}
