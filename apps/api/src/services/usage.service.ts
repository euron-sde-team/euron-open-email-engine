import { sql } from "kysely";
import { db } from "../db/connection";
import { LIMIT_CODES } from "../constants/modules.const";
import entitlementsService from "./entitlements.service";

/** First day of the UTC month containing `at`, as YYYY-MM-DD. */
export const monthKey = (at: Date = new Date()): string =>
  `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;

/** First instant of the next UTC month: when the monthly quota resets. */
export const nextMonthStart = (at: Date = new Date()): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));

/**
 * Pure quota arithmetic. `limit` null means unlimited. Returns how many more emails fit
 * and whether `wanted` of them do.
 */
export const quotaMath = (
  limit: number | null,
  used: number,
  wanted = 0
): { remaining: number | null; fits: boolean } => {
  if (limit === null) return { remaining: null, fits: true };
  const remaining = Math.max(0, limit - used);
  return { remaining, fits: wanted <= remaining };
};

// Emails sent per tenant and calendar month (UTC). Reservation is one conditional UPDATE, so
// concurrent workers can never overshoot the plan's monthly quota.
class UsageService {
  /** The plan's monthly email quota; null means unlimited. */
  async monthlyLimit(tenantId: string): Promise<number | null> {
    const limit = await entitlementsService.getLimit(tenantId, LIMIT_CODES.MONTHLY_EMAILS);
    if (limit === null || limit === Infinity) return null;
    return limit;
  }

  async emailsSentThisMonth(tenantId: string, at: Date = new Date()): Promise<number> {
    const row = await db
      .selectFrom("tenant_usage_monthly")
      .select("emails_sent")
      .where("tenant_id", "=", tenantId)
      .where(sql<boolean>`month = ${monthKey(at)}::date`)
      .executeTakeFirst();
    return Number(row?.emails_sent ?? 0);
  }

  async remaining(tenantId: string): Promise<number | null> {
    const [limit, used] = await Promise.all([
      this.monthlyLimit(tenantId),
      this.emailsSentThisMonth(tenantId),
    ]);
    return quotaMath(limit, used).remaining;
  }

  /** Takes `n` emails from this month's quota; false when they do not fit. */
  async reserve(tenantId: string, n = 1, limit?: number | null): Promise<boolean> {
    const cap = limit === undefined ? await this.monthlyLimit(tenantId) : limit;
    const month = monthKey();
    const now = new Date();
    await db
      .insertInto("tenant_usage_monthly")
      .values({ tenant_id: tenantId, month: sql`${month}::date` as never, emails_sent: 0, updated_at: now })
      .onConflict((oc) => oc.columns(["tenant_id", "month"]).doNothing())
      .execute();
    const res = await db
      .updateTable("tenant_usage_monthly")
      .set({ emails_sent: sql`emails_sent + ${n}`, updated_at: now })
      .where("tenant_id", "=", tenantId)
      .where(sql<boolean>`month = ${month}::date`)
      .where(sql<boolean>`(${cap}::int IS NULL OR emails_sent + ${n} <= ${cap}::int)`)
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0) > 0;
  }

  /** Gives back emails that were reserved but never handed to the provider. */
  async release(tenantId: string, n = 1): Promise<void> {
    await db
      .updateTable("tenant_usage_monthly")
      .set({ emails_sent: sql`GREATEST(emails_sent - ${n}, 0)`, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where(sql<boolean>`month = ${monthKey()}::date`)
      .execute();
  }
}

export default new UsageService();
