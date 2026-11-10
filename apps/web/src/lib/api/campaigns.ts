import type {
  Campaign,
  CampaignInput,
  CampaignPreflight,
  CampaignReport,
  CampaignScheduleInput,
  CampaignStatus,
  CampaignTestInput,
  Paged,
  RecipientRow,
  RenderedEmail,
} from "@open-email/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import { cleanParams, toArray, toPage } from "./shape";

export const listCampaigns = async (status?: CampaignStatus | "") =>
  toArray<Campaign>(await apiGet<unknown>("/campaigns", { params: cleanParams({ status }) }));
export const getCampaign = (id: string) => apiGet<Campaign>(`/campaigns/${id}`);
export const createCampaign = (input: CampaignInput) => apiPost<Campaign>("/campaigns", input);
export const updateCampaign = (id: string, patch: Partial<CampaignInput>) => apiPatch<Campaign>(`/campaigns/${id}`, patch);
export const deleteCampaign = (id: string) => apiDelete<{ id: string }>(`/campaigns/${id}`);
export const duplicateCampaign = (id: string) => apiPost<Campaign>(`/campaigns/${id}/duplicate`);
export const previewCampaign = (id: string, contactId?: string) =>
  apiGet<RenderedEmail>(`/campaigns/${id}/preview`, { params: cleanParams({ contactId }) });
export const getPreflight = (id: string) => apiGet<CampaignPreflight>(`/campaigns/${id}/preflight`);
export const testCampaign = (id: string, input: CampaignTestInput) => apiPost<{ sent: number }>(`/campaigns/${id}/test`, input);
export const scheduleCampaign = (id: string, input: CampaignScheduleInput) => apiPost<Campaign>(`/campaigns/${id}/schedule`, input);
export const unscheduleCampaign = (id: string) => apiPost<Campaign>(`/campaigns/${id}/unschedule`);
export const pauseCampaign = (id: string) => apiPost<Campaign>(`/campaigns/${id}/pause`);
export const resumeCampaign = (id: string) => apiPost<Campaign>(`/campaigns/${id}/resume`);
export const cancelCampaign = (id: string) => apiPost<Campaign>(`/campaigns/${id}/cancel`);
export const getCampaignReport = (id: string) => apiGet<CampaignReport>(`/campaigns/${id}/report`);
export const listRecipients = async (id: string, params: { status?: string; cursor?: string } = {}): Promise<Paged<RecipientRow>> =>
  toPage<RecipientRow>(await apiGet<unknown>(`/campaigns/${id}/recipients`, { params: cleanParams(params) }));
