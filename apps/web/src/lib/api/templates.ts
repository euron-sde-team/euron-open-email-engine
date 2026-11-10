import type { EmailTemplate, EmailTemplateInput, RenderedEmail } from "@open-email/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import { toArray } from "./shape";

export const listTemplates = async () => toArray<EmailTemplate>(await apiGet<unknown>("/templates"));
export const getTemplate = (id: string) => apiGet<EmailTemplate>(`/templates/${id}`);
export const createTemplate = (input: EmailTemplateInput) => apiPost<EmailTemplate>("/templates", input);
export const updateTemplate = (id: string, patch: Partial<EmailTemplateInput>) => apiPatch<EmailTemplate>(`/templates/${id}`, patch);
export const deleteTemplate = (id: string) => apiDelete<{ id: string }>(`/templates/${id}`);
export const duplicateTemplate = (id: string) => apiPost<EmailTemplate>(`/templates/${id}/duplicate`);

export interface RenderRequest {
  subject: string;
  preheader?: string;
  html: string;
  /** Render for this real contact; omitted uses sample data. */
  contactId?: string;
}
export const renderTemplate = (input: RenderRequest) => apiPost<RenderedEmail>("/templates/render", input);
