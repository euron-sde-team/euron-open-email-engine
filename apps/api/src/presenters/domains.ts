import type { EmailSendingDomainRow } from "../repositories/email-domains.repository";
import type { DnsRecord } from "../utils/email-dns";
import { iso, isoReq } from "./common";

export const parseDnsRecords = (value: unknown): DnsRecord[] => {
  if (Array.isArray(value)) return value as DnsRecord[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as DnsRecord[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

// SendingDomain in @open-email/types.
export const toDomainDto = (row: EmailSendingDomainRow) => ({
  id: row.id,
  domain: row.subdomain,
  mailFromDomain: row.mail_from_subdomain ?? `bounce.${row.subdomain}`,
  status: row.status,
  dkimStatus: row.dkim_status,
  mailFromStatus: row.mail_from_status,
  records: parseDnsRecords(row.dns_records).map((r) => ({
    type: r.type,
    name: r.name,
    value: r.value,
    purpose: r.purpose,
    found: r.found ?? null,
    required: r.required,
  })),
  failureReason: row.failure_reason,
  verifiedAt: iso(row.verified_at),
  lastCheckedAt: iso(row.last_checked_at),
  trackingDomain: row.tracking_domain,
  trackingStatus: (row.tracking_status === "VERIFIED" ? "VERIFIED" : "PENDING") as "PENDING" | "VERIFIED",
  createdAt: isoReq(row.created_at),
});
