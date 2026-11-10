import { describe, expect, it } from "vitest";
import { monthKey, nextMonthStart, quotaMath } from "../../src/services/usage.service";
import { categoryMultiplier, simulatedOutcome, tenantCapacity } from "../../src/services/mailer.service";

describe("quota math", () => {
  it("unlimited always fits", () => {
    expect(quotaMath(null, 1_000_000, 5_000_000)).toEqual({ remaining: null, fits: true });
  });
  it("computes the remainder and whether a send fits", () => {
    expect(quotaMath(5000, 4000, 1000)).toEqual({ remaining: 1000, fits: true });
    expect(quotaMath(5000, 4000, 1001)).toEqual({ remaining: 1000, fits: false });
  });
  it("never reports a negative remainder", () => {
    expect(quotaMath(100, 150, 1)).toEqual({ remaining: 0, fits: false });
    expect(quotaMath(0, 0, 0)).toEqual({ remaining: 0, fits: true });
  });
  it("keys a month by its first UTC day and resets on the next", () => {
    expect(monthKey(new Date("2026-03-31T23:59:59Z"))).toBe("2026-03-01");
    expect(nextMonthStart(new Date("2026-03-31T23:59:59Z")).toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(nextMonthStart(new Date("2026-12-15T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("sending rate", () => {
  it("scales the tenant rate by reputation and never below one", () => {
    expect(tenantCapacity("ACTIVE", "MARKETING", { emailTps: 10 })).toBe(10);
    expect(tenantCapacity("WARNING", "MARKETING", { emailTps: 10 })).toBe(5);
    expect(tenantCapacity("THROTTLED", "MARKETING", { emailTps: 10 })).toBe(1);
    expect(categoryMultiplier("PAUSED", "MARKETING")).toBe(0);
  });
});

describe("simulated outcomes", () => {
  it("maps the local part to an outcome", () => {
    expect(simulatedOutcome("bounce@example.com")).toBe("HARD_BOUNCE");
    expect(simulatedOutcome("soft@example.com")).toBe("SOFT_BOUNCE");
    expect(simulatedOutcome("Complaint@example.com")).toBe("COMPLAINT");
    expect(simulatedOutcome("ada@example.com")).toBe("DELIVERY");
    expect(simulatedOutcome("bounce.me@example.com")).toBe("DELIVERY");
  });
});
