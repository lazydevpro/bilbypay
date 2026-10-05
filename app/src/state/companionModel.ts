export type CompanionScene = "meadow" | "nook" | "night";
export type CompanionPlacement = "left" | "center" | "right";
export type CompanionPeriod = "morning" | "afternoon" | "evening" | "night";
export type CompanionTime = {
  readonly period: CompanionPeriod;
  readonly scene: CompanionScene;
  readonly placement: CompanionPlacement;
  readonly greeting: string;
};
export type CompanionPreferences = { motionEnabled: boolean };
export const DEFAULT_COMPANION: CompanionPreferences = { motionEnabled: true };

const TIME_SETTINGS: Record<CompanionPeriod, CompanionTime> = {
  morning: { period: "morning", scene: "meadow", placement: "right", greeting: "Good morning." },
  afternoon: { period: "afternoon", scene: "meadow", placement: "left", greeting: "Good afternoon." },
  evening: { period: "evening", scene: "nook", placement: "center", greeting: "Good evening." },
  night: { period: "night", scene: "night", placement: "left", greeting: "Hello, night owl." },
};

/** Local wall-clock time controls the home environment; it is never a saved choice. */
export function companionForHour(hour: number): CompanionTime {
  const localHour = Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 12;
  if (localHour >= 5 && localHour < 12) return TIME_SETTINGS.morning;
  if (localHour >= 12 && localHour < 17) return TIME_SETTINGS.afternoon;
  if (localHour >= 17 && localHour < 21) return TIME_SETTINGS.evening;
  return TIME_SETTINGS.night;
}

export function companionForLocalTime(date: Date): CompanionTime {
  return companionForHour(date.getHours());
}

/** Legacy scene fields are ignored; only the device's motion choice is persisted. */
export function parseCompanionPreferences(raw: string | null): CompanionPreferences {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return { ...DEFAULT_COMPANION };
    const stored = value as Record<string, unknown>;
    return {
      motionEnabled: typeof stored.motionEnabled === "boolean" ? stored.motionEnabled : DEFAULT_COMPANION.motionEnabled,
    };
  } catch {
    return { ...DEFAULT_COMPANION };
  }
}
