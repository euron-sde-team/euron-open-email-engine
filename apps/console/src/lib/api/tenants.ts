import { apiGet, apiPost, apiPut } from "@/lib/api/client";
import type {
  Entitlement,
  CreateTenantPayload,
  CreateTenantResponse,
  Tenant,
  TenantDetail,
  TenantStatus,
  TenantWithUsage,
} from "@/types";

export const listTenants = (params?: { q?: string; status?: string }) =>
  apiGet<TenantWithUsage[]>("/tenants", {
    params: {
      ...(params?.q ? { q: params.q } : {}),
      ...(params?.status ? { status: params.status } : {}),
    },
  });

export const getTenant = (id: string) => apiGet<TenantDetail>(`/tenants/${id}`);

export const createTenant = (payload: CreateTenantPayload) =>
  apiPost<CreateTenantResponse>("/tenants", payload);

export const updateTenant = (
  id: string,
  payload: {
    name?: string;
    status?: TenantStatus;
    plan_key?: string;
  }
) => apiPut<Tenant>(`/tenants/${id}`, payload);

export const overrideEntitlement = (
  id: string,
  payload: { code: string; enabled?: boolean; limit_value?: number | null }
) => apiPut<Entitlement>(`/tenants/${id}/entitlements`, payload);
