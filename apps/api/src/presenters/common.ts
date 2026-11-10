export const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();

export const isoReq = (d: Date | string): string => new Date(d).toISOString();

/** Kysely returns bigint and count() as strings: normalise before arithmetic. */
export const num = (v: unknown): number => (typeof v === "string" ? parseInt(v, 10) : Number(v ?? 0));

export const EMAIL_RE = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']{2,}$/;

export const normEmail = (v: unknown): string => String(v ?? "").trim().toLowerCase();

export const clampLimit = (raw: unknown, def = 50, max = 200): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
};
