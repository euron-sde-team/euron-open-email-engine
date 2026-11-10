import { Selectable, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { email_category, email_suppression_reason } from "../db/enums";
import type { email_suppressions } from "../db/types";

export type EmailSuppressionRow = Selectable<email_suppressions>;

class EmailSuppressionsRepository {
  // True when the recipient is suppressed for this category (a global
  // suppression, category_scope = null, blocks every category).
  async isSuppressed(tenantId: string, email: string, category: email_category): Promise<boolean> {
    const row = await db
      .selectFrom("email_suppressions")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("email", "=", email.toLowerCase())
      .where((eb) => eb.or([eb("category_scope", "is", null), eb("category_scope", "=", category)]))
      .executeTakeFirst();
    return !!row;
  }

  // Upsert on the partial unique indexes (scoped and global are separate).
  async add(
    tenantId: string,
    email: string,
    reason: email_suppression_reason,
    categoryScope: email_category | null,
    note: string | null = null
  ): Promise<void> {
    const now = new Date();
    const lower = email.toLowerCase();
    if (categoryScope === null) {
      await sql`
        INSERT INTO email_suppressions (id, tenant_id, email, reason, category_scope, note, created_at, updated_at)
        VALUES (${ulid()}, ${tenantId}, ${lower}, ${reason}::email_suppression_reason, NULL, ${note}, ${now}, ${now})
        ON CONFLICT (tenant_id, email) WHERE category_scope IS NULL
        DO UPDATE SET reason = EXCLUDED.reason, note = COALESCE(EXCLUDED.note, email_suppressions.note), updated_at = EXCLUDED.updated_at`.execute(db);
    } else {
      await sql`
        INSERT INTO email_suppressions (id, tenant_id, email, reason, category_scope, note, created_at, updated_at)
        VALUES (${ulid()}, ${tenantId}, ${lower}, ${reason}::email_suppression_reason, ${categoryScope}::email_category, ${note}, ${now}, ${now})
        ON CONFLICT (tenant_id, email, category_scope) WHERE category_scope IS NOT NULL
        DO UPDATE SET reason = EXCLUDED.reason, note = COALESCE(EXCLUDED.note, email_suppressions.note), updated_at = EXCLUDED.updated_at`.execute(db);
    }
  }

  async list(
    tenantId: string,
    opts: { q?: string; reason?: email_suppression_reason; cursor?: string; limit: number }
  ): Promise<EmailSuppressionRow[]> {
    let qb = db.selectFrom("email_suppressions").selectAll().where("tenant_id", "=", tenantId);
    if (opts.q) qb = qb.where("email", "like", `%${opts.q.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`);
    if (opts.reason) qb = qb.where("reason", "=", opts.reason);
    if (opts.cursor) qb = qb.where("id", "<", opts.cursor);
    return qb.orderBy("id", "desc").limit(opts.limit + 1).execute();
  }

  async findById(id: string, tenantId: string): Promise<EmailSuppressionRow | undefined> {
    return db
      .selectFrom("email_suppressions")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await db.deleteFrom("email_suppressions").where("id", "=", id).where("tenant_id", "=", tenantId).execute();
  }
}

export default new EmailSuppressionsRepository();
