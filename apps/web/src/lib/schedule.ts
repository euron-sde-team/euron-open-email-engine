// Schedules are stored in UTC and shown in the tenant's timezone. These helpers turn
// a wall-clock time in a named zone into a UTC instant and back, using only Intl.

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const browserTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function listTimezones(): string[] {
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const zones = sv ? sv("timeZone") : [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/** Offset of `tz` from UTC at `instant`, in minutes (positive east of Greenwich). */
export function offsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/**
 * "2026-11-12T09:30" read as wall-clock time in `tz`, as a UTC ISO string. Times that do
 * not exist (spring-forward gap) resolve to the instant just after the gap.
 */
export function zonedToUtcIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m || !isValidTimezone(tz)) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset across a DST boundary.
  let guess = naive - offsetMinutes(new Date(naive), tz) * 60000;
  guess = naive - offsetMinutes(new Date(guess), tz) * 60000;
  const out = new Date(guess);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

/** A UTC ISO string as "YYYY-MM-DDTHH:mm" wall-clock time in `tz`, for a datetime-local input. */
export function utcToZonedInput(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "12 Nov 2026, 9:30 am IST" for an instant, in `tz`. */
export function formatInZone(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: isValidTimezone(tz) ? tz : "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

/** Why a chosen time cannot be used, or null when it is fine. Needs at least `minLeadMinutes` of lead. */
export function scheduleProblem(iso: string | null, now: Date = new Date(), minLeadMinutes = 5): string | null {
  if (!iso) return "Pick a date and time.";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "That date and time is not valid.";
  if (t < now.getTime() + minLeadMinutes * 60000) return `Pick a time at least ${minLeadMinutes} minutes from now.`;
  return null;
}
