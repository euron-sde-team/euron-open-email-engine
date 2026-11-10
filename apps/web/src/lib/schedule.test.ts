import { describe, expect, it } from "vitest";
import { formatInZone, isValidTimezone, offsetMinutes, scheduleProblem, utcToZonedInput, zonedToUtcIso } from "./schedule";

describe("schedule and timezones", () => {
  it("knows fixed offsets", () => {
    expect(offsetMinutes(new Date("2026-11-12T00:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(offsetMinutes(new Date("2026-07-01T00:00:00Z"), "America/New_York")).toBe(-240);
    expect(offsetMinutes(new Date("2026-12-01T00:00:00Z"), "America/New_York")).toBe(-300);
  });

  it("reads wall-clock time in a zone as a UTC instant", () => {
    expect(zonedToUtcIso("2026-11-12T09:30", "Asia/Kolkata")).toBe("2026-11-12T04:00:00.000Z");
    expect(zonedToUtcIso("2026-07-01T09:00", "America/New_York")).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtcIso("2026-12-01T09:00", "America/New_York")).toBe("2026-12-01T14:00:00.000Z");
    expect(zonedToUtcIso("2026-12-01T09:00", "UTC")).toBe("2026-12-01T09:00:00.000Z");
  });

  it("rejects malformed input and unknown zones", () => {
    expect(zonedToUtcIso("tomorrow", "UTC")).toBeNull();
    expect(zonedToUtcIso("2026-12-01T09:00", "Mars/Olympus")).toBeNull();
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("Nope/Nope")).toBe(false);
  });

  it("round-trips through a datetime-local value", () => {
    const iso = zonedToUtcIso("2026-03-29T10:15", "Europe/Berlin")!;
    expect(utcToZonedInput(iso, "Europe/Berlin")).toBe("2026-03-29T10:15");
  });

  it("shows an instant in the chosen zone", () => {
    expect(formatInZone("2026-11-12T04:00:00.000Z", "Asia/Kolkata")).toContain("9:30");
    expect(formatInZone(null, "UTC")).toBe("");
  });

  it("requires a future time with some lead", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    expect(scheduleProblem(null, now)).toMatch(/Pick/);
    expect(scheduleProblem("2026-11-12T10:02:00Z", now)).toMatch(/5 minutes/);
    expect(scheduleProblem("2026-11-12T11:00:00Z", now)).toBeNull();
  });
});
