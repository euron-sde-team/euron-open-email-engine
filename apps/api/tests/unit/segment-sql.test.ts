import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type Expression, type SqlBool } from "kysely";
import { describe, expect, it } from "vitest";
import type { DB } from "../../src/db/types";
import { rulesToExpression, validateRules, type SegmentRules } from "../../src/utils/segment-sql";

const k = new Kysely<DB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const compile = (rules: SegmentRules) =>
  k
    .selectFrom("contacts")
    .select("id")
    .where("tenant_id", "=", "T1")
    .where((eb) => rulesToExpression(eb as never, validateRules(rules)) as Expression<SqlBool>)
    .compile();

describe("segment SQL builder", () => {
  it("binds every value as a parameter and never inlines it", () => {
    const evil = "x'; DROP TABLE contacts; --";
    const q = compile({ match: "all", conditions: [{ field: "email", op: "contains", value: evil }, { field: "first_name", op: "is", value: evil }, { field: "attr:plan", op: "is", value: evil }, { field: "tag", op: "is", value: evil }] });
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.sql).not.toContain(evil);
    expect(q.parameters.filter((p) => String(p).includes("DROP TABLE")).length).toBeGreaterThanOrEqual(4);
  });

  it("binds the custom field key too", () => {
    const q = compile({ match: "all", conditions: [{ field: "attr:plan", op: "is", value: "pro" }] });
    expect(q.sql).toContain("contacts.attributes ->>");
    expect(q.parameters).toContain("plan");
    expect(q.sql).not.toContain("'plan'");
  });

  it("joins with AND for all and OR for any", () => {
    const conds = [{ field: "tag", op: "is" as const, value: "a" }, { field: "tag", op: "is" as const, value: "b" }];
    expect(compile({ match: "all", conditions: conds }).sql).toMatch(/ and /i);
    expect(compile({ match: "any", conditions: conds }).sql).toMatch(/ or /i);
  });

  it("escapes LIKE wildcards in contains and starts_with", () => {
    const q = compile({ match: "all", conditions: [{ field: "last_name", op: "contains", value: "50%_off" }] });
    expect(q.parameters).toContain("%50\\%\\_off%");
  });

  it("compiles engagement, date and list conditions", () => {
    const q = compile({ match: "all", conditions: [{ field: "opened_in_days", op: "in_last_days", value: 30 }, { field: "clicked_in_days", op: "not_in_last_days", value: 7 }, { field: "never_opened", op: "is", value: true }, { field: "created_at", op: "in_last_days", value: 10 }, { field: "list", op: "is", value: "L1" }] });
    expect(q.sql).toContain("last_opened_at");
    expect(q.sql).toContain("last_clicked_at");
    expect(q.sql).toContain("list_members");
    expect(q.parameters).toEqual(expect.arrayContaining([30, 7, 10, "L1"]));
  });
});

describe("rule validation", () => {
  it("rejects unknown fields, bad operators, bad keys and empty rules", () => {
    expect(() => validateRules(null)).toThrow();
    expect(() => validateRules({ match: "all", conditions: [] })).toThrow(/at least one/i);
    expect(() => validateRules({ match: "xor", conditions: [{ field: "email", op: "is", value: "a" }] })).toThrow();
    expect(() => validateRules({ match: "all", conditions: [{ field: "password_hash", op: "is", value: "a" }] })).toThrow(/Unknown field/);
    expect(() => validateRules({ match: "all", conditions: [{ field: "email", op: "gt", value: 1 }] })).toThrow(/does not support/);
    expect(() => validateRules({ match: "all", conditions: [{ field: "attr:Bad Key; --", op: "is", value: "a" }] })).toThrow(/custom field key/);
  });

  it("rejects out-of-range days and unknown statuses at build time", () => {
    expect(() => compile({ match: "all", conditions: [{ field: "opened_in_days", op: "in_last_days", value: 0 }] })).toThrow(/days/);
    expect(() => compile({ match: "all", conditions: [{ field: "status", op: "is", value: "NOPE" }] })).toThrow(/status/);
  });

  it("caps the number of conditions", () => {
    const conditions = Array.from({ length: 21 }, () => ({ field: "tag", op: "is" as const, value: "a" }));
    expect(() => validateRules({ match: "all", conditions })).toThrow(/At most/);
  });
});
