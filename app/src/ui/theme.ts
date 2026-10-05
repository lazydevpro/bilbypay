/** Bilby's world: warm ivory, readable ink, tactile blue, and a little scarf red. */
export const colors = {
  bg: "#FFFAF1",
  surface: "#FFFEFA",
  sand: "#F7F0E3",
  sandDeep: "#E8DCC4",
  brown: "#14284B", // legacy name retained for existing consumers
  brownSoft: "#53627C",
  ink: "#14284B",
  muted: "#5C6980",
  line: "#E9E2D5",
  primary: "#3264ED",
  primaryDeep: "#244CB7",
  primarySoft: "#EAF0FF",
  apricot: "#F5CAA7",
  sage: "#DCE7C9",
  blue: "#6F8FC0", // mascot fur
  blueSoft: "#E5ECF6",
  green: "#2E7D4F",
  greenSoft: "#E3F2E8",
  red: "#B8322B", // mascot scarf
  redSoft: "#FBE5E2",
  gold: "#D9A441",
  goldSoft: "#FBF0D9",
  white: "#FFFFFF",
  overlay: "rgba(20,40,75,0.45)",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 12, md: 18, lg: 24, xl: 32, pill: 999 } as const;

/** Type scale. Sizes are in points and scale with the person's text size setting. */
export const type = {
  hero: { fontSize: 48, fontWeight: "800", letterSpacing: -1.8 },
  display: { fontSize: 34, fontWeight: "800", letterSpacing: -0.9 },
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
  shadowColor: "#7A6240",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;
