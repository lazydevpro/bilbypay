import { SECTION, TOTAL_BEATS } from './cues'

/**
 * The music the film can be laid against. The picture is counted in beats, so a track only
 * has to say how fast it goes and which parts of it play where — the film retimes itself.
 *
 * A track not written for the film is cut the way an editor would cut it: a list of edits,
 * each starting on a film beat and playing the file from a point on its own beat grid.
 * `null` is silence (a hard stop). Measure a new file with the skill's
 * `scripts/track-info.mjs <file>`: tempo, first beat, and a bar-by-bar loudness table to read
 * the build, the drop and the breakdown from.
 */
export type Edit = { beat: number; from: number | null }

export type Track = {
  id: string
  label: string
  /** Path under `public/`, or null for no music (effects and voice only). */
  src: string | null
  bpm: number
  edits: Edit[]
  /** Linear level under the effects and voice. Commercial masters run hot: 0.6 is a start. */
  gain?: number
  /** Where it came from and what its licence asks for. Check the licence covers a company
   *  promoting its own product — many "free" licences only cover independent creators. */
  credit?: string
}

/** Seconds of a track's own beat `n`, given its first beat and tempo (from track-info.mjs). */
export const grid = (first: number, bpm: number) => (beat: number) => first + (beat * 60) / bpm

/** "Product Launch Advertising Music" by MaksymMalko (Pixabay): 109.95 BPM, first beat 0.313 s, 1:16. */
const launch = grid(0.313, 109.95)
const bar = (n: number) => launch(n * 4)

export const TRACKS: Track[] = [
  {
    id: 'launch',
    label: 'MaksymMalko – Product Launch Advertising Music',
    src: 'film/music.mp3',
    bpm: 109.95,
    gain: 0.55,
    credit: 'Pixabay Content License (pixabay.com/music/upbeat-product-launch-advertising-music-322166)',
    edits: [
      { beat: 0, from: bar(0) }, // the opening groove under the crypto clutter
      { beat: SECTION.stop, from: null }, // hard stop: the pile collapses into one number
      { beat: SECTION.turn, from: bar(8) }, // its lift lands as Bilby jumps out; breakdown under "anyone", drop at Burrow
      { beat: 109, from: bar(24) }, // back to the top of the drop, so its outro (bar 33) starts on the logo (beat 145)
    ],
  },
  { id: 'none', label: 'No music', src: null, bpm: 109.95, edits: [] },
  // A licensed track, cut to the picture. KEPT's, for shape (140.1 BPM, first beat 0.096 s):
  //   const product = grid(0.096, 140.1)
  //   { id: 'product', label: 'NastelBom – Product', src: 'film/music/product.mp3', bpm: 140.1,
  //     gain: 0.6, edits: [
  //       { beat: 0, from: product(11 * 4) },          // the build, so the stop lands before its drop
  //       { beat: SECTION.stop, from: null },           // the hard stop: silence
  //       { beat: SECTION.drop, from: product(17 * 4) },// its drop on the film's turn
  //       { beat: SECTION.shared, from: product(41 * 4) }, // breakdown → second drop with the payoff
  //     ] },
]

export const FPS = 30
export const TAIL_SECONDS = 1.5

export const framesPerBeat = (bpm: number) => (FPS * 60) / bpm
export const filmFrames = (bpm: number) =>
  Math.ceil(TOTAL_BEATS * framesPerBeat(bpm) + TAIL_SECONDS * FPS)

/** Whether a track has silence cut into it — the film can then add its own swell there. */
export const hasSilence = (track: Track) => track.edits.some((e) => e.from === null)
