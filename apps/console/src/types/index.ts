// Shared types for the operator console. These mirror the response
// shapes of apps/api (operator plane) (every endpoint wraps payloads in the
// envelope below; the axios client unwraps `.data` before callers see these).

// ---- API envelope ----

export interface ApiSuccessEnvelope<T> {
  data: T;
  statusCode: number;
  message: string;
  success: true;
}

export interface ApiErrorEnvelope {
  error: { message: string };
  statusCode: number;
  message: string;
  success: false;
}

// ---- Operators / auth ----

export type OperatorRole = "SUPERADMIN" | "OPERATOR";
export type OperatorStatus = "ACTIVE" | "DISABLED" | "PENDING";

export interface OperatorUser {
  id: string;
  name: string;
  email: string;
  role: OperatorRole;
  status: OperatorStatus;
  last_login_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateOperatorResponse extends OperatorUser {
  // Whether the invite email carrying the temporary password went out.
  emailed: boolean;
  // Returned only when the password was generated AND email is unconfigured:
  // the sole chance to read it. Absent whenever a password was supplied.
  tempPassword?: string;
}

export interface LoginResponse {
  token: string;
  user: OperatorUser;
}

// ---- Plans ----

export type { PlanLimits } from "@open-email/types";
import type { PlanLimits } from "@open-email/types";

export interface Plan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** Email module keys the plan grants (see lib/constants/modules). */
  modules: string[];
  limits: PlanLimits;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---- Tenants ----

export type TenantStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan_key: string | null;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

export interface TenantUsage {
  users: number;
  contacts: number;
}

export interface TenantWithUsage extends Tenant {
  usage: TenantUsage;
}

export type EntitlementSource = "PLAN" | "ADMIN";

export interface Entitlement {
  id: string;
  tenant_id: string;
  code: string;
  enabled: boolean;
  limit_value: number | null;
  source: EntitlementSource;
  created_at: string;
  updated_at: string;
}

export interface TenantAdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

export interface TenantDetail {
  tenant: Tenant;
  entitlements: Entitlement[];
  usage: TenantUsage;
  adminUsers: TenantAdminUser[];
}

export interface CreateTenantPayload {
  name: string;
  slug?: string;
  plan_key: string;
  // The admin's first password is generated server-side and emailed to
  // them; the operator never sets or sees it.
  admin: { name: string; email: string };
}

export interface CreateTenantResponse {
  tenant: Tenant;
  adminUser: TenantAdminUser;
  entitlements: Entitlement[];
  emailDispatched: boolean;
}

// ---- Audit ----

export interface AuditRow {
  id: string;
  actor_operator_id: string | null;
  actor_email: string | null;
  action: string;
  category: string;
  tenant_id: string | null;
  resource_id: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
