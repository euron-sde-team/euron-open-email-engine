import type { FleetTenantRow } from "@open-email/types";
import { describe, expect, it } from "vitest";

import {
  canUnpause,
  defaultDir,
  formatAge,
  formatCount,
  formatLimit,
  formatRate,
  formatUsage,
  limitToText,
  needsAttention,
  parseLimit,
  rateTone,
  sendingTone,
  sortFleet,
  usageRatio,
  usageTone,
} from "./fleet";

const row = (over: Partial<FleetTenantRow> & { name: string }): FleetTenantRow => ({
  tenantId: over.name.toLowerCase(),
  status: "ACTIVE",
  plan: "Growth",
  sent14d: 0,
  bounceRate: 0,
  complaintRate: 0,
  domains: 1,
  verifiedDomains: 1,
  contacts: 0,
  ...over,
});

const fleet = [
  row({ name: "Bravo", status: "WARNING", bounceRate: 0.06, complaintRate: 0.001, sent14d: 500, contacts: 40 }),
  row({ name: "alpha", status: "ACTIVE", bounceRate: 0.01, complaintRate: 0, sent14d: 9000, contacts: 900 }),
  row({ name: "Delta", status: "PAUSED", bounceRate: 0.12, complaintRate: 0.006, sent14d: 100, contacts: 10 }),
  row({ name: "Charlie", status: "THROTTLED", bounceRate: 0.06, complaintRate: 0.003, sent14d: 2000, contacts: 200 }),
];

const names = (rows: FleetTenantRow[]) => rows.map((r) => r.name);

describe("sortFleet", () => {
  it("sorts by bounce rate descending and breaks ties by name", () => {
    expect(names(sortFleet(fleet, "bounceRate", "desc"))).toEqual(["Delta", "Bravo", "Charlie", "alpha"]);
  });

  it("sorts by complaint rate ascending", () => {
    expect(names(sortFleet(fleet, "complaintRate", "asc"))).toEqual(["alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("sorts names case-insensitively", () => {
    expect(names(sortFleet(fleet, "name", "asc"))).toEqual(["alpha", "Bravo", "Charlie", "Delta"]);
    expect(names(sortFleet(fleet, "name", "desc"))).toEqual(["Delta", "Charlie", "Bravo", "alpha"]);
  });

  it("sorts status by severity, worst first when descending", () => {
    expect(names(sortFleet(fleet, "status", "desc"))).toEqual(["Delta", "Charlie", "Bravo", "alpha"]);
    expect(names(sortFleet(fleet, "status", "asc"))).toEqual(["alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("sorts numeric columns", () => {
    expect(names(sortFleet(fleet, "sent14d", "desc"))).toEqual(["alpha", "Charlie", "Bravo", "Delta"]);
    expect(names(sortFleet(fleet, "contacts", "asc"))).toEqual(["Delta", "Bravo", "Charlie", "alpha"]);
  });

  it("does not mutate its input", () => {
    const copy = [...fleet];
    sortFleet(fleet, "sent14d", "asc");
    expect(fleet).toEqual(copy);
  });

  it("starts names A to Z and metrics worst first", () => {
    expect(defaultDir("name")).toBe("asc");
    expect(defaultDir("bounceRate")).toBe("desc");
  });
});

describe("needsAttention", () => {
  it("drops active tenants and orders worst first", () => {
    expect(names(needsAttention(fleet))).toEqual(["Delta", "Charlie", "Bravo"]);
  });
});

describe("status mapping", () => {
  it("maps each sending status to a label, colour and severity", () => {
    expect(sendingTone("ACTIVE")).toMatchObject({ label: "Active", text: "text-success", severity: 0 });
    expect(sendingTone("WARNING")).toMatchObject({ label: "Warning", text: "text-warning", severity: 1 });
    expect(sendingTone("THROTTLED")).toMatchObject({ label: "Throttled", text: "text-caution", severity: 2 });
    expect(sendingTone("PAUSED")).toMatchObject({ label: "Paused", text: "text-destructive", severity: 3 });
  });

  it("falls back for an unknown status instead of throwing", () => {
    expect(sendingTone("MYSTERY").label).toBe("Unknown");
  });

  it("only offers unpause when the tenant is restricted", () => {
    expect(canUnpause("ACTIVE")).toBe(false);
    expect(canUnpause("WARNING")).toBe(true);
    expect(canUnpause("PAUSED")).toBe(true);
  });

  it("bands rates by SES guidance", () => {
    expect(rateTone("bounce", 0.04)).toBe("ok");
    expect(rateTone("bounce", 0.05)).toBe("warn");
    expect(rateTone("bounce", 0.1)).toBe("danger");
    expect(rateTone("complaint", 0.0009)).toBe("ok");
    expect(rateTone("complaint", 0.001)).toBe("warn");
    expect(rateTone("complaint", 0.005)).toBe("danger");
  });
});

describe("number and limit formatting", () => {
  it("formats rates with two decimals", () => {
    expect(formatRate(0.0123)).toBe("1.23%");
    expect(formatRate(0)).toBe("0.00%");
    expect(formatRate(0.0004)).toBe("0.04%");
    expect(formatRate(null)).toBe("0.00%");
    expect(formatRate(Number.NaN)).toBe("0.00%");
  });

  it("groups thousands and tolerates missing values", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(undefined)).toBe("0");
  });

  it("formats usage against a limit", () => {
    expect(formatUsage(1200, 5000)).toBe("1,200 of 5,000");
    expect(formatUsage(1200, null)).toBe("1,200 of unlimited");
    expect(formatLimit(null)).toBe("Unlimited");
    expect(formatLimit(50000)).toBe("50,000");
  });

  it("computes usage ratio and tone", () => {
    expect(usageRatio(50, 100)).toBe(0.5);
    expect(usageRatio(150, 100)).toBe(1);
    expect(usageRatio(5, null)).toBeNull();
    expect(usageRatio(0, 0)).toBe(0);
    expect(usageRatio(3, 0)).toBe(1);
    expect(usageTone(79, 100)).toBe("ok");
    expect(usageTone(80, 100)).toBe("warn");
    expect(usageTone(100, 100)).toBe("danger");
    expect(usageTone(1e9, null)).toBe("ok");
  });

  it("parses limit inputs: blank is unlimited, digits only otherwise", () => {
    expect(parseLimit("")).toEqual({ ok: true, value: null });
    expect(parseLimit("  ")).toEqual({ ok: true, value: null });
    expect(parseLimit("5000")).toEqual({ ok: true, value: 5000 });
    expect(parseLimit("0")).toEqual({ ok: true, value: 0 });
    expect(parseLimit("-1")).toEqual({ ok: false });
    expect(parseLimit("1.5")).toEqual({ ok: false });
    expect(parseLimit("1e3")).toEqual({ ok: false });
    expect(parseLimit("99999999999999999999")).toEqual({ ok: false });
    expect(limitToText(null)).toBe("");
    expect(limitToText(250)).toBe("250");
  });

  it("formats the age of the oldest dead letter", () => {
    expect(formatAge(null)).toBe("none");
    expect(formatAge(-5)).toBe("none");
    expect(formatAge(42)).toBe("42 s");
    expect(formatAge(125)).toBe("2 min");
    expect(formatAge(3 * 3600 + 5 * 60)).toBe("3 h 5 min");
    expect(formatAge(2 * 86400 + 4 * 3600)).toBe("2 d 4 h");
  });
});
