import { describe, expect, it } from "vitest";
import { companionForHour, companionForLocalTime, parseCompanionPreferences } from "./companionModel";

describe("companion preferences", () => {
  it("retains a motion opt-out while discarding the old scene choice", () => {
    expect(parseCompanionPreferences('{"scene":"night","motionEnabled":false}')).toEqual({ motionEnabled: false });
  });
  it("rejects malformed and obsolete settings without breaking the app", () => {
    for (const raw of [null, "{", "null", "42", '{"scene":"unknown","motionEnabled":"false"}']) {
      expect(parseCompanionPreferences(raw)).toEqual({ motionEnabled: true });
    }
  });
  it("persists only motion, even when obsolete fields are present", () => {
    expect(parseCompanionPreferences('{"scene":"retired","motionEnabled":false,"hydrated":true}')).toEqual({ motionEnabled: false });
  });
});

describe("automatic local-time environment", () => {
  it.each([
    [0, "night", "night", "left"], [4, "night", "night", "left"],
    [5, "morning", "meadow", "right"], [11, "morning", "meadow", "right"],
    [12, "afternoon", "meadow", "left"], [16, "afternoon", "meadow", "left"],
    [17, "evening", "nook", "center"], [20, "evening", "nook", "center"],
    [21, "night", "night", "left"], [23, "night", "night", "left"],
  ])("maps hour %i to %s", (hour, period, scene, placement) => {
    expect(companionForHour(hour as number)).toMatchObject({ period, scene, placement });
  });
  it("uses the device's local hour rather than UTC", () => {
    expect(companionForLocalTime(new Date(2026, 8, 30, 6, 45)).period).toBe("morning");
    expect(companionForLocalTime(new Date(2026, 8, 30, 19, 0)).period).toBe("evening");
  });
  it("handles invalid clocks with a neutral daytime scene", () => {
    for (const hour of [-1, 24, NaN, Infinity]) expect(companionForHour(hour).period).toBe("afternoon");
  });
});
