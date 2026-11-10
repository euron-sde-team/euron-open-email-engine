import { apiGet } from "@/lib/api/client";
import type { OperatorMetricsOverview } from "@open-email/types";

export const getMetricsOverview = () => apiGet<OperatorMetricsOverview>("/metrics/overview");
