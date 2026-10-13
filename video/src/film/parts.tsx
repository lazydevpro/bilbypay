import React, { useId } from 'react'
import { easeIn, easeOut, span } from './motion'
import { BLUE, INK, SANS, SERIF } from './theme'

/**
 * The film's parts. Everything is laid out in a fixed 1920 × 1080 design space; the root
 * scales that to the output, so every number in the scenes is a pixel at 1080p.
 */

export const W = 1920
export const H = 1080
export const CX = W / 2
export const CY = H / 2

// ── Type ──────────────────────────────────────────────────────────────────────────────────

/** A line, as plain words and at most one accent word set in the serif. */
export type Words = (string | { accent: string })[]

/**
 * One line of type. Words rise out of a blur one after another and leave upward — the way
 * they would if the camera were moving past them, which is the only way anything leaves.
 * Where a line is on screen, the voice says it: keep this and `voice.ts` in step.
 */
export function Caption({
  beat,
  at,
  out,
  words,
  x = CX,
  y,
  size = 64,
  color = INK,
  align = 'center',
  stagger = 0.14,
  accent = BLUE,
}: {
  beat: number
  at: number
  out: number
  words: Words
  x?: number
  y: number
  size?: number
  color?: string
  align?: 'center' | 'left'
  stagger?: number
  /** Colour of the accent word (lighter on dark backgrounds). */
  accent?: string
}) {
  if (beat < at - 0.05 || beat > out + 0.7) return null

  const tokens: { text: string; accent: boolean }[] = []
  for (const part of words) {
    const text = typeof part === 'string' ? part : part.accent
    for (const w of text.split(' ').filter(Boolean)) {
      tokens.push({ text: w, accent: typeof part !== 'string' })
    }
  }
  const leave = span(beat, out, out + 0.55, easeIn)

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: align === 'center' ? 'translate(-50%, -50%)' : 'translate(0, -50%)',
        whiteSpace: 'nowrap',
        color,
        fontFamily: SANS,
        fontWeight: 900,
        fontSize: size,
        letterSpacing: '-0.015em',
        lineHeight: 1.1,
      }}
    >
      {tokens.map((token, i) => {
        const t = span(beat, at + i * stagger, at + i * stagger + 0.85, easeOut)
        const opacity = t * (1 - leave)
        const dy = (1 - t) * size * 0.45 - leave * size * 0.4
        const blur = (1 - t) * 12 + leave * 12
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              marginRight: i === tokens.length - 1 ? 0 : '0.26em',
              opacity,
              transform: `translateY(${dy}px)`,
              filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
              ...(token.accent
                ? {
                    // BilbyPay accent: the display face, in blue (no italic in Dela Gothic One).
                    fontFamily: SERIF,
                    fontWeight: 400,
                    fontSize: size * 0.98,
                    letterSpacing: 0,
                    color: accent,
                  }
                : null),
            }}
          >
            {token.text}
          </span>
        )
      })}
    </div>
  )
}

// ── Light ─────────────────────────────────────────────────────────────────────────────────

/** A soft bloom of colour. The film's only gradient, and never a hard edge. */
export function Glow({
  x,
  y,
  r,
  color,
  opacity,
}: {
  x: number
  y: number
  r: number
  color: string
  opacity: number
}) {
  if (opacity <= 0.001) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, ${color}00 68%)`,
        opacity,
        pointerEvents: 'none',
      }}
    />
  )
}

/** Light falls off toward every edge, so the camera seems to move through space, not past a border. */
export function Vignette({ color, strength }: { color: string; strength: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 75% 70% at 50% 50%, ${color}00 55%, ${color} 100%)`,
        opacity: strength,
        pointerEvents: 'none',
      }}
    />
  )
}

// ── Camera ────────────────────────────────────────────────────────────────────────────────

/**
 * The camera. Children are laid out in frame space; this puts the focus (fx, fy) at the centre
 * of the frame at `zoom`. Every section change in the film is this moving, not a scene swapping.
 */
export function Camera({
  zoom = 1,
  fx = CX,
  fy = CY,
  children,
}: {
  zoom?: number
  fx?: number
  fy?: number
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: W,
        height: H,
        transformOrigin: '0 0',
        transform: `translate(${CX}px, ${CY}px) scale(${zoom}) translate(${-fx}px, ${-fy}px)`,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Directional motion blur. CSS blur is round; a moving camera smears along its direction, so
 * this is an SVG filter with separate x and y deviations — set them from the camera's speed in
 * pixels per frame (about a tenth of it reads right).
 */
export function Smear({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const id = useId().replace(/:/g, '')
  const sx = Math.min(Math.abs(x), 60)
  const sy = Math.min(Math.abs(y), 60)
  if (sx < 0.4 && sy < 0.4) return <>{children}</>
  return (
    <>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <filter id={`smear-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={`${sx} ${sy}`} />
        </filter>
      </svg>
      <div style={{ position: 'absolute', inset: 0, filter: `url(#smear-${id})` }}>{children}</div>
    </>
  )
}

// ── The protagonist ───────────────────────────────────────────────────────────────────────

/**
 * The example film's protagonist: a ring that closes. Replace it with the product's own object,
 * drawn by the product's own component where there is one. `progress` 0 → 1 draws it closed,
 * starting at twelve o'clock; the faint track is always there, so an open ring reads as a
 * promise not yet kept rather than as nothing.
 */
export function Ring({
  x,
  y,
  r,
  width,
  progress,
  color,
  track,
  opacity = 1,
}: {
  x: number
  y: number
  r: number
  width: number
  progress: number
  color: string
  track: string
  opacity?: number
}) {
  const c = 2 * Math.PI * r
  const size = 2 * r + width
  return (
    <svg
      width={size}
      height={size}
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        opacity,
        overflow: 'visible',
      }}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={width} />
      {progress > 0.001 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={`${c * Math.min(progress, 0.9999)} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  )
}
