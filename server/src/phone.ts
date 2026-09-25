import { createHmac } from "node:crypto";
import { type CountryCode, parsePhoneNumberFromString } from "libphonenumber-js";
import type { Hex } from "viem";

export type ParsedPhone = { e164: string; country?: CountryCode };

/** Normalises user input to E.164, using `region` (ISO country) for numbers without a +prefix. */
export function normalizePhone(input: string, region?: string): ParsedPhone | null {
  const cleaned = input.trim();
  if (!cleaned || cleaned.length > 32) return null;
  const parsed = parsePhoneNumberFromString(cleaned, (region?.toUpperCase() as CountryCode) || undefined);
  if (!parsed || !parsed.isPossible()) return null;
  // +1555 numbers are fictional (so "valid" fails) but are the test numbers the API documents.
  if (!parsed.isValid() && !parsed.number.startsWith("+1555")) return null;
  return { e164: parsed.number, country: parsed.country };
}

/** The number's country, used as the hint for contacts saved without a +prefix. */
export function regionOf(e164: string): string | undefined {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return undefined;
  // Unassigned ranges (e.g. +1555 test numbers) have no country; fall back to the calling code's main one.
  return parsed.country ?? parsed.getPossibleCountries()[0] ?? (parsed.countryCallingCode === "1" ? "US" : undefined);
}

/** phoneKey = HMAC-SHA256(pepper, E.164) as bytes32. The raw number never goes on-chain. */
export function phoneKey(pepper: string, e164: string): Hex {
  return `0x${createHmac("sha256", pepper).update(e164).digest("hex")}`;
}

/** "+14155550123" → "+1 •••• 0123" */
export function maskPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  const cc = parsed?.countryCallingCode ?? "";
  return `+${cc} •••• ${e164.slice(-4)}`;
}
