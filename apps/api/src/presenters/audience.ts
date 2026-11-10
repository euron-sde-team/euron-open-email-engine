import type { Selectable } from "kysely";
import type { contacts, custom_fields, lists, segments, subscribe_forms } from "../db/types";
import config from "../config";
import { iso, isoReq } from "./common";

export type ContactRow = Selectable<contacts>;

// Contact in @open-email/types.
export const toContactDto = (r: ContactRow, listIds: string[]) => ({
  id: r.id,
  email: r.email,
  firstName: r.first_name,
  lastName: r.last_name,
  status: r.status,
  source: r.source,
  tags: r.tags ?? [],
  attributes: (r.attributes && typeof r.attributes === "object" ? r.attributes : {}) as Record<
    string,
    string | number | boolean | null
  >,
  listIds,
  lastOpenedAt: iso(r.last_opened_at),
  lastClickedAt: iso(r.last_clicked_at),
  emailsReceived: r.emails_received,
  createdAt: isoReq(r.created_at),
  updatedAt: isoReq(r.updated_at),
});

export const toCustomFieldDto = (r: Selectable<custom_fields>) => ({ key: r.key, label: r.label, type: r.type });

export const toListDto = (r: Selectable<lists>, memberCount: number) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  doubleOptIn: r.double_opt_in,
  memberCount,
  createdAt: isoReq(r.created_at),
});

export const toSegmentDto = (r: Selectable<segments>) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  rules: r.rules as { match: "all" | "any"; conditions: Array<{ field: never; op: never; value?: string | number | boolean }> },
  contactCount: r.contact_count,
  createdAt: isoReq(r.created_at),
});

export const toFormDto = (r: Selectable<subscribe_forms>) => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  listId: r.list_id,
  headline: r.headline,
  description: r.description,
  buttonLabel: r.button_label,
  successMessage: r.success_message,
  collectName: r.collect_name,
  // Served by this API at its root, next to the other public pages.
  url: `${config.APP_PUBLIC_URL.replace(/\/$/, "")}/f/${r.slug}`,
  submissions: r.submissions,
  active: r.active,
  createdAt: isoReq(r.created_at),
});
