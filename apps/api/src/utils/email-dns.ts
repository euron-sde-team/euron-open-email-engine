import dns from "dns/promises";
import type { email_domain_status } from "../db/enums";

export interface DnsRecord {
  type: "CNAME" | "TXT" | "MX";
  name: string;
  value: string;
  /** "DKIM", "MAIL FROM", "SPF", "DMARC", "TRACKING". */
  purpose: string;
  /** Whether the last check found it (null before the first check). */
  found: boolean | null;
  required: boolean;
  priority?: number;
}

const SUBDOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// Lowercase + structural validation. Returns the normalized value or throws a
// message the caller turns into a BadRequestError.
export const normalizeSubdomain = (raw: string): string => {
  const value = String(raw || "").trim().toLowerCase().replace(/\.$/, "");
  if (!value) throw new Error("Domain is required");
  if (value.length > 253) throw new Error("Domain is too long");
  if (!SUBDOMAIN_RE.test(value)) throw new Error("Enter a valid domain (e.g. mail.example.com)");
  return value;
};

// True when the domain has no subdomain label (apex, e.g. example.com). Allowed, but the UI
// warns, since a dedicated subdomain is recommended.
export const isApexDomain = (subdomain: string): boolean => subdomain.split(".").length === 2;

export const mailFromFor = (subdomain: string): string => `bounce.${subdomain}`;
export const trackingDomainFor = (subdomain: string): string => `track.${subdomain}`;

const SPF_VALUE = "v=spf1 include:amazonses.com ~all";

// The DNS records the tenant must publish: DKIM CNAMEs, custom MAIL FROM MX + SPF, the
// sending SPF and a starter DMARC policy (both recommended, not required), and the tracking
// CNAME that serves links and the open pixel from the tenant's own domain.
export const computeDnsRecords = (
  subdomain: string,
  dkimTokens: string[],
  region: string,
  trackingHost: string
): DnsRecord[] => {
  const mailFrom = mailFromFor(subdomain);
  return [
    ...dkimTokens.map((t) => ({
      type: "CNAME" as const,
      name: `${t}._domainkey.${subdomain}`,
      value: `${t}.dkim.amazonses.com`,
      purpose: "DKIM",
      found: null,
      required: true,
    })),
    {
      type: "MX" as const,
      name: mailFrom,
      value: `feedback-smtp.${region}.amazonses.com`,
      priority: 10,
      purpose: "MAIL FROM",
      found: null,
      required: true,
    },
    { type: "TXT" as const, name: mailFrom, value: SPF_VALUE, purpose: "MAIL FROM", found: null, required: true },
    { type: "TXT" as const, name: subdomain, value: SPF_VALUE, purpose: "SPF", found: null, required: false },
    {
      type: "TXT" as const,
      name: `_dmarc.${subdomain}`,
      value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${subdomain}`,
      purpose: "DMARC",
      found: null,
      required: false,
    },
    {
      type: "CNAME" as const,
      name: trackingDomainFor(subdomain),
      value: trackingHost,
      purpose: "TRACKING",
      found: null,
      required: false,
    },
  ];
};

// ─── Lookups ─────────────────────────────────────────────────────────────────

/** Injectable so tests and simulated mode never touch the network. */
export interface DnsResolver {
  cname(name: string): Promise<string[]>;
  txt(name: string): Promise<string[]>;
  mx(name: string): Promise<string[]>;
}

export const systemResolver: DnsResolver = {
  cname: (n) => dns.resolveCname(n).catch(() => []),
  txt: (n) => dns.resolveTxt(n).then((r) => r.map((p) => p.join(""))).catch(() => []),
  mx: (n) => dns.resolveMx(n).then((r) => r.map((m) => m.exchange)).catch(() => []),
};

const norm = (v: string): string => v.trim().toLowerCase().replace(/\.$/, "");

const matches = (rec: DnsRecord, seen: string[]): boolean => {
  if (rec.type === "TXT") {
    // SPF and DMARC are matched by their meaningful token, not byte for byte: records are
    // often merged with other includes.
    const want = rec.value.toLowerCase();
    if (want.startsWith("v=spf1")) return seen.some((s) => s.toLowerCase().includes("include:amazonses.com"));
    if (want.startsWith("v=dmarc1")) return seen.some((s) => s.toLowerCase().startsWith("v=dmarc1"));
    return seen.some((s) => norm(s) === norm(rec.value));
  }
  return seen.some((s) => norm(s) === norm(rec.value));
};

/** Looks each record up and returns copies with `found` set. */
export const checkRecords = async (records: DnsRecord[], resolver: DnsResolver): Promise<DnsRecord[]> =>
  Promise.all(
    records.map(async (r) => {
      const seen = r.type === "CNAME" ? await resolver.cname(r.name) : r.type === "MX" ? await resolver.mx(r.name) : await resolver.txt(r.name);
      return { ...r, found: matches(r, seen) };
    })
  );

const VERIFY_GRACE_MS = 24 * 60 * 60 * 1000;

// Map SES DKIM + MAIL FROM statuses to our domain status. FAILED only after a 24h grace so
// a slow DNS propagation does not prematurely fail the domain.
export const mapDomainStatus = (
  dkimStatus: string | null,
  mailFromStatus: string | null,
  ageMs: number
): email_domain_status => {
  if (dkimStatus === "SUCCESS" && mailFromStatus === "SUCCESS") return "VERIFIED";
  if ((dkimStatus === "FAILED" || mailFromStatus === "FAILED") && ageMs > VERIFY_GRACE_MS) {
    return "FAILED";
  }
  return "PENDING";
};
