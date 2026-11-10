import type { MessageCategory, SenderIdentity, SenderIdentityInput, SendingDomain } from "@open-email/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import { toArray } from "./shape";

export const listDomains = async () => toArray<SendingDomain>(await apiGet<unknown>("/email/domains"));
export const getDomain = (id: string) => apiGet<SendingDomain>(`/email/domains/${id}`);
export const createDomain = (domain: string) => apiPost<SendingDomain>("/email/domains", { domain });
/** Re-reads DNS and the SES status now and returns the refreshed domain. */
export const checkDomain = (id: string) => apiPost<SendingDomain>(`/email/domains/${id}/check`);
export const deleteDomain = (id: string) => apiDelete<{ id: string }>(`/email/domains/${id}`);

export const listSenders = async () => toArray<SenderIdentity>(await apiGet<unknown>("/email/senders"));
export const createSender = (input: SenderIdentityInput) => apiPost<SenderIdentity>("/email/senders", input);
export interface SenderPatch {
  displayName?: string | null;
  replyTo?: string | null;
  status?: "ACTIVE" | "ARCHIVED";
  defaults?: MessageCategory[];
}
export const updateSender = (id: string, patch: SenderPatch) => apiPatch<SenderIdentity>(`/email/senders/${id}`, patch);
export const deleteSender = (id: string) => apiDelete<{ id: string }>(`/email/senders/${id}`);
/** Sends a test message to the signed-in user. */
export const testSender = (id: string) => apiPost<{ sentTo: string }>(`/email/senders/${id}/test`);
