import React from 'react'
import { AbsoluteFill, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, Easing } from 'remotion'
import { AppIcon, Hello } from '../film/bilby'
import { Glow } from '../film/parts'
import { BLUE, BLUE_SOFT, DISPLAY, INK, MUTED, PAPER, SANS } from '../film/theme'
import edl from '../../public/demo/edl.json'

/**
 * The demo walkthrough: the phone recordings (cut by /private/tmp/demo/edit.mjs into
 * public/demo/demo-vertical.mp4) framed at 16:9, with a chapter label for each step.
 * No audio: the voiceover is recorded over this.
 */
export const DEMO_FPS = 30
export const INTRO = 75 // frames
export const OUTRO = 120
export const demoFrames = () => INTRO + Math.round(edl.total * DEMO_FPS) + OUTRO

const PHONE_H = 960
const PHONE_W = Math.round((PHONE_H * 616) / 1280)
const PHONE_X = 1180

const ease = Easing.bezier(0.22, 1, 0.36, 1)

function Chapter({ index, title, from }: { index: number; title: string; from: number }) {
  const frame = useCurrentFrame() - from
  const p = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
  return (
    <div style={{ position: 'absolute', left: 140, top: 430, width: 640, opacity: p, transform: `translateY(${(1 - p) * 30}px)`, filter: `blur(${(1 - p) * 8}px)` }}>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 30, color: BLUE, letterSpacing: 2 }}>{String(index + 1).padStart(2, '0')}</div>
      <div style={{ fontFamily: DISPLAY, fontSize: 64, lineHeight: 1.08, color: INK, marginTop: 12 }}>{title}</div>
    </div>
  )
}

function Phone() {
  return (
    <div style={{
      position: 'absolute', left: PHONE_X - PHONE_W / 2 - 14, top: (1080 - PHONE_H) / 2 - 14,
      width: PHONE_W + 28, height: PHONE_H + 28, borderRadius: 56, background: INK, padding: 14,
      boxShadow: '0 40px 90px rgba(20,40,75,0.28), 0 8px 24px rgba(20,40,75,0.18)',
    }}>
      <div style={{ width: PHONE_W, height: PHONE_H, borderRadius: 42, overflow: 'hidden', background: PAPER }}>
        <OffthreadVideo src={staticFile('demo/demo-vertical.mp4')} muted style={{ width: PHONE_W, height: PHONE_H, display: 'block' }} />
      </div>
    </div>
  )
}

function Card({ kind }: { kind: 'intro' | 'outro' }) {
  const frame = useCurrentFrame()
  const len = kind === 'intro' ? INTRO : OUTRO
  const p = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp', easing: ease })
  const out = kind === 'intro' ? interpolate(frame, [len - 12, len], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Hello x={1300} y={560} h={620} opacity={p} />
      <div style={{ position: 'absolute', left: 160, top: 360, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 120, color: INK, lineHeight: 1 }}>
          Bilby<span style={{ color: BLUE }}>Pay</span>
        </div>
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 44, color: INK, marginTop: 28 }}>
          {kind === 'intro' ? 'Your number is your wallet.' : 'Try the beta: bilbypay.pages.dev'}
        </div>
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 28, color: MUTED, marginTop: 18 }}>
          {kind === 'intro' ? 'A real run on Monad testnet, recorded on an Android phone' : 'Monad testnet · test money only · not audited'}
        </div>
      </div>
    </AbsoluteFill>
  )
}

export function Demo() {
  const frame = useCurrentFrame()
  const body = Math.round(edl.total * DEMO_FPS)
  const chapters = edl.chapters.map((c, i) => ({ ...c, from: INTRO + Math.round(c.at * DEMO_FPS), index: i }))
  const inBody = frame >= INTRO && frame < INTRO + body
  const current = [...chapters].reverse().find((c) => frame >= c.from)
  const phoneIn = interpolate(frame, [INTRO - 10, INTRO + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
  const phoneOut = interpolate(frame, [INTRO + body - 6, INTRO + body + 10], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: PAPER, overflow: 'hidden' }}>
      <Glow x={PHONE_X} y={540} r={620} color={BLUE_SOFT} opacity={0.7} />
      <Sequence durationInFrames={INTRO}>
        <Card kind="intro" />
      </Sequence>
      <Sequence from={INTRO} durationInFrames={body}>
        <div style={{ opacity: phoneIn * phoneOut, transform: `translateY(${(1 - phoneIn) * 60}px)` }}>
          <Phone />
        </div>
      </Sequence>
      {inBody && (
        <>
          <div style={{ position: 'absolute', left: 140, top: 110, display: 'flex', alignItems: 'center', gap: 18 }}>
            <AppIcon x={36} y={36} size={72} />
            <div style={{ marginLeft: 82, fontFamily: DISPLAY, fontSize: 40, color: INK }}>Bilby<span style={{ color: BLUE }}>Pay</span></div>
          </div>
          {current && <Chapter key={current.index} index={current.index} title={current.title} from={current.from} />}
          <div style={{ position: 'absolute', left: 140, bottom: 100, fontFamily: SANS, fontWeight: 700, fontSize: 24, color: MUTED }}>
            Monad testnet · test money only
          </div>
        </>
      )}
      <Sequence from={INTRO + body} durationInFrames={OUTRO}>
        <Card kind="outro" />
      </Sequence>
      <Img src={staticFile('film/img/icon.png')} style={{ display: 'none' }} />
    </AbsoluteFill>
  )
}
