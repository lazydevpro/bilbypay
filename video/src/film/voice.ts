/**
 * The voiceover: what is said, and on which beat.
 *
 * Where a caption is up, the voice says the caption: the words on screen and the words heard
 * never disagree. Between captions it tells what the picture cannot. Together the lines tell
 * the whole product — the problem, what it is, how it works, each feature, why it is
 * different, what it adds up to, and where to get it.
 *
 * The whole script is spoken in ONE take (the skill's `scripts/voiceover.mjs`), then cut at
 * the pauses and laid on these beats, so every line is the same voice, read and level.
 * Change a word here and the take is regenerated; change only a beat and it is just re-laid.
 *
 * One sentence per line: the voice pauses after every sentence, and those pauses are where the
 * take is cut. If the product's name is misheard when read on its own (KEPT's "Kept." came back
 * as "Capt."), write it the way it is said — in lower case, or spelled phonetically.
 *
 * Plain values only — the script imports this file straight into Node.
 */

export type Line = { at: number; text: string }

export const LINES: Line[] = [
  { at: 1, text: "Paying someone in crypto still means a long address, a seed phrase to guard, and a gas token you don't have." },
  { at: 19, text: "What if their phone number was enough?" },
  { at: 27, text: "This is Bilby Pay." },
  { at: 30.2, text: "Your number is your wallet." },
  { at: 36.5, text: "Pick a contact." },
  { at: 40.6, text: "Type an amount." },
  { at: 43.4, text: "Confirm with your face or fingerprint." },
  { at: 48.6, text: "It lands in about two seconds, and the network fee is on us." },
  { at: 58.6, text: "Not on Bilby Pay yet?" },
  { at: 61, text: "Send it anyway." },
  { at: 63.6, text: "They get a link to claim it, and if they never do, it comes back to you." },
  { at: 76.4, text: "Send a gift card the same way, and it opens right inside the app." },
  { at: 87, text: "Set the amount you want to keep handy." },
  { at: 93, text: "Anything above it tucks itself away into your savings burrow, where it can earn while it rests." },
  { at: 106, text: "Pay more than you have, and Bilby Pay pulls the difference straight back out, in the same tap." },
  { at: 119.6, text: "No seed phrase to lose." },
  { at: 123.6, text: "Your passkey is the key." },
  { at: 129, text: "Built on Monad, every payment settles in under a second, for less than a cent." },
  { at: 146, text: "Bilby Pay." },
  { at: 147.6, text: "Money that just works." },
  { at: 152.4, text: "Try the beta today." },
]

/**
 * How it should sound. Sent as a system instruction where the model takes one; otherwise it
 * goes ahead of the script and the listener cuts off whatever of it is read aloud.
 */
export const DIRECTION =
  'You are the narrator of a short, playful product film for a friendly money app. Read the text you are given, and nothing else, ' +
  'in a warm, bright, quietly confident voice: smiling, close to the microphone, unhurried, never salesy. Pause after every sentence.'

/** Gemini's prebuilt voice for the take. Sulafat is warm; Algieba or Charon read lower. */
export const DEFAULT_VOICE = 'take'

/** The fastest tempo the film is laid on — the fit check times every line there. */
export const FIT_BPM = 109.95

/** A line as it was cut from the take: `public/film/vo/<voice>/take.json`. */
export type VoiceLine = Line & {
  src: string
  /** Seconds of room before the first word. */
  lead: number
  /** Seconds from the first word to the end of the last. */
  speech: number
  /** The whole clip. */
  seconds: number
}

export type Take = { voice: string; model: string; lines: VoiceLine[] }
