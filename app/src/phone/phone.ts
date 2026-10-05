import {
  AsYouType,
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/min";

/** Why we are verifying a number: first setup, opening a claim, or changing number. */
export type PhonePurpose = "onboard" | "claim" | "change" | "renew";

export type Country = { code: CountryCode; name: string; dial: string; flag: string };

// Names for the common ones; the rest fall back to Intl or the ISO code.
const NAMES: Partial<Record<CountryCode, string>> = {
  US: "United States", CA: "Canada", MX: "Mexico", GB: "United Kingdom", IE: "Ireland", AU: "Australia",
  NZ: "New Zealand", IN: "India", PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka", NP: "Nepal", PH: "Philippines",
  ID: "Indonesia", VN: "Vietnam", TH: "Thailand", MY: "Malaysia", SG: "Singapore", CN: "China", HK: "Hong Kong",
  JP: "Japan", KR: "South Korea", AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait",
  EG: "Egypt", NG: "Nigeria", GH: "Ghana", KE: "Kenya", ZA: "South Africa", ET: "Ethiopia", MA: "Morocco",
  DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", PT: "Portugal", NL: "Netherlands", BE: "Belgium",
  CH: "Switzerland", AT: "Austria", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", PL: "Poland",
  UA: "Ukraine", TR: "Türkiye", IL: "Israel", BR: "Brazil", AR: "Argentina", CO: "Colombia", CL: "Chile",
  PE: "Peru", VE: "Venezuela", GT: "Guatemala", SV: "El Salvador", HN: "Honduras", DO: "Dominican Republic",
  JM: "Jamaica", HT: "Haiti", CU: "Cuba",
};

function regionName(code: CountryCode): string {
  const known = NAMES[code];
  if (known) return known;
  try {
    const Display = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: string }) => { of(c: string): string | undefined } }).DisplayNames;
    if (Display) return new Display(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    // Hermes without DisplayNames
  }
  return code;
}

export function flagOf(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65));
}

let cached: Country[] | null = null;
export function countries(): Country[] {
  if (!cached) {
    cached = getCountries()
      .map((code) => ({ code, name: regionName(code), dial: `+${getCountryCallingCode(code)}`, flag: flagOf(code) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return cached;
}

export function isSupportedRegion(code: string | null | undefined): code is CountryCode {
  return !!code && (getCountries() as string[]).includes(code.toUpperCase());
}

export function countryFor(code: string | null | undefined): Country {
  const c = isSupportedRegion(code) ? (code.toUpperCase() as CountryCode) : "US";
  return countries().find((x) => x.code === c) ?? { code: "US", name: "United States", dial: "+1", flag: flagOf("US") };
}

/** Keep an international prefill's country and national input in sync, regardless of device locale. */
export function initialPhoneInput(prefilled: string | undefined, fallbackRegion: string): { country: Country; input: string } {
  const input = prefilled?.trim() ?? "";
  const parsed = input.startsWith("+") ? parsePhoneNumberFromString(input, { extract: false }) : undefined;
  if (parsed?.isValid() && parsed.country) {
    return { country: countryFor(parsed.country), input: parsed.formatNational() };
  }
  return { country: countryFor(fallbackRegion), input };
}

/** Typed national number → E.164, or null when it isn't a valid number yet. */
export function toE164(input: string, region: string): string | null {
  const parsed = parsePhoneNumberFromString(input, isSupportedRegion(region) ? (region as CountryCode) : undefined);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** Pretty "(415) 555-0123"-style formatting while typing. */
export function formatAsYouType(input: string, region: string): string {
  return new AsYouType(isSupportedRegion(region) ? (region as CountryCode) : undefined).input(input);
}

/** "+14155550123" → "+1 415 555 0123". */
export function formatE164(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/** Last 4 digits, used to compare against a masked number like "+1 •••• 0123". */
export function lastFour(phone: string): string {
  return phone.replace(/\D/g, "").slice(-4);
}

export function matchesMasked(e164OrInput: string, masked: string): boolean {
  const a = lastFour(e164OrInput);
  return a.length === 4 && a === lastFour(masked);
}
