import { apiGet, apiPost, apiPut } from "@/lib/api/client";
import type { Plan, PlanLimits } from "@/types";

export const listPlans = () => apiGet<Plan[]>("/plans");

export const createPlan = (payload: {
  key: string;
  name: string;
  description?: string;
  modules: string[];
  limits: PlanLimits;
}) => apiPost<Plan>("/plans", payload);

export const updatePlan = (
  id: string,
  payload: {
    name?: string;
    description?: string | null;
    modules?: string[];
    limits?: PlanLimits;
    is_active?: boolean;
    sort_order?: number;
  }
) => apiPut<Plan>(`/plans/${id}`, payload);
