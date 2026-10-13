import { loadFont as loadDisplay } from '@remotion/google-fonts/DelaGothicOne'
import { loadFont as loadSans } from '@remotion/google-fonts/Nunito'

/**
 * BilbyPay's look: the landing page and app palette (site/static/index.html, app/src/ui/theme.ts),
 * Dela Gothic One for display type and Nunito for everything else, as on bilbypay.pages.dev.
 */

/** The dark of the problem: crypto as it is today. */
export const NIGHT = '#0E1D38'
/** Ink: type on paper, and the dark under the final mark. */
export const INK = '#14284B'
/** Paper: once Bilby is there. */
export const PAPER = '#FFFAF1'
export const BLUE = '#3264ED'
export const BLUE_SOFT = '#C9D8FF'
export const SKY = '#E5ECF6'
export const APRICOT = '#F5CAA7'
export const SAGE = '#DCE7C9'
export const SCARF = '#B8322B'
export const GOLD = '#F2C14E'
export const GREEN = '#2E7D4F'
export const MUTED = '#5C6980'
export const EARTH = '#6B4A2E'

// Names the kit's thumbnail and parts expect.
export const ACCENT = BLUE
export const ACCENT_2 = APRICOT
export const ACCENT_3 = SCARF
export const ACCENT_DEEP = BLUE

const sans = loadSans('normal', { weights: ['600', '700', '800', '900'], subsets: ['latin'] })
const display = loadDisplay('normal', { weights: ['400'], subsets: ['latin'] })

export const SANS = sans.fontFamily
export const DISPLAY = display.fontFamily
/** The kit's accent face; here the display face (Dela Gothic has no italic). */
export const SERIF = display.fontFamily
