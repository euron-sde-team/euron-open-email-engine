import { ulid } from "ulid";
import { db } from "../db/connection";
import auditRepository, { AuditListParams } from "../repositories/audit.repository";
import logger from "../utils/logger";

class AuditService {
  /**
   * Records a tenant audit event. Fire-and-forget: an audit hiccup must never fail the
   * request that caused it. Never put secrets or full message bodies in `meta`.
   */
  record(
    tenantId: string,
    userId: string | null,
    action: string,
    entityType?: string | null,
    entityId?: string | null,
    meta?: Record<string, unknown> | null
  ): void {
    void db
      .insertInto("audit_logs")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        user_id: userId,
        action,
        entity_type: entityType ?? null,
        entity_id: entityId ?? null,
        meta: meta ? JSON.stringify(meta) : null,
        created_at: new Date(),
      })
      .execute()
      .catch((err) => logger.warn(`audit write failed (${action}): ${String(err)}`));
  }

  async list(tenantId: string, params: AuditListParams) {
    const rows = await auditRepository.list(tenantId, params);
    return rows.map(({ user_name, ...row }) => ({ ...row, user: user_name ?? "system" }));
  }
}

export default new AuditService();
