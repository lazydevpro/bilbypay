import { describe, expect, it } from "vitest";
import { initialPhoneInput, toE164 } from "./phone";

describe("phone form prefilling", () => {
  it.each([
    ["+14155550199", "GB", "US"],
    ["+442079460018", "US", "GB"],
    ["+16475550123", "GB", "CA"],
  ])("uses %s's country instead of the device locale", (phone, locale, country) => {
    const initial = initialPhoneInput(phone, locale);
    expect(initial.country.code).toBe(country);
    expect(initial.input).not.toMatch(/^\+/);
    expect(toE164(initial.input, initial.country.code)).toBe(phone);
  });
  it("falls back to locale for a blank form", () => {
    expect(initialPhoneInput(undefined, "GB")).toMatchObject({ country: { code: "GB" }, input: "" });
  });
  it("retains incomplete input for correction without guessing its country", () => {
    expect(initialPhoneInput("+141", "GB")).toMatchObject({ country: { code: "GB" }, input: "+141" });
  });
});
