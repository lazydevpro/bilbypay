import React from 'react'
import { Composition, Still } from 'remotion'
import { Film, calculateFilmMetadata, type FilmProps } from './Film'
import { Thumbnail, type ThumbnailProps } from './thumbnail'
import { FPS, TRACKS, filmFrames } from './tracks'
import { DEFAULT_VOICE } from './voice'
import { Demo, DEMO_FPS, demoFrames } from '../demo/Demo'

/**
 * Every cut of the film, for the project's Root:
 *
 *   import { FilmCompositions } from './film/compositions'
 *   export const Root = () => <><FilmCompositions />{…the project's own…}</>
 *
 * One composition per track, each with and without the voice:
 *   Film-<track>       music and effects
 *   Film-<track>-vo    …and the voiceover (needs voiceover.mjs to have run)
 * plus the thumbnails as stills.
 */
export function FilmCompositions() {
  return (
    <>
      {TRACKS.flatMap((track) =>
        [null, DEFAULT_VOICE].map((voice) => (
          <Composition
            key={`${track.id}-${voice ?? 'none'}`}
            id={`Film-${track.id}${voice ? '-vo' : ''}`}
            component={Film}
            fps={FPS}
            width={1920}
            height={1080}
            durationInFrames={filmFrames(track.bpm)}
            defaultProps={{ track: track.id, voice } satisfies FilmProps}
            calculateMetadata={calculateFilmMetadata}
          />
        )),
      )}
      <Composition id="Demo" component={Demo} fps={DEMO_FPS} width={1920} height={1080} durationInFrames={demoFrames()} />
      <Still
        id="Thumbnail"
        component={Thumbnail}
        width={1280}
        height={720}
        defaultProps={{ variant: 'hook' } satisfies ThumbnailProps}
      />
      <Still
        id="Thumbnail-brand"
        component={Thumbnail}
        width={1280}
        height={720}
        defaultProps={{ variant: 'brand' } satisfies ThumbnailProps}
      />
    </>
  )
}
