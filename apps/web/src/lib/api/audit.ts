import { apiGet } from "./client";

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  meta: unknown;
  created_at: string;
  /** Actor display name; "system" when no user is attached. */
  user: string;
}

/** Last 200 events, newest first. Both filters are exact matches. */
export const listAuditLogs = (params: { action?: string; entityType?: string } = {}) =>
  apiGet<AuditLog[]>("/audit", { params });
