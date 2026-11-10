// Pure helpers for the fleet views: sorting, status mapping and number
// formatting. No React, no DOM, so they are unit tested directly.

import type { FleetTenantRow, SendingStatus } from "@open-email/types";

export type FleetSortKey =
  | "name"
  | "status"
  | "sent14d"
  | "bounceRate"
  | "complaintRate"
  | "verifiedDomains"
  | "contacts";

export type SortDir = "asc" | "desc";

export interface SendingTone {
  label: string;
  /** Tailwind text colour class. */
  text: string;
  /** Tailwind background class for the status dot. */
  dot: string;
  /** 0 is healthy; higher is worse. Used to sort by severity. */
  severity: 0 | 1 | 2 | 3;
}

const TONES: Record<SendingStatus, SendingTone> = {
  ACTIVE: { label: "Active", text: "text-success", dot: "bg-success", severity: 0 },
  WARNING: { label: "Warning", text: "text-warning", dot: "bg-warning", severity: 1 },
  THROTTLED: { label: "Throttled", text: "text-caution", dot: "bg-caution", severity: 2 },
  PAUSED: { label: "Paused", text: "text-destructive", dot: "bg-destructive", severity: 3 },
};

const UNKNOWN_TONE: SendingTone = {
  label: "Unknown",
  text: "text-muted-foreground",
  dot: "bg-muted-foreground",
  severity: 0,
};

export const SENDING_STATUSES: SendingStatus[] = ["ACTIVE", "WARNING", "THROTTLED", "PAUSED"];

export const sendingTone = (status: SendingStatus | string): SendingTone =>
  (TONES as Record<string, SendingTone>)[status] ?? UNKNOWN_TONE;

/** Whether an operator can lift the restriction (anything but ACTIVE). */
export const canUnpause = (status: SendingStatus): boolean => status !== "ACTIVE";

/**
 * Rates are 0 to 1. The bands follow Amazon SES guidance: bounce review at 5%
 * and pause risk at 10%; complaint review at 0.1% and pause risk at 0.5%.
 */
export const RATE_BANDS = {
  bounce: { warn: 0.05, danger: 0.1 },
  complaint: { warn: 0.001, danger: 0.005 },
} as const;

export type RateTone = "ok" | "warn" | "danger";

export const rateTone = (kind: keyof typeof RATE_BANDS, rate: number): RateTone => {
  const band = RATE_BANDS[kind];
  if (rate >= band.danger) return "danger";
  if (rate >= band.warn) return "warn";
  return "ok";
};

export const RATE_TEXT: Record<RateTone, string> = {
  ok: "text-foreground",
  warn: "text-warning",
  danger: "text-destructive",
};

/** 0.0123 -> "1.23%". Complaint rates are tiny, so two decimals always. */
export const formatRate = (rate: number | null | undefined): string => {
  if (rate == null || !Number.isFinite(rate)) return "0.00%";
  return `${(rate * 100).toFixed(2)}%`;
};

const intFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const formatCount = (n: number | null | undefined): string =>
  intFormatter.format(Number.isFinite(n as number) ? (n as number) : 0);

/** "1,200 of 5,000" or "1,200 of unlimited". */
export const formatUsage = (used: number, limit: number | null): string =>
  `${formatCount(used)} of ${limit == null ? "unlimited" : formatCount(limit)}`;

/** A plan limit for display: null is unlimited. */
export const formatLimit = (limit: number | null | undefined): string =>
  limit == null ? "Unlimited" : formatCount(limit);

/** 0 to 1, or null when the limit is unlimited. Over-quota clamps to 1. */
export const usageRatio = (used: number, limit: number | null): number | null => {
  if (limit == null) return null;
  if (limit <= 0) return used > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, used / limit));
};

export type UsageTone = "ok" | "warn" | "danger";

export const usageTone = (used: number, limit: number | null): UsageTone => {
  const ratio = usageRatio(used, limit);
  if (ratio == null) return "ok";
  if (ratio >= 1) return "danger";
  if (ratio >= 0.8) return "warn";
  return "ok";
};

/** Form text -> limit. Blank means unlimited (null); otherwise a non-negative integer. */
export const parseLimit = (text: string): { ok: true; value: number | null } | { ok: false } => {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
};

export const limitToText = (limit: number | null | undefined): string =>
  limit == null ? "" : String(limit);

/** "3 days 4 hours" style age for the dead-letter queue. */
export const formatAge = (seconds: number | null | undefined): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "none";
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
};

const compare = (a: number | string, b: number | string): number =>
  typeof a === "string" && typeof b === "string"
    ? a.localeCompare(b, "en", { sensitivity: "base" })
    : (a as number) - (b as number);

const sortValue = (row: FleetTenantRow, key: FleetSortKey): number | string => {
  if (key === "status") return sendingTone(row.status).severity;
  if (key === "name") return row.name;
  return row[key];
};

/**
 * A new array sorted by `key`. Ties break by name so the order is stable and
 * predictable; `status` sorts by severity (worst last ascending, worst first
 * descending).
 */
export const sortFleet = (
  rows: readonly FleetTenantRow[],
  key: FleetSortKey,
  dir: SortDir,
): FleetTenantRow[] => {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compare(sortValue(a, key), sortValue(b, key)) * sign;
    return primary !== 0 ? primary : a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
};

/** The direction a column starts in when first clicked: worst-first for metrics, A to Z for names. */
export const defaultDir = (key: FleetSortKey): SortDir => (key === "name" ? "asc" : "desc");

/** Rows whose status is not ACTIVE, worst first. */
export const needsAttention = (rows: readonly FleetTenantRow[]): FleetTenantRow[] =>
  sortFleet(rows.filter((r) => r.status !== "ACTIVE"), "status", "desc");
