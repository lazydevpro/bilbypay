/** BilbyPay look: warm sand + bilby brown, with the mascot's blue and scarf red as accents. */
export const colors = {
  bg: "#FBF6EE",
  surface: "#FFFFFF",
  sand: "#F3E7D6",
  sandDeep: "#E7D5BC",
  brown: "#5A3E2F", // primary actions, headings (contrast 10:1 on bg)
  brownSoft: "#8A6A55",
  ink: "#2A1F19",
  muted: "#6F6058", // secondary text (≥ 4.5:1 on bg)
  line: "#EADFCF",
  blue: "#6F8FC0", // mascot fur
  blueSoft: "#E5ECF6",
  green: "#2E7D4F",
  greenSoft: "#E3F2E8",
  red: "#B8322B", // mascot scarf
  redSoft: "#FBE5E2",
  gold: "#D9A441",
  goldSoft: "#FBF0D9",
  white: "#FFFFFF",
  overlay: "rgba(42,31,25,0.45)",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** Type scale. Sizes are in points and scale with the person's text size setting. */
export const type = {
  hero: { fontSize: 48, fontWeight: "800", letterSpacing: -1 },
  display: { fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: "700" },
  heading: { fontSize: 18, fontWeight: "700" },
  body: { fontSize: 16, fontWeight: "400" },
  bodyStrong: { fontSize: 16, fontWeight: "600" },
  small: { fontSize: 14, fontWeight: "400" },
  caption: { fontSize: 12, fontWeight: "500" },
} as const;

/** Minimum touch target (Apple HIG 44pt; we go a bit larger). */
export const TAP = 52;

export const shadow = {
  shadowColor: "#5A3E2F",
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;
