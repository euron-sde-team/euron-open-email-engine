// The operator email endpoints. Paths are relative to the console's base URL,
// which already ends in /api/v1/operator.

import { apiGet, apiPost } from "@/lib/api/client";
import type {
  AccountHealth,
  DlqSummary,
  FleetOverview,
  OperatorTenantEmail,
  OperatorUnpauseInput,
} from "@open-email/types";

export const getFleet = () => apiGet<FleetOverview>("/email/fleet");

export const getAccountHealth = () => apiGet<AccountHealth>("/email/account-health");

export const getDlq = () => apiGet<DlqSummary>("/email/dlq");

export const getTenantEmail = (tenantId: string) =>
  apiGet<OperatorTenantEmail>(`/tenants/${tenantId}/email`);

export const unpauseTenant = (tenantId: string, payload: OperatorUnpauseInput) =>
  apiPost<OperatorTenantEmail>(`/tenants/${tenantId}/email/unpause`, payload);
