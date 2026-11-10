// Email module keys: the unit of tenant entitlements (plan -> modules).
// MIRRORED from apps/api/src/constants/modules.const.ts;
// keep the two lists in sync whenever a module is added or removed.

export const MODULES = [
  "audience",
  "templates",
  "campaigns",
  "analytics",
  "email",
  "audit",
] as const;

export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  audience: "Audience",
  templates: "Templates",
  campaigns: "Campaigns",
  analytics: "Analytics",
  email: "Messages and suppressions",
  audit: "Audit log",
};

export const moduleLabel = (key: string): string =>
  MODULE_LABELS[key as ModuleKey] ?? key;

// Entitlement codes. Module gates are `module.<key>`; limits are `limit.<key>`.
export const MODULE_CODE_PREFIX = "module.";
export const LIMIT_CODE_PREFIX = "limit.";

export const LIMIT_LABELS: Record<string, string> = {
  "limit.monthly_emails": "Emails per month",
  "limit.max_contacts": "Contacts",
  "limit.max_domains": "Sending domains",
  "limit.max_users": "Users",
};

export const limitLabel = (code: string): string =>
  LIMIT_LABELS[code] ?? code.replace(LIMIT_CODE_PREFIX, "").replace(/_/g, " ");
