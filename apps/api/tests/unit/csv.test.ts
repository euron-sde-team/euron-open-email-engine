import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "../../src/utils/csv";
import { prepareRow, validateMapping } from "../../src/services/imports.service";

describe("CSV parsing", () => {
  it("parses quoted fields, escaped quotes, embedded newlines and CRLF", () => {
    const r = parseCsv('email,name\r\na@example.com,"Lovelace, Ada"\r\nb@example.com,"say ""hi""\nnow"\r\n');
    expect(r.headers).toEqual(["email", "name"]);
    expect(r.rows).toEqual([["a@example.com", "Lovelace, Ada"], ["b@example.com", 'say "hi"\nnow']]);
  });

  it("strips a BOM and detects semicolons and tabs", () => {
    expect(parseCsv("﻿email;name\na@example.com;Ada").headers).toEqual(["email", "name"]);
    expect(parseCsv("email\tname\na@example.com\tAda").rows[0]).toEqual(["a@example.com", "Ada"]);
  });

  it("skips blank lines and handles a missing final newline", () => {
    expect(parseCsv("email\n\na@example.com\n\nb@example.com").rows).toEqual([["a@example.com"], ["b@example.com"]]);
  });

  it("stops at the row limit and says so", () => {
    const csv = "email\n" + Array.from({ length: 10 }, (_, i) => `u${i}@example.com`).join("\n");
    const r = parseCsv(csv, 5);
    expect(r.rows).toHaveLength(5);
    expect(r.truncated).toBe(true);
    expect(parseCsv(csv, 10).truncated).toBe(false);
  });
});

describe("CSV export is formula-injection safe", () => {
  it("prefixes values a spreadsheet would execute", () => {
    for (const v of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tx", "\rx"]) expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "x"')).toBe('"say ""x"""');
    expect(csvCell(null)).toBe("");
  });
  it("writes a header and CRLF rows", () => {
    expect(toCsv(["a", "b"], [["=x", 2]])).toBe("a,b\r\n'=x,2\r\n");
  });
});

describe("import mapping", () => {
  const headers = ["Email Address", "Full name", "Tags", "Plan", "Notes"];
  const custom = new Set(["plan"]);

  it("accepts a valid mapping and defaults unmapped columns to skip", () => {
    const m = validateMapping(headers, { "Email Address": "email", "Full name": "full_name", Tags: "tags", Plan: "attr:plan" }, custom);
    expect(m.Notes).toBe("skip");
  });

  it("requires exactly one email column and known targets", () => {
    expect(() => validateMapping(headers, { Plan: "attr:plan" }, custom)).toThrow(/exactly one/);
    expect(() => validateMapping(headers, { "Email Address": "email", Notes: "email" }, custom)).toThrow(/More than one/);
    expect(() => validateMapping(headers, { "Email Address": "email", Plan: "attr:unknown" }, custom)).toThrow(/unknown target/);
    expect(() => validateMapping(headers, { "Email Address": "email", Plan: "password" }, custom)).toThrow(/unknown target/);
    expect(() => validateMapping(headers, { "Email Address": "email", Ghost: "skip" }, custom)).toThrow(/Unknown column/);
  });

  it("builds a contact from a row, splitting names and tags", () => {
    const mapping = validateMapping(headers, { "Email Address": "email", "Full name": "full_name", Tags: "tags", Plan: "attr:plan" }, custom);
    const r = prepareRow([" ADA@Example.com ", "Ada King Lovelace", "vip; early-bird", "pro", "x"], headers, mapping);
    expect(r.row).toMatchObject({ email: "ada@example.com", first: "Ada", last: "King Lovelace", tags: ["vip", "early-bird"], attrs: { plan: "pro" } });
  });

  it("reports missing and invalid emails", () => {
    const mapping = validateMapping(headers, { "Email Address": "email" }, custom);
    expect(prepareRow(["", "", "", "", ""], headers, mapping).error?.reason).toBe("Missing email");
    expect(prepareRow(["not-an-email", "", "", "", ""], headers, mapping).error?.reason).toBe("Invalid email address");
  });
});
