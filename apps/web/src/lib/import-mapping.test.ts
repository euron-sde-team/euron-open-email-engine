import { describe, expect, it } from "vitest";
import { mappedColumns, suggestMapping, validateMapping } from "./import-mapping";

describe("import column mapping", () => {
  it("guesses common header spellings", () => {
    expect(suggestMapping(["E-mail Address", "First Name", "Surname", "Notes"])).toEqual({
      "E-mail Address": "email",
      "First Name": "first_name",
      Surname: "last_name",
      Notes: "skip",
    });
  });

  it("matches custom fields by key or label and survives a BOM", () => {
    const m = suggestMapping(["﻿email", "Plan Tier", "company"], [
      { key: "plan_tier", label: "Plan tier" },
      { key: "company", label: "Company" },
    ]);
    expect(m["﻿email"]).toBe("email");
    expect(m["Plan Tier"]).toBe("attr:plan_tier");
    expect(m["company"]).toBe("attr:company");
  });

  it("lets only the first column claim a target", () => {
    const m = suggestMapping(["email", "Email Address"]);
    expect(m.email).toBe("email");
    expect(m["Email Address"]).toBe("skip");
  });

  it("uses a full-name column only when first and last are absent", () => {
    expect(suggestMapping(["Name", "Email"]).Name).toBe("full_name");
    expect(suggestMapping(["Name", "First name", "Email"]).Name).toBe("skip");
  });

  it("requires an email column and no duplicate targets", () => {
    expect(validateMapping({ a: "first_name" }).ok).toBe(false);
    expect(validateMapping({ a: "email", b: "email" }).ok).toBe(false);
    expect(validateMapping({ a: "email", b: "tags", c: "tags" }).ok).toBe(true);
    expect(mappedColumns({ a: "email", b: "skip" })).toEqual([{ header: "a", target: "email" }]);
  });
});
