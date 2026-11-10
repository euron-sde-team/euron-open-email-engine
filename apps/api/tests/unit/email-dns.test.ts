import { describe, expect, it } from "vitest";
import {
  checkRecords,
  computeDnsRecords,
  isApexDomain,
  mapDomainStatus,
  normalizeSubdomain,
} from "../../src/utils/email-dns";

describe("normalizeSubdomain", () => {
  it("lowercases and accepts a valid subdomain", () => {
    expect(normalizeSubdomain("  Mail.Example.COM ")).toBe("mail.example.com");
  });

  it("rejects empty and malformed values", () => {
    expect(() => normalizeSubdomain("")).toThrow();
    expect(() => normalizeSubdomain("not a domain")).toThrow();
    expect(() => normalizeSubdomain("foo")).toThrow();
  });

  it("flags apex vs subdomain", () => {
    expect(isApexDomain("example.com")).toBe(true);
    expect(isApexDomain("mail.example.com")).toBe(false);
  });
});

describe("computeDnsRecords", () => {
  const records = computeDnsRecords("mail.example.com", ["t1", "t2", "t3"], "us-east-1", "track.platform.example");

  it("emits DKIM CNAMEs, MAIL FROM MX and SPF, sending SPF, DMARC and the tracking CNAME", () => {
    expect(records.filter((r) => r.purpose === "DKIM")).toHaveLength(3);
    expect(records.filter((r) => r.purpose === "MAIL FROM")).toHaveLength(2);
    expect(records.find((r) => r.purpose === "SPF")?.name).toBe("mail.example.com");
    expect(records.find((r) => r.purpose === "DMARC")?.name).toBe("_dmarc.mail.example.com");
    const tracking = records.find((r) => r.purpose === "TRACKING");
    expect(tracking).toMatchObject({ type: "CNAME", name: "track.mail.example.com", value: "track.platform.example", required: false });
  });

  it("marks DKIM and MAIL FROM required, advice optional, and nothing found yet", () => {
    expect(records.filter((r) => r.required).every((r) => ["DKIM", "MAIL FROM"].includes(r.purpose))).toBe(true);
    expect(records.every((r) => r.found === null)).toBe(true);
  });
});

describe("checkRecords with an injected resolver", () => {
  const records = computeDnsRecords("mail.example.com", ["t1"], "us-east-1", "track.platform.example");

  it("sets found from what the resolver returns", async () => {
    const resolver = {
      cname: async (n: string) => (n === "t1._domainkey.mail.example.com" ? ["t1.dkim.amazonses.com."] : []),
      txt: async (n: string) => (n === "mail.example.com" ? ["v=spf1 include:amazonses.com include:other.example ~all"] : []),
      mx: async () => [],
    };
    const out = await checkRecords(records, resolver);
    expect(out.find((r) => r.purpose === "DKIM")?.found).toBe(true);
    expect(out.find((r) => r.purpose === "SPF")?.found).toBe(true);
    expect(out.find((r) => r.purpose === "DMARC")?.found).toBe(false);
    expect(out.find((r) => r.type === "MX")?.found).toBe(false);
  });
});

describe("mapDomainStatus", () => {
  it("verifies only when DKIM and MAIL FROM both succeed", () => {
    expect(mapDomainStatus("SUCCESS", "SUCCESS", 0)).toBe("VERIFIED");
    expect(mapDomainStatus("SUCCESS", "PENDING", 0)).toBe("PENDING");
  });
  it("fails only after the 24 hour grace period", () => {
    expect(mapDomainStatus("FAILED", "SUCCESS", 1000)).toBe("PENDING");
    expect(mapDomainStatus("FAILED", "SUCCESS", 25 * 3600 * 1000)).toBe("FAILED");
  });
});
