export const operator_role = {
  SUPERADMIN: "SUPERADMIN",
  OPERATOR: "OPERATOR",
} as const;
export type operator_role = (typeof operator_role)[keyof typeof operator_role];
export const user_status = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
  PENDING: "PENDING",
} as const;
export type user_status = (typeof user_status)[keyof typeof user_status];
export const tenant_status = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CLOSED: "CLOSED",
} as const;
export type tenant_status = (typeof tenant_status)[keyof typeof tenant_status];
export const entitlement_source = {
  PLAN: "PLAN",
  ADMIN: "ADMIN",
} as const;
export type entitlement_source = (typeof entitlement_source)[keyof typeof entitlement_source];
export const storage_provider = {
  S3: "S3",
  LOCAL: "LOCAL",
} as const;
export type storage_provider = (typeof storage_provider)[keyof typeof storage_provider];
export const email_domain_status = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  DISABLED: "DISABLED",
} as const;
export type email_domain_status = (typeof email_domain_status)[keyof typeof email_domain_status];
export const email_identity_status = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;
export type email_identity_status =
  (typeof email_identity_status)[keyof typeof email_identity_status];
export const email_category = {
  TRANSACTIONAL: "TRANSACTIONAL",
  NOTIFICATION: "NOTIFICATION",
  MARKETING: "MARKETING",
} as const;
export type email_category = (typeof email_category)[keyof typeof email_category];
export const email_message_status = {
  QUEUED: "QUEUED",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  BOUNCED: "BOUNCED",
  COMPLAINED: "COMPLAINED",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
  SUPPRESSED: "SUPPRESSED",
} as const;
export type email_message_status = (typeof email_message_status)[keyof typeof email_message_status];
export const email_suppression_reason = {
  HARD_BOUNCE: "HARD_BOUNCE",
  COMPLAINT: "COMPLAINT",
  UNSUBSCRIBE: "UNSUBSCRIBE",
  ADMIN_BLOCK: "ADMIN_BLOCK",
  IMPORTED: "IMPORTED",
} as const;
export type email_suppression_reason =
  (typeof email_suppression_reason)[keyof typeof email_suppression_reason];
export const email_sending_status = {
  ACTIVE: "ACTIVE",
  WARNING: "WARNING",
  THROTTLED: "THROTTLED",
  PAUSED: "PAUSED",
} as const;
export type email_sending_status = (typeof email_sending_status)[keyof typeof email_sending_status];
export const contact_status = {
  SUBSCRIBED: "SUBSCRIBED",
  UNSUBSCRIBED: "UNSUBSCRIBED",
  BOUNCED: "BOUNCED",
  COMPLAINED: "COMPLAINED",
  PENDING_CONFIRMATION: "PENDING_CONFIRMATION",
} as const;
export type contact_status = (typeof contact_status)[keyof typeof contact_status];
export const contact_source = {
  MANUAL: "MANUAL",
  IMPORT: "IMPORT",
  FORM: "FORM",
  API: "API",
} as const;
export type contact_source = (typeof contact_source)[keyof typeof contact_source];
export const list_member_status = {
  subscribed: "subscribed",
  pending: "pending",
  unsubscribed: "unsubscribed",
} as const;
export type list_member_status = (typeof list_member_status)[keyof typeof list_member_status];
export const custom_field_type = {
  text: "text",
  number: "number",
  date: "date",
  boolean: "boolean",
} as const;
export type custom_field_type = (typeof custom_field_type)[keyof typeof custom_field_type];
export const campaign_status = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  SENDING: "SENDING",
  PAUSED: "PAUSED",
  SENT: "SENT",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
} as const;
export type campaign_status = (typeof campaign_status)[keyof typeof campaign_status];
export const recipient_status = {
  QUEUED: "QUEUED",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  BOUNCED: "BOUNCED",
  COMPLAINED: "COMPLAINED",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
} as const;
export type recipient_status = (typeof recipient_status)[keyof typeof recipient_status];
export const import_status = {
  UPLOADED: "UPLOADED",
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  DONE: "DONE",
  FAILED: "FAILED",
} as const;
export type import_status = (typeof import_status)[keyof typeof import_status];
export const email_event_type = {
  SEND: "SEND",
  DELIVERY: "DELIVERY",
  BOUNCE: "BOUNCE",
  COMPLAINT: "COMPLAINT",
  REJECT: "REJECT",
  OPEN: "OPEN",
  CLICK: "CLICK",
  UNSUBSCRIBE: "UNSUBSCRIBE",
} as const;
export type email_event_type = (typeof email_event_type)[keyof typeof email_event_type];
