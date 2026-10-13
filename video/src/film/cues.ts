/**
 * Every moment of "Your number", in beats (docs/film-launch.md). Plain values only: Node imports
 * this file directly. Laid out at 120 BPM until the track is chosen; beats stay on the music at
 * any tempo.
 */

export const SECTION = {
  problem: 0, // crypto today: an address, a seed phrase, a gas error
  stop: 16, // the music stops dead; the pile collapses into one phone number
  turn: 17, // the drop: Bilby jumps out of the number
  what: 25, // push into Bilby's face → the app icon, the name, the promise
  how: 34, // the icon becomes a phone: contact → amount → face/finger → sent
  anyone: 56.5, // the "sent" check lifts out into a chat: send to anyone, refunds
  gift: 75, // the claim card flips into a gift card
  burrow: 85.5, // the gift drops into the ground: the savings burrow
  passkey: 118.5, // pull back: one phone of many, a passkey on each
  scale: 127.5, // phones → a crowd of contacts paying each other
  end: 139.5, // the crowd contracts into Bilby asleep → the icon → the name
  out: 157,
} as const

export const TOTAL_BEATS = SECTION.out

// ── Problem
export const ADDRESS_IN = 0.3
export const SEED_IN: [number, number] = [4.5, 8.5]
export const GAS_IN = 9.5
export const SHAKE: [number, number] = [12, 16]
export const COLLAPSE: [number, number] = [16, 17]
export const CHIP_IN = 16.6

// ── Turn
export const DROP = SECTION.turn
export const DISC: [number, number] = [17, 18.6]
/** The background turns to paper here, under the expanding disc. */
export const PAPER_AT = 18.2
export const JUMP = 17.4

// ── What
export const PUSH: [number, number] = [25, 27.2]
export const ICON_IN = 26.6
export const NAME_IN = 28.5
export const PROMISE_IN = 29.5

// ── How
export const TO_PHONE: [number, number] = [33.8, 35.5]
export const CONTACTS: [number, number] = [35.5, 40.5]
export const TAP_PRIYA = 38.5
export const AMOUNT: [number, number] = [40.5, 43.5]
export const BIO: [number, number] = [43.5, 46]
export const BIO_SWAP = 44.8
export const SENT = 46
export const RUN: [number, number] = [49, 55.5]

// ── Anyone
export const LIFT: [number, number] = [56.5, 58]
export const BUBBLES = 58
export const CARD_IN = 59.5
export const RETURN: [number, number] = [68, 71]

// ── Gift
export const FLIP: [number, number] = [75, 76.5]

// ── Burrow
export const TO_HOLE: [number, number] = [85.5, 87]
export const PANEL_IN = 87
export const KEEP_LINE = 88
export const ARRIVE = 93
export const HOP: [number, number] = [96, 100]
export const PAY_BTN = 106.5
export const HOP_BACK: [number, number] = [109, 110.5]
export const PAY_BIO = 111
export const PAID = 112.5
export const FOOTNOTE: [number, number] = [93, 117.5]

// ── Passkey, scale
export const PULL: [number, number] = [118.5, 121]
export const GRID_IN: [number, number] = [127.5, 130]
export const ZIPS: [number, number] = [130, 139]

// ── End
export const CONTRACT: [number, number] = [139.5, 141.5]
export const INK_AT: [number, number] = [141.5, 142.5]
export const TO_ICON: [number, number] = [142.5, 143.2]
export const HITS = [143, 144, 145]
export const LOGO = 145.5
export const CTA = 152
