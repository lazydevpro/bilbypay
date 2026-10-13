import React from 'react'
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { Glow } from './parts'
import { BLUE, BLUE_SOFT, DISPLAY, INK, PAPER, SANS } from './theme'

/**
 * Two thumbnails, 1280 × 720. `hook`: the promise on ink, for feeds. `brand`: the name and the
 * payoff on paper, for the site. Four words at most each.
 */
export type ThumbnailProps = { variant: 'hook' | 'brand' }

export function Thumbnail({ variant }: ThumbnailProps) {
  const dark = variant === 'hook'
  return (
    <AbsoluteFill style={{ background: dark ? INK : PAPER, overflow: 'hidden' }}>
      <Glow x={930} y={380} r={520} color={dark ? BLUE : BLUE_SOFT} opacity={dark ? 0.45 : 0.8} />
      <Img src={staticFile('film/img/hello-still.webp')} style={{ position: 'absolute', right: 70, bottom: 0, height: 640 }} />
      <div style={{ position: 'absolute', left: 80, top: 120, width: 760, fontFamily: DISPLAY, fontSize: dark ? 104 : 84, lineHeight: 0.98, color: dark ? PAPER : INK, textTransform: 'uppercase' }}>
        {dark ? (
          <>Your number is your <span style={{ color: '#F5CAA7' }}>wallet</span></>
        ) : (
          <>Bilby<span style={{ color: BLUE }}>Pay</span></>
        )}
      </div>
      <div style={{ position: 'absolute', left: 84, bottom: 90, fontFamily: SANS, fontWeight: 900, fontSize: 40, color: dark ? BLUE_SOFT : BLUE }}>
        {dark ? 'BilbyPay · on Monad' : 'Money that just works.'}
      </div>
    </AbsoluteFill>
  )
}
