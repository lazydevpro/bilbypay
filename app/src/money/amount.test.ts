import { describe, expect, it } from "vitest";
import { baseToTyped, clampZero, displayTyped, type KeypadKey, pressKey, typedToBase, usd, usdShort } from "./amount";

const type = (keys: string, start = "") =>
  [...keys].reduce((s, k) => pressKey(s, (k === "<" ? "back" : k) as KeypadKey), start);

describe("money formatting", () => {
  it("formats base units as dollars", () => {
    expect(usd("12500000")).toBe("$12.50");
    expect(usd("0")).toBe("$0.00");
    expect(usd("1234567890000")).toBe("$1,234,567.89");
    expect(usd(undefined)).toBe("$0.00");
    expect(usd("not a number")).toBe("$0.00");
    expect(usd(-5_000_000n)).toBe("-$5.00");
    expect(usd("1999")).toBe("$0.00"); // rounds down below a cent
  });

  it("drops .00 in short form", () => {
    expect(usdShort("20000000")).toBe("$20");
    expect(usdShort("20500000")).toBe("$20.50");
  });

  it("never shows negative earnings", () => {
    expect(clampZero("-5")).toBe("0");
    expect(clampZero("5")).toBe("5");
    expect(clampZero(undefined)).toBe("0");
  });
});

describe("amount keypad", () => {
  it("types dollars and cents", () => {
    expect(type("12.5")).toBe("12.5");
    expect(type("12.50")).toBe("12.50");
    expect(type("12.505")).toBe("12.50"); // max two decimals
  });

  it("handles leading zeros and dots", () => {
    expect(type("0")).toBe("0");
    expect(type("05")).toBe("5");
    expect(type(".")).toBe("0.");
    expect(type(".5")).toBe("0.5");
    expect(type("1..2")).toBe("1.2");
    expect(type("00")).toBe("0");
  });

  it("deletes", () => {
    expect(type("12.5<")).toBe("12.");
    expect(type("12.5<<<")).toBe("1");
    expect(type("<")).toBe("");
  });

  it("caps very large amounts", () => {
    expect(type("123456789")).toBe("1234567");
  });

  it("converts to base units", () => {
    expect(typedToBase("")).toBe("0");
    expect(typedToBase("0.")).toBe("0");
    expect(typedToBase("12.")).toBe("12000000");
    expect(typedToBase("12.5")).toBe("12500000");
    expect(typedToBase("0.01")).toBe("10000");
    expect(baseToTyped("12500000")).toBe("12.5");
    expect(baseToTyped("20000000")).toBe("20");
    expect(baseToTyped("20050000")).toBe("20.05");
  });

  it("renders what is typed", () => {
    expect(displayTyped("")).toBe("$0");
    expect(displayTyped("1234.5")).toBe("$1,234.5");
    expect(displayTyped("20.")).toBe("$20.");
  });
});
