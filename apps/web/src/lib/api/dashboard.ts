import type { TenantDashboard } from "@open-email/types";
import { apiGet } from "./client";

export const getDashboard = () => apiGet<TenantDashboard>("/dashboard");
