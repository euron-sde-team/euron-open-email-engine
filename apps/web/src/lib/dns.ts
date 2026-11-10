// The DNS wizard's view of a domain: records grouped by the job they do, with the
// plain-language reason for each group and a found/not-found roll-up.

import type { DnsRecord } from "@open-email/types";

export interface PurposeInfo {
  purpose: string;
  title: string;
  /** What the record does, in one or two plain sentences. */
  help: string;
}

export const PURPOSES: PurposeInfo[] = [
  {
    purpose: "DKIM",
    title: "DKIM signing keys",
    help: "DKIM adds a digital signature to every message so inbox providers can tell it really came from your domain and was not altered on the way. Without it, mail is far more likely to land in spam.",
  },
  {
    purpose: "MAIL FROM",
    title: "Custom MAIL FROM",
    help: "MAIL FROM is the hidden return address that bounces are sent to. Pointing it at your own domain lines it up with the From address, which SPF and DMARC checks reward.",
  },
  {
    purpose: "SPF",
    title: "SPF sender policy",
    help: "SPF lists the servers allowed to send for your domain. The MAIL FROM records above already carry the SPF record Amazon SES needs; add this one only if you do not already publish one for the domain.",
  },
  {
    purpose: "DMARC",
    title: "DMARC policy",
    help: "DMARC tells inbox providers what to do when a message fails DKIM and SPF, and where to send reports. Start with a monitoring policy (p=none) and tighten it once the reports look clean.",
  },
  {
    purpose: "TRACKING",
    title: "Tracking domain",
    help: "Open and click tracking rewrites links to go through a subdomain of your own domain instead of a shared one. That keeps links on-brand and stops other senders' reputation rubbing off on you.",
  },
];

const KNOWN = new Map(PURPOSES.map((p) => [p.purpose, p]));

export type GroupState = "found" | "missing" | "unchecked";

export interface RecordGroup extends PurposeInfo {
  records: DnsRecord[];
  /** Any record in the group the domain cannot verify without. */
  required: boolean;
  foundCount: number;
  state: GroupState;
}

const norm = (p: string): string => p.trim().toUpperCase().replace(/[_-]+/g, " ");

function stateOf(records: DnsRecord[]): GroupState {
  if (records.every((r) => r.found === true)) return "found";
  if (records.some((r) => r.found === false)) return "missing";
  return "unchecked";
}

/** Records bucketed by purpose, in the order a person should publish them. Unknown purposes follow. */
export function groupRecords(records: DnsRecord[]): RecordGroup[] {
  const buckets = new Map<string, DnsRecord[]>();
  for (const r of records) {
    const key = norm(r.purpose);
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  const groups: RecordGroup[] = [];
  const order = [...PURPOSES.map((p) => p.purpose), ...[...buckets.keys()].filter((k) => !KNOWN.has(k))];
  for (const key of order) {
    const list = buckets.get(key);
    if (!list || list.length === 0) continue;
    const info = KNOWN.get(key) ?? { purpose: key, title: key.charAt(0) + key.slice(1).toLowerCase(), help: "" };
    groups.push({
      ...info,
      records: list,
      required: list.some((r) => r.required),
      foundCount: list.filter((r) => r.found === true).length,
      state: stateOf(list),
    });
  }
  return groups;
}

export interface DnsProgress {
  requiredTotal: number;
  requiredFound: number;
  optionalTotal: number;
  optionalFound: number;
  /** Every required record has been found. */
  complete: boolean;
}

export function dnsProgress(records: DnsRecord[]): DnsProgress {
  const req = records.filter((r) => r.required);
  const opt = records.filter((r) => !r.required);
  const requiredFound = req.filter((r) => r.found === true).length;
  return {
    requiredTotal: req.length,
    requiredFound,
    optionalTotal: opt.length,
    optionalFound: opt.filter((r) => r.found === true).length,
    complete: req.length > 0 && requiredFound === req.length,
  };
}

/**
 * The host to type into a DNS provider. Many providers append the zone themselves, so
 * the record name relative to the zone is offered as well as the full name.
 */
export function relativeName(name: string, zone: string): string {
  const n = name.replace(/\.$/, "").toLowerCase();
  const z = zone.replace(/\.$/, "").toLowerCase();
  if (n === z) return "@";
  return n.endsWith("." + z) ? n.slice(0, -(z.length + 1)) : n;
}

/** The registrable-ish parent of a sending subdomain: "mail.acme.example" gives "acme.example". */
export const parentZone = (domain: string): string => {
  const parts = domain.split(".");
  return parts.length > 2 ? parts.slice(1).join(".") : domain;
};
