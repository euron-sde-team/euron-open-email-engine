import type { Tenant, TenantSettings } from "@/types";
import { apiGet, apiPut } from "./client";

/** Full tenant row as returned by GET /tenant/me and PUT /tenant/me. */
export type TenantWorkspace = Tenant & {
  status: string;
  timezone: string | null;
  company_address: string | null;
};

export interface PlanLimit {
  /** Resolved plan name, for the settings summary. */
  plan_key: string | null;
}

export const getTenantMe = async (): Promise<TenantWorkspace> => {
  const raw = await apiGet<TenantWorkspace | { tenant: TenantWorkspace }>("/tenant/me");
  return "tenant" in raw ? raw.tenant : raw;
};

/** ADMIN only. */
export const updateTenantMe = (payload: Partial<TenantSettings>) => apiPut<TenantWorkspace>("/tenant/me", payload);
