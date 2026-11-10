// Module keys: the unit of both RBAC (role -> modules) and tenant entitlements
// (plan -> modules). Keep in sync with the operator plan editor and the web app's
// navigation registry.

export const MODULES = [
  "audience", // contacts, lists, segments, forms, imports
  "templates",
  "campaigns",
  "analytics", // dashboard and reports
  "email", // message log, suppressions, reputation
  "audit",
] as const;

export type ModuleKey = (typeof MODULES)[number];

export const isModuleKey = (value: string): value is ModuleKey =>
  (MODULES as readonly string[]).includes(value);

// Governance capabilities: administration surfaces that EVERY workspace has
// regardless of the plan it bought. Unlike the feature MODULES above they are
// RBAC-only: access is decided purely by the user's role, with no tenant
// entitlement required (see requireCapability + resolveVisibleModules).
export const GOVERNANCE_CAPABILITIES = [
  "channels", // sending domains and sender identities
  "team", // user + role management
  "settings", // workspace settings
] as const;

export type GovernanceCapability = (typeof GOVERNANCE_CAPABILITIES)[number];

export const isGovernanceCapability = (value: string): value is GovernanceCapability =>
  (GOVERNANCE_CAPABILITIES as readonly string[]).includes(value);

// Every access key a role may hold: entitlement-gated feature modules plus the
// RBAC-only governance capabilities. Used to validate role definitions and to
// build the role-editor catalogue.
export const ALL_CAPABILITIES: string[] = [...MODULES, ...GOVERNANCE_CAPABILITIES];

export const isCapabilityKey = (value: string): boolean =>
  isModuleKey(value) || isGovernanceCapability(value);

export const BUILTIN_ROLE_KEYS = ["ADMIN", "MANAGER", "MARKETER", "ANALYST"] as const;

export type BuiltinRoleKey = (typeof BUILTIN_ROLE_KEYS)[number];

// Module access per built-in role. "*" means every module and capability.
export const ROLE_MODULES: Record<BuiltinRoleKey, string[]> = {
  ADMIN: ["*"],
  // Managers run everything except workspace settings.
  MANAGER: ["audience", "templates", "campaigns", "analytics", "email", "audit", "channels", "team"],
  // Marketers build audiences and send campaigns.
  MARKETER: ["audience", "templates", "campaigns", "analytics", "email"],
  // Analysts read results: dashboard, message log, reputation.
  ANALYST: ["analytics", "email"],
};

export const isBuiltinRole = (role: string): role is BuiltinRoleKey =>
  (BUILTIN_ROLE_KEYS as readonly string[]).includes(role);

// Elevated roles. Even with the `team` capability, only an ADMIN may invite,
// modify, reassign, or delete a user in one of these roles, or edit the role's
// module set. Managers can manage every OTHER role and user.
export const ELEVATED_ROLES = ["ADMIN", "MANAGER"] as const;

export const isElevatedRole = (role: string): boolean =>
  (ELEVATED_ROLES as readonly string[]).includes(role);

// Entitlement codes. Module gates are `module.<key>`; limits are explicit.
export const moduleEntitlementCode = (moduleKey: string): string => `module.${moduleKey}`;

export const LIMIT_CODES = {
  USERS: "limit.max_users",
  CONTACTS: "limit.max_contacts",
  DOMAINS: "limit.max_domains",
  MONTHLY_EMAILS: "limit.monthly_emails",
} as const;

/** Plan limit keys as stored in `plans.limits` and exposed as `PlanLimits`. */
export const PLAN_LIMIT_FIELDS = ["monthlyEmails", "maxContacts", "maxDomains", "maxUsers"] as const;
export type PlanLimitField = (typeof PLAN_LIMIT_FIELDS)[number];

export const LIMIT_CODE_BY_FIELD: Record<PlanLimitField, string> = {
  monthlyEmails: LIMIT_CODES.MONTHLY_EMAILS,
  maxContacts: LIMIT_CODES.CONTACTS,
  maxDomains: LIMIT_CODES.DOMAINS,
  maxUsers: LIMIT_CODES.USERS,
};

// Human-facing metadata for every access key, the single source of truth for
// the role editor's picker (label, one-line description, grouping) and for
// module labels in the UI. `governance: true` marks the RBAC-only capabilities.
export interface ModuleMeta {
  key: string;
  label: string;
  description: string;
  group: string;
  governance: boolean;
}

export const MODULE_CATALOGUE: ModuleMeta[] = [
  { key: "audience", label: "Audience", description: "Contacts, lists, segments, subscribe forms and imports.", group: "Marketing", governance: false },
  { key: "templates", label: "Templates", description: "Email templates and the starter gallery.", group: "Marketing", governance: false },
  { key: "campaigns", label: "Campaigns", description: "Compose, schedule and send campaigns.", group: "Marketing", governance: false },
  { key: "analytics", label: "Analytics", description: "Dashboard and campaign reports.", group: "Insights", governance: false },
  { key: "email", label: "Email log", description: "Message log, suppressions and sending reputation.", group: "Insights", governance: false },
  { key: "audit", label: "Audit log", description: "Who changed what in this workspace.", group: "Administration", governance: false },
  { key: "channels", label: "Sending setup", description: "Sending domains, DNS records and sender identities.", group: "Administration", governance: true },
  { key: "team", label: "Users & Roles", description: "Invite users, assign roles, and manage roles.", group: "Administration", governance: true },
  { key: "settings", label: "Workspace settings", description: "Workspace name, time zone and footer address.", group: "Administration", governance: true },
];

export const moduleLabel = (key: string): string =>
  key === "*" ? "All modules" : (MODULE_CATALOGUE.find((m) => m.key === key)?.label ?? key);
