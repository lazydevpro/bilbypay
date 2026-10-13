import React from 'react'
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CalculateMetadataFunction } from 'remotion'
import { H, Vignette, W } from './parts'
import { Anyone, Burrow, Crowd, End, Gift, How, Icon, Name, Passkey, Problem, Turn, Words, backgroundAt } from './sections/story'
import { Sound } from './sound'
import { NIGHT, INK, PAPER } from './theme'
import { FPS, TRACKS, filmFrames, framesPerBeat } from './tracks'
import type { Take } from './voice'

/**
 * "Your number" (docs/film-launch.md). One continuous shot: sections overlap at their hand-offs,
 * and everything is timed in beats so the film retimes itself to the track.
 */

export type FilmProps = {
  track: string
  voice?: string | null
  take?: Take | null
}

export const calculateFilmMetadata: CalculateMetadataFunction<FilmProps> = async ({ props }) => {
  const track = TRACKS.find((t) => t.id === props.track) ?? TRACKS[0]!
  let take: Take | null = null
  if (props.voice) {
    const res = await fetch(staticFile(`film/vo/${props.voice}/take.json`))
    if (!res.ok) throw new Error(`No "${props.voice}" voiceover yet — run the voiceover step first.`)
    take = (await res.json()) as Take
  }
  return { durationInFrames: filmFrames(track.bpm), fps: FPS, props: { ...props, take } }
}

export function Film({ track: id, take = null }: FilmProps) {
  const frame = useCurrentFrame()
  const { width } = useVideoConfig()
  const track = TRACKS.find((t) => t.id === id) ?? TRACKS[0]!
  const fpb = framesPerBeat(track.bpm)
  const clock = { beat: frame / fpb, spb: 60 / track.bpm, fpb }
  const bg = backgroundAt(clock.beat)
  const dark = bg !== PAPER
  return (
    <AbsoluteFill style={{ background: bg }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, overflow: 'hidden', transformOrigin: '0 0', transform: `scale(${width / W})` }}>
        <Problem {...clock} />
        <Turn {...clock} />
        <Name {...clock} />
        <How {...clock} />
        <Icon {...clock} />
        <Anyone {...clock} />
        <Gift {...clock} />
        <Burrow {...clock} />
        <Passkey {...clock} />
        <Crowd {...clock} />
        <End {...clock} />
        <Vignette color={dark ? (bg === NIGHT ? NIGHT : INK) : PAPER} strength={dark ? 0.8 : 0.25} />
        <Words {...clock} />
      </div>
      <Sound track={track} take={take} />
    </AbsoluteFill>
  )
}
