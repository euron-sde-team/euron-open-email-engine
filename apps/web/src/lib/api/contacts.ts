import type {
  Contact,
  ContactBulkInput,
  ContactInput,
  ContactTimelineEntry,
  ContactList,
  CustomField,
  ListInput,
  Paged,
  Segment,
  SegmentInput,
  SegmentPreview,
  SegmentRules,
  SubscribeForm,
  SubscribeFormInput,
  ImportJob,
  ImportStartInput,
  ImportUpload,
} from "@open-email/types";
import { apiDelete, apiGet, apiPatch, apiPost, apiClient } from "./client";
import { cleanParams, toArray, toPage } from "./shape";

export interface ContactFilters {
  q?: string;
  status?: string;
  tag?: string;
  listId?: string;
  segmentId?: string;
  cursor?: string;
  limit?: number;
}

export const listContacts = async (filters: ContactFilters = {}): Promise<Paged<Contact>> =>
  toPage<Contact>(await apiGet<unknown>("/contacts", { params: cleanParams(filters) }));
export const getContact = (id: string) => apiGet<Contact>(`/contacts/${id}`);
export const createContact = (input: ContactInput) => apiPost<Contact>("/contacts", input);
export const updateContact = (id: string, patch: Partial<ContactInput>) => apiPatch<Contact>(`/contacts/${id}`, patch);
export const deleteContact = (id: string) => apiDelete<{ id: string }>(`/contacts/${id}`);
export const getContactTimeline = async (id: string) =>
  toArray<ContactTimelineEntry>(await apiGet<unknown>(`/contacts/${id}/timeline`));
export const bulkContacts = (input: ContactBulkInput) => apiPost<{ affected: number }>("/contacts/bulk", input);

/** Downloads the CSV through the authenticated client and hands it to the browser as a file. */
export async function downloadContactsCsv(filters: ContactFilters = {}): Promise<void> {
  const { cursor: _c, limit: _l, ...rest } = filters;
  const res = await apiClient.get<string, { data: string }>("/contacts/export.csv", {
    params: cleanParams(rest),
    responseType: "blob",
    transformResponse: (d) => d,
  });
  // The response interceptor unwraps `data`; with a blob that is the Blob itself.
  const blob = res instanceof Blob ? res : new Blob([String((res as { data?: string }).data ?? res)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "contacts.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Custom fields ----
export const listCustomFields = async () => toArray<CustomField>(await apiGet<unknown>("/custom-fields"));
export const createCustomField = (field: CustomField) => apiPost<CustomField>("/custom-fields", field);
export const deleteCustomField = (key: string) => apiDelete<{ key: string }>(`/custom-fields/${encodeURIComponent(key)}`);

// ---- Lists ----
export const listLists = async () => toArray<ContactList>(await apiGet<unknown>("/lists"));
export const getList = (id: string) => apiGet<ContactList>(`/lists/${id}`);
export const createList = (input: ListInput) => apiPost<ContactList>("/lists", input);
export const updateList = (id: string, patch: Partial<ListInput>) => apiPatch<ContactList>(`/lists/${id}`, patch);
export const deleteList = (id: string) => apiDelete<{ id: string }>(`/lists/${id}`);
export const addListMembers = (id: string, contactIds: string[]) =>
  apiPost<{ added: number }>(`/lists/${id}/members`, { contactIds });
export const removeListMembers = (id: string, contactIds: string[]) =>
  apiDelete<{ removed: number }>(`/lists/${id}/members`, { data: { contactIds } });

// ---- Segments ----
export const listSegments = async (count = false) =>
  toArray<Segment>(await apiGet<unknown>("/segments", { params: count ? { count: true } : undefined }));
export const getSegment = (id: string) => apiGet<Segment>(`/segments/${id}?count=true`);
export const createSegment = (input: SegmentInput) => apiPost<Segment>("/segments", input);
export const updateSegment = (id: string, patch: Partial<SegmentInput>) => apiPatch<Segment>(`/segments/${id}`, patch);
export const deleteSegment = (id: string) => apiDelete<{ id: string }>(`/segments/${id}`);
export const previewSegment = (rules: SegmentRules) => apiPost<SegmentPreview>("/segments/preview", { rules });

// ---- Subscribe forms ----
export const listForms = async () => toArray<SubscribeForm>(await apiGet<unknown>("/forms"));
export const createForm = (input: SubscribeFormInput) => apiPost<SubscribeForm>("/forms", input);
export const updateForm = (id: string, patch: Partial<SubscribeFormInput>) => apiPatch<SubscribeForm>(`/forms/${id}`, patch);
export const deleteForm = (id: string) => apiDelete<{ id: string }>(`/forms/${id}`);

// ---- Imports ----
export function uploadImport(file: File): Promise<ImportUpload> {
  const body = new FormData();
  body.append("file", file);
  // Let the browser set the multipart boundary.
  return apiPost<ImportUpload>("/imports", body, { headers: { "Content-Type": undefined as unknown as string } });
}
export const startImport = (id: string, input: ImportStartInput) => apiPost<ImportJob>(`/imports/${id}/start`, input);
export const listImports = async () => toArray<ImportJob>(await apiGet<unknown>("/imports"));
export const getImport = (id: string) => apiGet<ImportJob>(`/imports/${id}`);
