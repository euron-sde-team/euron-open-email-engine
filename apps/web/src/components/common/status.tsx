import type { CampaignStatus, ContactStatus, DomainStatus, MessageStatus, SendingStatus } from "@open-email/types";

import { Badge } from "@/components/ui/badge";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const CAMPAIGN: Record<CampaignStatus, [Tone, string]> = {
  DRAFT: ["neutral", "Draft"],
  SCHEDULED: ["info", "Scheduled"],
  SENDING: ["info", "Sending"],
  PAUSED: ["warning", "Paused"],
  SENT: ["success", "Sent"],
  CANCELLED: ["neutral", "Cancelled"],
  FAILED: ["danger", "Failed"],
};

const CONTACT: Record<ContactStatus, [Tone, string]> = {
  SUBSCRIBED: ["success", "Subscribed"],
  PENDING_CONFIRMATION: ["warning", "Awaiting confirmation"],
  UNSUBSCRIBED: ["neutral", "Unsubscribed"],
  BOUNCED: ["danger", "Bounced"],
  COMPLAINED: ["danger", "Complained"],
};

const DOMAIN: Record<DomainStatus, [Tone, string]> = {
  VERIFIED: ["success", "Verified"],
  PENDING: ["warning", "Waiting for DNS"],
  FAILED: ["danger", "Failed"],
  DISABLED: ["neutral", "Disabled"],
};

const MESSAGE: Record<MessageStatus, [Tone, string]> = {
  QUEUED: ["neutral", "Queued"],
  SENT: ["info", "Sent"],
  DELIVERED: ["success", "Delivered"],
  BOUNCED: ["danger", "Bounced"],
  COMPLAINED: ["danger", "Complaint"],
  REJECTED: ["danger", "Rejected"],
  FAILED: ["danger", "Failed"],
  SUPPRESSED: ["neutral", "Suppressed"],
};

const SENDING: Record<SendingStatus, [Tone, string]> = {
  ACTIVE: ["success", "Healthy"],
  WARNING: ["warning", "Warning"],
  THROTTLED: ["warning", "Throttled"],
  PAUSED: ["danger", "Paused"],
};

function make<K extends string>(map: Record<K, [Tone, string]>) {
  return function Status({ status }: { status: K }) {
    const [tone, label] = map[status] ?? ["neutral", String(status)];
    return <Badge variant={tone}>{label}</Badge>;
  };
}

export const CampaignStatusText = make(CAMPAIGN);
export const ContactStatusText = make(CONTACT);
export const DomainStatusText = make(DOMAIN);
export const MessageStatusText = make(MESSAGE);
export const SendingStatusText = make(SENDING);

export const campaignStatusLabel = (s: CampaignStatus): string => CAMPAIGN[s]?.[1] ?? s;
export const messageStatusLabel = (s: MessageStatus): string => MESSAGE[s]?.[1] ?? s;
export const contactStatusLabel = (s: ContactStatus): string => CONTACT[s]?.[1] ?? s;
