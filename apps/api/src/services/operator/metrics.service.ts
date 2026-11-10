import { sql } from "kysely";
import { db } from "../../db/connection";
import { monthKey } from "../usage.service";

export interface MetricsOverview {
  tenants: { total: number; byStatus: Record<string, number> };
  planDistribution: Array<{ plan_key: string; count: number }>;
  totals: { users: number; contacts: number; emailsThisMonth: number };
}

class MetricsService {
  async overview(): Promise<MetricsOverview> {
    const [statusRows, planRows, usersRow, contactsRow, emailsRow] = await Promise.all([
      db
        .selectFrom("tenants")
        .select(["status", db.fn.count<number>("id").as("n")])
        .groupBy("status")
        .execute(),
      db
        .selectFrom("tenants")
        .select(["plan_key", db.fn.count<number>("id").as("n")])
        .where("plan_key", "is not", null)
        .groupBy("plan_key")
        .orderBy("n", "desc")
        .execute(),
      db.selectFrom("users").select(db.fn.count<number>("id").as("n")).executeTakeFirst(),
      db.selectFrom("contacts").select(db.fn.count<number>("id").as("n")).executeTakeFirst(),
      db
        .selectFrom("tenant_usage_monthly")
        .select(sql<number>`coalesce(sum(emails_sent), 0)`.as("n"))
        .where(sql<boolean>`month = ${monthKey()}::date`)
        .executeTakeFirst(),
    ]);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of statusRows) {
      const n = Number(row.n);
      byStatus[row.status] = n;
      total += n;
    }

    return {
      tenants: { total, byStatus },
      planDistribution: planRows.map((row) => ({ plan_key: row.plan_key as string, count: Number(row.n) })),
      totals: {
        users: Number(usersRow?.n ?? 0),
        contacts: Number(contactsRow?.n ?? 0),
        emailsThisMonth: Number(emailsRow?.n ?? 0),
      },
    };
  }
}

export default new MetricsService();
