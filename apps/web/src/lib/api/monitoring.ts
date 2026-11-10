import type { MessageDetail, MessageRow, Paged, ReputationSummary, SuppressionEntry, SuppressionInput } from "@open-email/types";
import { apiDelete, apiGet, apiPost } from "./client";
import { cleanParams, toPage } from "./shape";

export interface MessageFilters {
  status?: string;
  category?: string;
  campaignId?: string;
  q?: string;
  cursor?: string;
}
export const listMessages = async (filters: MessageFilters = {}): Promise<Paged<MessageRow>> =>
  toPage<MessageRow>(await apiGet<unknown>("/email/messages", { params: cleanParams(filters) }));
export const getMessage = (id: string) => apiGet<MessageDetail>(`/email/messages/${id}`);
export const getReputation = () => apiGet<ReputationSummary>("/email/reputation");

export const listSuppressions = async (params: { q?: string; reason?: string; cursor?: string } = {}): Promise<Paged<SuppressionEntry>> =>
  toPage<SuppressionEntry>(await apiGet<unknown>("/email/suppressions", { params: cleanParams(params) }));
export const addSuppression = (input: SuppressionInput) => apiPost<SuppressionEntry>("/email/suppressions", input);
export const removeSuppression = (id: string) => apiDelete<{ id: string }>(`/email/suppressions/${id}`);
