import React from 'react'
import { Img, staticFile, useCurrentFrame } from 'remotion'
import { BLUE, GOLD, GREEN, INK, MUTED, PAPER, SANS } from './theme'

/** The poses from the app/site (1122 × 1402 originals, sleeping 3:2). */
export type Pose = 'searching' | 'receiving' | 'gifting' | 'saving' | 'running' | 'sleeping'
const ASPECT: Record<Pose, number> = {
  searching: 1122 / 1402, receiving: 1122 / 1402, gifting: 1122 / 1402,
  saving: 1122 / 1402, running: 1122 / 1402, sleeping: 3 / 2,
}

/** One of Bilby's poses, centred on (x, y), `h` pixels tall. */
export function Bilby({ pose, x, y, h, opacity = 1, rotate = 0, flip = false }: {
  pose: Pose; x: number; y: number; h: number; opacity?: number; rotate?: number; flip?: boolean
}) {
  if (opacity <= 0.001) return null
  const w = h * ASPECT[pose]
  return (
    <Img
      src={staticFile(`film/img/${pose}.webp`)}
      style={{
        position: 'absolute', left: x - w / 2, top: y - h / 2, width: w, height: h, opacity,
        transform: `rotate(${rotate}deg) scaleX(${flip ? -1 : 1})`,
      }}
    />
  )
}

/**
 * Bilby waving hello: the site's 40-frame sprite (8 × 5, 360 × 402 cells), played forward then
 * back at 24 fps from the film's own frame, so every render is identical.
 */
export function Hello({ x, y, h, opacity = 1 }: { x: number; y: number; h: number; opacity?: number }) {
  const frame = useCurrentFrame()
  if (opacity <= 0.001) return null
  const order = [...Array(40).keys(), ...Array.from({ length: 38 }, (_, i) => 38 - i)]
  const f = order[Math.floor((frame * 24) / 30) % order.length]!
  const w = (h * 360) / 402
  return (
    <div
      style={{
        position: 'absolute', left: x - w / 2, top: y - h / 2, width: w, height: h, opacity,
        backgroundImage: `url(${staticFile('film/img/hello-atlas.webp')})`,
        backgroundSize: '800% 500%',
        backgroundPosition: `${((f % 8) / 7) * 100}% ${(Math.floor(f / 8) / 4) * 100}%`,
      }}
    />
  )
}

/** The app icon (app/assets/icon.png), as a rounded tile. */
export function AppIcon({ x, y, size, opacity = 1 }: { x: number; y: number; size: number; opacity?: number }) {
  if (opacity <= 0.001) return null
  return (
    <Img
      src={staticFile('film/img/icon.png')}
      style={{
        position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size,
        borderRadius: size * 0.23, opacity, boxShadow: `0 ${size * 0.05}px ${size * 0.12}px rgba(20,40,75,.25)`,
      }}
    />
  )
}

/** A pill of text: phone numbers, labels, errors. */
export function Chip({ x, y, children, bg = PAPER, color = INK, size = 34, opacity = 1, scale = 1, mono = false }: {
  x: number; y: number; children: React.ReactNode; bg?: string; color?: string; size?: number
  opacity?: number; scale?: number; mono?: boolean
}) {
  if (opacity <= 0.001) return null
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${scale})`, opacity,
        background: bg, color, borderRadius: 999, padding: `${size * 0.42}px ${size * 0.8}px`,
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : SANS, fontWeight: 800,
        fontSize: size, whiteSpace: 'nowrap', boxShadow: '0 10px 0 rgba(0,0,0,.18)',
      }}
    >
      {children}
    </div>
  )
}

/** A gold coin with a dollar label. */
export function Coin({ x, y, r = 46, label = '$', opacity = 1 }: { x: number; y: number; r?: number; label?: string; opacity?: number }) {
  if (opacity <= 0.001) return null
  return (
    <div
      style={{
        position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: '50%', opacity,
        background: `radial-gradient(circle at 35% 30%, #FFE08A, ${GOLD} 60%, #C9952B)`,
        boxShadow: `inset 0 0 0 ${r * 0.1}px #E0A93A, 0 ${r * 0.12}px 0 rgba(0,0,0,.18)`,
        display: 'grid', placeItems: 'center', color: '#7A5410', fontFamily: SANS, fontWeight: 900,
        fontSize: label.length > 2 ? r * 0.55 : r * 0.9,
      }}
    >
      {label}
    </div>
  )
}

/** A phone: rounded device around a paper screen. Children are laid out in screen space (w × h). */
export function Phone({ x, y, w = 430, h = 880, scale = 1, opacity = 1, children }: {
  x: number; y: number; w?: number; h?: number; scale?: number; opacity?: number; children?: React.ReactNode
}) {
  if (opacity <= 0.001) return null
  const bezel = 16
  return (
    <div
      style={{
        position: 'absolute', left: x - w / 2, top: y - h / 2, width: w, height: h, opacity,
        transform: `scale(${scale})`, borderRadius: 64, background: INK, padding: bezel, boxSizing: 'border-box',
        boxShadow: '0 30px 60px rgba(20,40,75,.28)',
      }}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 50, background: PAPER, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '50%', top: 14, width: 110, height: 30, borderRadius: 20, background: INK, transform: 'translateX(-50%)' }} />
        {children}
      </div>
    </div>
  )
}

/** Face ID and fingerprint glyphs (the landing page's, scaled). */
export function FaceGlyph({ size = 120, color = INK }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={color} strokeWidth={4} strokeLinecap="round">
      <path d="M6 20V12a6 6 0 0 1 6-6h8M44 6h8a6 6 0 0 1 6 6v8M58 44v8a6 6 0 0 1-6 6h-8M20 58h-8a6 6 0 0 1-6-6v-8" />
      <path d="M22 24v4M42 24v4M32 24v12h-3M24 44c4 4 12 4 16 0" />
    </svg>
  )
}
export function FingerGlyph({ size = 120, color = INK }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={color} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 22c3.5-6.5 10-10.5 17-10.5 11.5 0 20.5 9 20.5 20.5v3" />
      <path d="M11 33.5c0-2.3.3-4.5.9-6.6M52.5 42c-.5 4.6-1.6 8.8-3.3 12.5" />
      <path d="M18 47c-1.3-4.5-2-9.4-2-14.5 0-8.8 7.2-16 16-16s16 7.2 16 16c0 7.5-1 14.4-3 20.5" />
      <path d="M24.5 54c-1.9-6.3-2.9-13.4-2.9-21.5 0-5.8 4.6-10.4 10.4-10.4s10.4 4.6 10.4 10.4c0 8.6-1.1 16.2-3.4 22.6" />
      <path d="M32 32.5c0 9.5-1.2 17.6-3.6 24.3M36.2 46c-.4 4.4-1.1 8.4-2.2 12" />
    </svg>
  )
}

/** A green tick in a circle. */
export function Tick({ x, y, r = 60, scale = 1, opacity = 1 }: { x: number; y: number; r?: number; scale?: number; opacity?: number }) {
  if (opacity <= 0.001) return null
  return (
    <div style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: '50%', background: GREEN, opacity, transform: `scale(${scale})`, display: 'grid', placeItems: 'center' }}>
      <svg width={r} height={r} viewBox="0 0 24 24" fill="none" stroke={PAPER} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </div>
  )
}

/** Text inside a phone screen. */
export function ScreenText({ x, y, children, size = 28, weight = 800, color = INK, align = 'center', opacity = 1 }: {
  x: number; y: number; children: React.ReactNode; size?: number; weight?: number; color?: string; align?: 'center' | 'left'; opacity?: number
}) {
  if (opacity <= 0.001) return null
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: align === 'center' ? 'translate(-50%, -50%)' : 'translate(0, -50%)', whiteSpace: 'nowrap', fontFamily: SANS, fontWeight: weight, fontSize: size, color, opacity }}>
      {children}
    </div>
  )
}

export const TONES = { BLUE, MUTED }
