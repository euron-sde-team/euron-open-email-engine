import type { Paged } from "@open-email/types";

/**
 * List endpoints return either a bare array or an object with `items`; paged ones add a
 * cursor and sometimes a total, flat (`nextCursor`) or under `page`. These normalise all
 * of them so a page never branches on the exact envelope.
 */
type Loose = { items?: unknown; data?: unknown; nextCursor?: unknown; total?: unknown; page?: { nextCursor?: unknown; total?: unknown } };

export function toArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const o = raw as Loose | null;
  if (o && Array.isArray(o.items)) return o.items as T[];
  if (o && Array.isArray(o.data)) return o.data as T[];
  return [];
}

export function toPage<T>(raw: unknown): Paged<T> {
  const o = (raw ?? {}) as Loose;
  const nextCursor = (o.nextCursor ?? o.page?.nextCursor ?? null) as string | null;
  const total = (o.total ?? o.page?.total) as number | undefined;
  return { items: toArray<T>(raw), nextCursor: nextCursor || null, ...(typeof total === "number" ? { total } : {}) };
}

/** Drop empty filters so the query string stays short. */
export function cleanParams<T extends object>(params: T): Partial<T> {
  return Object.fromEntries(Object.entries(params as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;
}
