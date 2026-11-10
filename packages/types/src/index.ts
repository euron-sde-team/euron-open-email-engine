/**
 * The API contract for the email engine: what the tenant app, the operator console and
 * any client see on the wire. Timestamps are ISO-8601 strings, ids are ULIDs, every
 * tenant-scoped resource is owned by the signed-in user's tenant (another tenant's id is
 * a 404). Responses use the shell's envelope (`{ success, data, ... }`); these are the
 * `data` shapes. The API writes this file's shapes; the apps read them.
 */

// ─── Shared ─────────────────────────────────────────────────────────────────

export interface PageInfo {
  nextCursor: string | null;
  total?: number;
}

export type MessageCategory = "TRANSACTIONAL" | "NOTIFICATION" | "MARKETING";

/** Per-tenant sending health. PAUSED blocks marketing; THROTTLED rate-limits it. */
export type SendingStatus = "ACTIVE" | "WARNING" | "THROTTLED" | "PAUSED";

// ─── Sending domains, tracking domain, senders ──────────────────────────────

export type DomainStatus = "PENDING" | "VERIFIED" | "FAILED" | "DISABLED";

export interface DnsRecord {
  type: "CNAME" | "TXT" | "MX";
  name: string;
  value: string;
  /** Why the record exists: "DKIM", "MAIL FROM", "SPF", "DMARC", "TRACKING". */
  purpose: string;
  /** Whether the last check found it. */
  found: boolean | null;
  required: boolean;
}

export interface SendingDomain {
  id: string;
  /** The sending subdomain, e.g. "mail.acme.example". */
  domain: string;
  mailFromDomain: string;
  status: DomainStatus;
  dkimStatus: string | null;
  mailFromStatus: string | null;
  records: DnsRecord[];
  failureReason: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  /** The domain links and the open pixel are served from; its CNAME is one of `records`. */
  trackingDomain: string;
  trackingStatus: "PENDING" | "VERIFIED";
  createdAt: string;
}

export interface SenderIdentity {
  id: string;
  domainId: string;
  email: string;
  displayName: string | null;
  replyTo: string | null;
  status: "ACTIVE" | "ARCHIVED";
  defaults: MessageCategory[];
  createdAt: string;
}

export interface SenderIdentityInput {
  domainId: string;
  /** Local part only ("hello"); the domain comes from `domainId`. */
  localPart: string;
  displayName?: string;
  replyTo?: string;
  defaults?: MessageCategory[];
}

// ─── Audience ───────────────────────────────────────────────────────────────

export type ContactStatus = "SUBSCRIBED" | "UNSUBSCRIBED" | "BOUNCED" | "COMPLAINED" | "PENDING_CONFIRMATION";

export type ContactSource = "MANUAL" | "IMPORT" | "FORM" | "API";

export interface Contact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: ContactStatus;
  source: ContactSource;
  tags: string[];
  /** Custom fields by key (see CustomField). */
  attributes: Record<string, string | number | boolean | null>;
  listIds: string[];
  lastOpenedAt: string | null;
  lastClickedAt: string | null;
  emailsReceived: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
  attributes?: Record<string, string | number | boolean | null>;
  listIds?: string[];
}

export interface CustomField {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean";
}

export interface ContactList {
  id: string;
  name: string;
  description: string;
  /** Subscribers must click a confirmation link before they count. */
  doubleOptIn: boolean;
  /** Subscribed members. */
  memberCount: number;
  createdAt: string;
}

export type SegmentField =
  | "email" | "first_name" | "last_name" | "status" | "tag" | "list" | "source" | "created_at"
  | "opened_in_days" | "clicked_in_days" | "never_opened" | `attr:${string}`;
export type SegmentOp = "is" | "is_not" | "contains" | "starts_with" | "gt" | "lt" | "in_last_days" | "not_in_last_days" | "is_set" | "is_not_set";

export interface SegmentCondition {
  field: SegmentField;
  op: SegmentOp;
  value?: string | number | boolean;
}

export interface SegmentRules {
  match: "all" | "any";
  conditions: SegmentCondition[];
}

export interface Segment {
  id: string;
  name: string;
  description: string;
  rules: SegmentRules;
  /** Counted when asked for (`?count=true`) or after a save; null when not computed. */
  contactCount: number | null;
  createdAt: string;
}

export interface SubscribeForm {
  id: string;
  name: string;
  slug: string;
  listId: string;
  headline: string;
  description: string;
  buttonLabel: string;
  successMessage: string;
  collectName: boolean;
  /** Public URL: /f/:slug, served by the API at its root (the web dev server proxies it). */
  url: string;
  submissions: number;
  active: boolean;
  createdAt: string;
}

export type ImportStatus = "QUEUED" | "PROCESSING" | "DONE" | "FAILED";

export interface ImportJob {
  id: string;
  fileName: string;
  status: ImportStatus;
  listId: string | null;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  /** Row-level problems (max 100 kept). */
  errors: { row: number; email: string | null; reason: string }[];
  createdAt: string;
  finishedAt: string | null;
}

export interface SuppressionEntry {
  id: string;
  email: string;
  reason: "HARD_BOUNCE" | "COMPLAINT" | "UNSUBSCRIBE" | "ADMIN_BLOCK" | "IMPORTED";
  /** Null means every category. */
  category: MessageCategory | null;
  note: string | null;
  createdAt: string;
}

// ─── Templates ──────────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  preheader: string;
  /** Merge tags: {{first_name}}, {{email}}, {{attr.plan}}, {{unsubscribe_url}}, {{view_in_browser_url}}. */
  html: string;
  text: string | null;
  /** Starter templates shipped with the product cannot be deleted. */
  isStarter: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplateInput {
  name: string;
  subject: string;
  preheader?: string;
  html: string;
  text?: string | null;
}

/** POST /templates/render and /campaigns/:id/preview. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Merge tags that had no value and no default, so the author can fix them. */
  missingTags: string[];
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export type CampaignStatus = "DRAFT" | "SCHEDULED" | "SENDING" | "PAUSED" | "SENT" | "CANCELLED" | "FAILED";

export type CampaignAudience =
  | { type: "ALL" }
  | { type: "LISTS"; listIds: string[] }
  | { type: "SEGMENT"; segmentId: string };

export interface CampaignStats {
  recipients: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  /** Suppressed or skipped before sending. */
  skipped: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  subject: string;
  preheader: string;
  html: string;
  templateId: string | null;
  senderIdentityId: string | null;
  audience: CampaignAudience;
  /** Set when status is SCHEDULED; the send starts at this instant (UTC). */
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Why it stopped: "Tenant sending paused", "Domain not verified", ... */
  pausedReason: string | null;
  stats: CampaignStats;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignInput {
  name: string;
  subject: string;
  preheader?: string;
  html?: string;
  templateId?: string | null;
  senderIdentityId?: string | null;
  audience?: CampaignAudience;
}

/** POST /campaigns/:id/schedule: `at` omitted means send now. */
export interface CampaignScheduleInput {
  at?: string;
}

/** GET /campaigns/:id/preflight: what would block or warn before sending. */
export interface CampaignPreflight {
  ok: boolean;
  recipients: number;
  suppressed: number;
  /** Quota left this month (null = unlimited) and whether the send fits. */
  quotaRemaining: number | null;
  issues: { severity: "error" | "warning"; code: string; message: string }[];
}

export interface CampaignReport {
  campaign: Campaign;
  /** Rates are 0 to 1 of delivered (opens, clicks) or of sent (bounces, complaints). */
  rates: { delivery: number; open: number; click: number; clickToOpen: number; bounce: number; complaint: number; unsubscribe: number };
  /** Hourly for the first 48 hours, then daily; oldest first. */
  timeline: { at: string; opens: number; clicks: number }[];
  links: { url: string; clicks: number; uniqueClicks: number }[];
  bounces: { reason: string; count: number }[];
  topDomains: { domain: string; delivered: number; opened: number; bounced: number }[];
  /** Opens by Apple Mail Privacy Protection are counted but flagged; shown so rates are read with care. */
  machineOpens: number;
}

export interface RecipientRow {
  contactId: string | null;
  email: string;
  status: "QUEUED" | "SENT" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "SKIPPED" | "FAILED";
  opens: number;
  clicks: number;
  lastEventAt: string | null;
  skipReason: string | null;
}

// ─── Messages and events ────────────────────────────────────────────────────

export type MessageStatus = "QUEUED" | "SENT" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "REJECTED" | "FAILED" | "SUPPRESSED";

export interface MessageRow {
  id: string;
  category: MessageCategory;
  campaignId: string | null;
  campaignName: string | null;
  to: string;
  from: string;
  subject: string;
  status: MessageStatus;
  /** True for messages the simulator handled instead of SES (local and tests). */
  simulated: boolean;
  sesMessageId: string | null;
  bounceType: string | null;
  opens: number;
  clicks: number;
  createdAt: string;
  deliveredAt: string | null;
}

export type EmailEventType = "SEND" | "DELIVERY" | "BOUNCE" | "COMPLAINT" | "REJECT" | "OPEN" | "CLICK" | "UNSUBSCRIBE";

export interface EmailEvent {
  id: string;
  type: EmailEventType;
  at: string;
  detail: string | null;
  url: string | null;
  /** OPEN only: true when it looks like a mail client prefetch (Apple MPP, proxies). */
  machine: boolean;
}

export interface MessageDetail extends MessageRow {
  events: EmailEvent[];
}

// ─── Reputation and dashboard ───────────────────────────────────────────────

export interface ReputationSummary {
  status: SendingStatus;
  /** Rolling 14 days. Rates are 0 to 1. */
  window: { sent: number; delivered: number; bounceRate: number; permanentBounceRate: number; complaintRate: number };
  thresholds: { warnBounce: number; throttleBounce: number; pauseBounce: number; warnComplaint: number; throttleComplaint: number; pauseComplaint: number };
  /** Marketing sends are blocked or limited; transactional always flows. */
  note: string | null;
  history: { at: string; from: SendingStatus; to: SendingStatus; trigger: string; reason: string }[];
}

export interface TenantDashboard {
  /** This calendar month (UTC). */
  usage: { emails: { used: number; limit: number | null }; contacts: { used: number; limit: number | null }; domains: { used: number; limit: number | null }; resetsAt: string };
  reputation: Pick<ReputationSummary, "status" | "window">;
  /** The last 30 days, oldest first. */
  daily: { date: string; sent: number; delivered: number; opened: number; clicked: number; bounced: number }[];
  topCampaigns: { id: string; name: string; sentAt: string | null; delivered: number; openRate: number; clickRate: number }[];
  audience: { subscribed: number; unsubscribed: number; bounced: number; newThisWeek: number };
  /** Setup steps for a new tenant: domain, sender, contacts, first campaign. */
  checklist: { key: "domain" | "sender" | "contacts" | "template" | "campaign"; done: boolean }[];
}

// ─── Operator plane (console) ───────────────────────────────────────────────

export interface FleetTenantRow {
  tenantId: string;
  name: string;
  status: SendingStatus;
  plan: string | null;
  sent14d: number;
  bounceRate: number;
  complaintRate: number;
  domains: number;
  verifiedDomains: number;
  contacts: number;
}

export interface FleetOverview {
  totals: { tenants: number; active: number; warning: number; throttled: number; paused: number; sentThisMonth: number };
  tenants: FleetTenantRow[];
}

/** SES account level: what AWS thinks of the whole deployment. */
export interface AccountHealth {
  mode: "aws" | "simulated";
  sendingEnabled: boolean;
  sandbox: boolean;
  quota: { max24Hour: number; maxPerSecond: number; sentLast24Hours: number };
  /** Account-wide 14-day rates from the platform's own event stream. */
  bounceRate: number;
  complaintRate: number;
  checkedAt: string;
}

export interface DlqSummary {
  configured: boolean;
  depth: number;
  oldestAgeSeconds: number | null;
  /** A peek at up to 10 messages, bodies cut to 500 characters. */
  sample: { id: string; receivedAt: string; body: string }[];
}

/** The limits a plan sets on a tenant (null = unlimited). */
export interface PlanLimits {
  monthlyEmails: number | null;
  maxContacts: number | null;
  maxDomains: number | null;
  maxUsers: number | null;
}

// ─── Operator console additions ─────────────────────────────────────────────

/** One metered quantity against its plan limit (null = unlimited). */
export interface UsageMeter {
  used: number;
  limit: number | null;
}

/** GET /operator/tenants/:id/email: everything the console's tenant page shows about sending. */
export interface OperatorTenantEmail {
  fleet: FleetTenantRow;
  /** This calendar month (UTC) for emails; current totals for the rest. */
  usage: { emails: UsageMeter; contacts: UsageMeter; domains: UsageMeter; users: UsageMeter; resetsAt: string };
  domains: {
    id: string;
    domain: string;
    status: DomainStatus;
    trackingStatus: "PENDING" | "VERIFIED";
    failureReason: string | null;
    verifiedAt: string | null;
    lastCheckedAt: string | null;
  }[];
  reputation: ReputationSummary;
}

/** POST /operator/tenants/:id/email/unpause. The reason is required and audited. */
export interface OperatorUnpauseInput {
  reason: string;
}

/** GET /operator/metrics/overview: platform totals for the console dashboard. */
export interface OperatorMetricsOverview {
  tenants: { total: number; byStatus: Record<string, number> };
  planDistribution: { plan_key: string; count: number }[];
  totals: { users: number; contacts: number; emailsThisMonth: number };
}

// ─── Request and response shapes the tenant app needs (web slice, additive) ───

/** Cursor pages: `items` plus the next cursor (null at the end) and, when cheap, a total. */
export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

/** POST /segments/preview: how many contacts the rules match and ten of them. */
export interface SegmentPreview {
  count: number;
  sample: Contact[];
}

export interface SegmentInput {
  name: string;
  description?: string;
  rules: SegmentRules;
}

export interface ListInput {
  name: string;
  description?: string;
  doubleOptIn?: boolean;
}

export interface SubscribeFormInput {
  name: string;
  slug?: string;
  listId: string;
  headline: string;
  description?: string;
  buttonLabel?: string;
  successMessage?: string;
  collectName?: boolean;
  active?: boolean;
}

export interface SuppressionInput {
  email: string;
  category?: MessageCategory | null;
  note?: string;
}

/** POST /contacts/bulk. `value` is the tag name for tag/untag and the list id for addToList/removeFromList. */
export interface ContactBulkInput {
  ids: string[];
  action: "tag" | "untag" | "addToList" | "removeFromList" | "delete";
  value?: string;
}

/** GET /contacts/:id/timeline: events across every campaign the contact received. */
export interface ContactTimelineEntry {
  id: string;
  type: EmailEventType | "SUBSCRIBED" | "CONFIRMED" | "IMPORTED";
  at: string;
  campaignId: string | null;
  campaignName: string | null;
  detail: string | null;
  url: string | null;
  machine: boolean;
}

/** POST /imports (multipart `file`): the stored upload with its header row and a few sample rows. */
export interface ImportUpload {
  id: string;
  fileName: string;
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
}

/**
 * POST /imports/:id/start. `mapping` maps each CSV header to "email", "first_name",
 * "last_name", "full_name", "tags", "attr:<customFieldKey>" or "skip".
 */
export interface ImportStartInput {
  mapping: Record<string, string>;
  /** Add every imported contact to this list. */
  listId?: string | null;
  /** Tags added to every imported contact. */
  tags?: string[];
  /** The person importing confirms they have permission to email these contacts. */
  consentConfirmed: boolean;
}

/** POST /campaigns/:id/test. */
export interface CampaignTestInput {
  to: string[];
}

export interface TenantSettings {
  name: string;
  brand_color: string;
  /** IANA zone the schedule UI shows times in. */
  timezone: string | null;
  /** Postal address printed in every campaign footer. */
  company_address: string | null;
}
