import type { Selectable } from "kysely";
import type { campaigns } from "../db/types";
import { iso, isoReq } from "./common";

export type CampaignRow = Selectable<campaigns>;

export interface CampaignStatsDto {
  recipients: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  skipped: number;
}

export const EMPTY_STATS: CampaignStatsDto = {
  recipients: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0, skipped: 0,
};

export type AudienceDto =
  | { type: "ALL" }
  | { type: "LISTS"; listIds: string[] }
  | { type: "SEGMENT"; segmentId: string };

// Campaign in @open-email/types.
export const toCampaignDto = (r: CampaignRow, stats: CampaignStatsDto = EMPTY_STATS) => ({
  id: r.id,
  name: r.name,
  status: r.status,
  subject: r.subject,
  preheader: r.preheader,
  html: r.html,
  templateId: r.template_id,
  senderIdentityId: r.sender_identity_id,
  audience: r.audience as AudienceDto,
  scheduledAt: iso(r.scheduled_at),
  startedAt: iso(r.started_at),
  completedAt: iso(r.completed_at),
  pausedReason: r.paused_reason,
  stats,
  createdAt: isoReq(r.created_at),
  updatedAt: isoReq(r.updated_at),
});
