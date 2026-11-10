import { describe, expect, it } from "vitest";
import type { DnsRecord } from "@open-email/types";
import { dnsProgress, groupRecords, parentZone, relativeName } from "./dns";

const rec = (purpose: string, found: boolean | null, required = true, name = `${purpose}.x`): DnsRecord => ({
  type: "CNAME",
  name,
  value: "v",
  purpose,
  found,
  required,
});

describe("dns records", () => {
  const records = [
    rec("TRACKING", null, false),
    rec("DKIM", true),
    rec("DKIM", true),
    rec("DKIM", true),
    rec("MAIL FROM", false),
    rec("MAIL FROM", true),
    rec("DMARC", null, false),
    rec("SPF", null, false),
    rec("custom thing", null, false),
  ];

  it("groups by purpose in publishing order", () => {
    const groups = groupRecords(records);
    expect(groups.map((g) => g.purpose)).toEqual(["DKIM", "MAIL FROM", "SPF", "DMARC", "TRACKING", "CUSTOM THING"]);
    expect(groups[0]).toMatchObject({ state: "found", foundCount: 3, required: true });
    expect(groups[1]).toMatchObject({ state: "missing", foundCount: 1 });
    expect(groups[2]).toMatchObject({ state: "unchecked", required: false });
    expect(groups[0].help).toMatch(/signature/);
  });

  it("counts progress on required records only for completion", () => {
    expect(dnsProgress(records)).toEqual({ requiredTotal: 5, requiredFound: 4, optionalTotal: 4, optionalFound: 0, complete: false });
    expect(dnsProgress([rec("DKIM", true)]).complete).toBe(true);
    expect(dnsProgress([]).complete).toBe(false);
  });

  it("derives the host a DNS provider expects", () => {
    expect(relativeName("abc._domainkey.mail.acme.example", "acme.example")).toBe("abc._domainkey.mail");
    expect(relativeName("acme.example.", "acme.example")).toBe("@");
    expect(parentZone("mail.acme.example")).toBe("acme.example");
    expect(parentZone("acme.example")).toBe("acme.example");
  });
});
