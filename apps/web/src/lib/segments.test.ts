import { describe, expect, it } from "vitest";
import type { SegmentRules } from "@open-email/types";
import { changeField, changeOp, describeRules, isComplete, newCondition, opsFor, sameRules, serializeRules, valueKind } from "./segments";

const attrType = (k: string) => (k === "visits" ? "number" : k === "joined" ? "date" : k === "vip" ? "boolean" : "text");

describe("segment rules", () => {
  it("drops incomplete rows and coerces numbers when serialising", () => {
    const rules: SegmentRules = {
      match: "any",
      conditions: [
        { field: "tag", op: "is", value: "  vip " },
        { field: "tag", op: "is", value: "" },
        { field: "opened_in_days", op: "in_last_days", value: "30" },
        { field: "attr:visits", op: "gt", value: "4" },
        { field: "email", op: "is", value: "Maya@Example.com" },
        { field: "first_name", op: "is_set" },
        { field: "never_opened", op: "is" },
      ],
    };
    expect(serializeRules(rules, attrType)).toEqual({
      match: "any",
      conditions: [
        { field: "tag", op: "is", value: "vip" },
        { field: "opened_in_days", op: "in_last_days", value: 30 },
        { field: "attr:visits", op: "gt", value: 4 },
        { field: "email", op: "is", value: "maya@example.com" },
        { field: "first_name", op: "is_set" },
        { field: "never_opened", op: "is", value: true },
      ],
    });
  });

  it("rejects non-positive day windows and non-numeric numbers", () => {
    expect(isComplete({ field: "opened_in_days", op: "in_last_days", value: 0 })).toBe(false);
    expect(isComplete({ field: "attr:visits", op: "gt", value: "abc" }, attrType)).toBe(false);
    expect(isComplete({ field: "attr:visits", op: "gt", value: "0" }, attrType)).toBe(true);
  });

  it("offers only operators that make sense for the field", () => {
    expect(opsFor("status")).toEqual(["is", "is_not"]);
    expect(opsFor("attr:visits", attrType)).toContain("gt");
    expect(opsFor("attr:vip", attrType)).toEqual(["is"]);
    expect(opsFor("opened_in_days")).toEqual(["in_last_days", "not_in_last_days"]);
  });

  it("resets the value when the field or operator changes shape", () => {
    const c = { field: "tag" as const, op: "is" as const, value: "vip" };
    expect(changeField(c, "email")).toEqual({ field: "email", op: "is" });
    expect(changeField(c, "opened_in_days")).toEqual({ field: "opened_in_days", op: "in_last_days", value: 30 });
    expect(changeOp({ field: "email", op: "is", value: "a" }, "is_set")).toEqual({ field: "email", op: "is_set" });
    expect(changeOp({ field: "email", op: "is", value: "a" }, "contains")).toEqual({ field: "email", op: "contains", value: "a" });
  });

  it("starts a new row with a usable operator", () => {
    expect(newCondition("created_at")).toEqual({ field: "created_at", op: "in_last_days", value: 30 });
    expect(valueKind("never_opened", "is")).toBe("none");
  });

  it("describes rules in plain words", () => {
    const rules: SegmentRules = {
      match: "all",
      conditions: [
        { field: "list", op: "is", value: "L1" },
        { field: "opened_in_days", op: "not_in_last_days", value: 90 },
        { field: "status", op: "is", value: "PENDING_CONFIRMATION" },
      ],
    };
    expect(describeRules(rules, { listName: () => "Customers" })).toBe(
      "List is Customers and Did not open an email in the last 90 days and Status is pending confirmation",
    );
    expect(describeRules({ match: "any", conditions: [] })).toBe("Everyone");
  });

  it("compares rule sets by what would be sent", () => {
    const a: SegmentRules = { match: "all", conditions: [{ field: "tag", op: "is", value: "vip" }, { field: "tag", op: "is", value: "" }] };
    const b: SegmentRules = { match: "all", conditions: [{ field: "tag", op: "is", value: "vip" }] };
    expect(sameRules(a, b)).toBe(true);
  });
});
