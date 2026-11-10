import type { ColumnType } from "kysely";
export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import type {
  operator_role,
  user_status,
  tenant_status,
  entitlement_source,
  storage_provider,
  email_domain_status,
  email_identity_status,
  email_category,
  email_message_status,
  email_suppression_reason,
  email_sending_status,
  contact_status,
  contact_source,
  list_member_status,
  custom_field_type,
  campaign_status,
  recipient_status,
  import_status,
  email_event_type,
} from "./enums";

export type audit_logs = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  meta: unknown | null;
  created_at: Timestamp;
};
export type campaign_links = {
  id: string;
  tenant_id: string;
  campaign_id: string;
  url: string;
  token: string;
  created_at: Timestamp;
};
export type campaign_recipients = {
  id: string;
  tenant_id: string;
  campaign_id: string;
  contact_id: string | null;
  email: string;
  status: Generated<recipient_status>;
  message_id: string | null;
  skip_reason: string | null;
  claimed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type campaigns = {
  id: string;
  tenant_id: string;
  name: string;
  status: Generated<campaign_status>;
  subject: string;
  preheader: Generated<string>;
  html: Generated<string>;
  template_id: string | null;
  sender_identity_id: string | null;
  audience: unknown;
  scheduled_at: Timestamp | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  paused_reason: string | null;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type contacts = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: Generated<contact_status>;
  source: Generated<contact_source>;
  tags: string[];
  attributes: Generated<unknown>;
  last_opened_at: Timestamp | null;
  last_clicked_at: Timestamp | null;
  emails_received: Generated<number>;
  consent_at: Timestamp | null;
  consent_ip_hash: string | null;
  unsubscribed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type custom_fields = {
  id: string;
  tenant_id: string;
  key: string;
  label: string;
  type: Generated<custom_field_type>;
  created_at: Timestamp;
};
export type email_domain_health_checks = {
  id: string;
  tenant_id: string;
  sending_domain_id: string;
  dkim_status: string | null;
  mail_from_status: string | null;
  spf_present: Generated<boolean>;
  dmarc_present: Generated<boolean>;
  failures: unknown | null;
  created_at: Timestamp;
};
export type email_events = {
  id: string;
  tenant_id: string;
  message_id: string;
  campaign_id: string | null;
  contact_id: string | null;
  type: email_event_type;
  occurred_at: Timestamp;
  detail: string | null;
  url: string | null;
  machine: Generated<boolean>;
  ip_hash: string | null;
  ua_class: string | null;
};
export type email_messages = {
  id: string;
  tenant_id: string;
  category: Generated<email_category>;
  sending_domain_id: string | null;
  sender_identity_id: string | null;
  campaign_id: string | null;
  contact_id: string | null;
  from_address: string;
  to_address: string;
  subject: string | null;
  ses_message_id: string | null;
  status: Generated<email_message_status>;
  simulated: Generated<boolean>;
  idempotency_key: string | null;
  open_count: Generated<number>;
  click_count: Generated<number>;
  bounce_type: string | null;
  bounce_reason: string | null;
  sent_at: Timestamp | null;
  delivered_at: Timestamp | null;
  bounced_at: Timestamp | null;
  complained_at: Timestamp | null;
  opened_at: Timestamp | null;
  clicked_at: Timestamp | null;
  error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type email_reputation_events = {
  id: string;
  tenant_id: string;
  from_status: email_sending_status;
  to_status: email_sending_status;
  trigger: string;
  reason: string | null;
  rates_snapshot: unknown | null;
  created_at: Timestamp;
};
export type email_sender_identities = {
  id: string;
  tenant_id: string;
  sending_domain_id: string;
  email_address: string;
  display_name: string | null;
  reply_to: string | null;
  status: Generated<email_identity_status>;
  is_default_transactional: Generated<boolean>;
  is_default_notification: Generated<boolean>;
  is_default_marketing: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type email_sending_domains = {
  id: string;
  tenant_id: string;
  subdomain: string;
  mail_from_subdomain: string | null;
  ses_configuration_set: string | null;
  status: Generated<email_domain_status>;
  dkim_status: string | null;
  mail_from_status: string | null;
  dns_records: unknown | null;
  tracking_domain: string;
  tracking_status: Generated<string>;
  failure_reason: string | null;
  verified_at: Timestamp | null;
  last_checked_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type email_suppressions = {
  id: string;
  tenant_id: string;
  email: string;
  reason: email_suppression_reason;
  category_scope: email_category | null;
  note: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type files = {
  id: string;
  tenant_id: string;
  key: string;
  bucket: string;
  name: string;
  content_type: string | null;
  size_bytes: number | null;
  entity_type: string | null;
  entity_id: string | null;
  uploaded_by: string | null;
  storage: Generated<storage_provider>;
  created_at: Timestamp;
};
export type import_jobs = {
  id: string;
  tenant_id: string;
  file_name: string;
  file_id: string | null;
  status: Generated<import_status>;
  list_id: string | null;
  mapping: unknown | null;
  update_existing: Generated<boolean>;
  total: Generated<number>;
  created: Generated<number>;
  updated: Generated<number>;
  skipped: Generated<number>;
  errors: Generated<unknown>;
  created_by: string | null;
  created_at: Timestamp;
  finished_at: Timestamp | null;
};
export type list_members = {
  tenant_id: string;
  list_id: string;
  contact_id: string;
  status: Generated<list_member_status>;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type lists = {
  id: string;
  tenant_id: string;
  name: string;
  description: Generated<string>;
  double_opt_in: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type notifications = {
  id: string;
  tenant_id: string;
  user_id: string;
  text: string;
  link: string | null;
  read: Generated<boolean>;
  created_at: Timestamp;
};
export type operator_audit_logs = {
  id: string;
  actor_operator_id: string | null;
  actor_email: string | null;
  action: string;
  category: string;
  tenant_id: string | null;
  resource_id: string | null;
  summary: string;
  metadata: unknown | null;
  created_at: Timestamp;
};
export type operator_users = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Generated<operator_role>;
  status: Generated<user_status>;
  last_login_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type plans = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  modules: unknown;
  limits: unknown;
  is_active: Generated<boolean>;
  sort_order: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type roles = {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  permissions: unknown;
  builtin: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type segments = {
  id: string;
  tenant_id: string;
  name: string;
  description: Generated<string>;
  rules: unknown;
  contact_count: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type subscribe_forms = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  list_id: string;
  headline: string;
  description: Generated<string>;
  button_label: Generated<string>;
  success_message: Generated<string>;
  collect_name: Generated<boolean>;
  submissions: Generated<number>;
  active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type templates = {
  id: string;
  tenant_id: string;
  name: string;
  subject: string;
  preheader: Generated<string>;
  html: string;
  text_body: string | null;
  is_starter: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type tenant_entitlements = {
  id: string;
  tenant_id: string;
  code: string;
  enabled: Generated<boolean>;
  limit_value: number | null;
  source: Generated<entitlement_source>;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type tenant_usage_monthly = {
  tenant_id: string;
  month: Timestamp;
  emails_sent: Generated<number>;
  updated_at: Timestamp;
};
export type tenants = {
  id: string;
  slug: string;
  name: string;
  plan_key: string | null;
  brand_color: Generated<string>;
  timezone: Generated<string>;
  company_address: string | null;
  status: Generated<tenant_status>;
  config: unknown | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  email_sending_status: Generated<email_sending_status>;
  email_sending_status_changed_at: Timestamp | null;
};
export type users = {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  status: Generated<user_status>;
  permissions: unknown | null;
  avatar_color: string | null;
  last_login_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};
export type DB = {
  audit_logs: audit_logs;
  campaign_links: campaign_links;
  campaign_recipients: campaign_recipients;
  campaigns: campaigns;
  contacts: contacts;
  custom_fields: custom_fields;
  email_domain_health_checks: email_domain_health_checks;
  email_events: email_events;
  email_messages: email_messages;
  email_reputation_events: email_reputation_events;
  email_sender_identities: email_sender_identities;
  email_sending_domains: email_sending_domains;
  email_suppressions: email_suppressions;
  files: files;
  import_jobs: import_jobs;
  list_members: list_members;
  lists: lists;
  notifications: notifications;
  operator_audit_logs: operator_audit_logs;
  operator_users: operator_users;
  plans: plans;
  roles: roles;
  segments: segments;
  subscribe_forms: subscribe_forms;
  templates: templates;
  tenant_entitlements: tenant_entitlements;
  tenant_usage_monthly: tenant_usage_monthly;
  tenants: tenants;
  users: users;
};
