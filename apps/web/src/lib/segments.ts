// Segment rules: which operators each field supports, how a half-filled builder row
// is cleaned before it goes to the API, and how a rule reads in plain words.

import type { ContactStatus, SegmentCondition, SegmentField, SegmentOp, SegmentRules } from "@open-email/types";

export type ValueKind = "none" | "text" | "number" | "days" | "date" | "status" | "source" | "tag" | "list" | "boolean";

export interface FieldDef {
  field: SegmentField;
  label: string;
}

export const CONTACT_STATUSES: ContactStatus[] = ["SUBSCRIBED", "PENDING_CONFIRMATION", "UNSUBSCRIBED", "BOUNCED", "COMPLAINED"];
export const CONTACT_SOURCES = ["MANUAL", "IMPORT", "FORM", "API"] as const;

export const OP_LABELS: Record<SegmentOp, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  starts_with: "starts with",
  gt: "is greater than",
  lt: "is less than",
  in_last_days: "in the last",
  not_in_last_days: "not in the last",
  is_set: "is set",
  is_not_set: "is not set",
};

/** The fixed fields, in the order the builder lists them. Custom fields are added as `attr:key`. */
export const BASE_FIELDS: FieldDef[] = [
  { field: "email", label: "Email" },
  { field: "first_name", label: "First name" },
  { field: "last_name", label: "Last name" },
  { field: "status", label: "Status" },
  { field: "tag", label: "Tag" },
  { field: "list", label: "List" },
  { field: "source", label: "Source" },
  { field: "created_at", label: "Added" },
  { field: "opened_in_days", label: "Opened an email" },
  { field: "clicked_in_days", label: "Clicked a link" },
  { field: "never_opened", label: "Has never opened" },
];

export type CustomFieldType = "text" | "number" | "date" | "boolean";

/** Resolves the type of a custom field from its key; unknown keys are treated as text. */
export type AttrTypeLookup = (key: string) => CustomFieldType;

const TEXT_OPS: SegmentOp[] = ["is", "is_not", "contains", "starts_with", "is_set", "is_not_set"];

export const isAttrField = (field: SegmentField): field is `attr:${string}` => field.startsWith("attr:");
export const attrKey = (field: SegmentField): string => field.slice(5);

export function opsFor(field: SegmentField, attrType: AttrTypeLookup = () => "text"): SegmentOp[] {
  if (isAttrField(field)) {
    const t = attrType(attrKey(field));
    if (t === "number") return ["is", "is_not", "gt", "lt", "is_set", "is_not_set"];
    if (t === "date") return ["gt", "lt", "in_last_days", "not_in_last_days", "is_set", "is_not_set"];
    if (t === "boolean") return ["is"];
    return TEXT_OPS;
  }
  switch (field) {
    case "email":
    case "first_name":
    case "last_name":
      return TEXT_OPS;
    case "status":
    case "tag":
    case "list":
    case "source":
      return ["is", "is_not"];
    case "created_at":
      return ["in_last_days", "not_in_last_days", "gt", "lt"];
    case "opened_in_days":
    case "clicked_in_days":
      return ["in_last_days", "not_in_last_days"];
    case "never_opened":
      return ["is"];
    default:
      return ["is"];
  }
}

export function valueKind(field: SegmentField, op: SegmentOp, attrType: AttrTypeLookup = () => "text"): ValueKind {
  if (op === "is_set" || op === "is_not_set") return "none";
  if (op === "in_last_days" || op === "not_in_last_days") return "days";
  if (field === "never_opened") return "none";
  if (isAttrField(field)) {
    const t = attrType(attrKey(field));
    if (t === "number") return "number";
    if (t === "date") return "date";
    if (t === "boolean") return "boolean";
    return "text";
  }
  switch (field) {
    case "status":
      return "status";
    case "source":
      return "source";
    case "tag":
      return "tag";
    case "list":
      return "list";
    case "created_at":
      return "date";
    default:
      return "text";
  }
}

export const emptyRules = (): SegmentRules => ({ match: "all", conditions: [] });

export function newCondition(field: SegmentField = "tag", attrType: AttrTypeLookup = () => "text"): SegmentCondition {
  const op = opsFor(field, attrType)[0];
  const cond: SegmentCondition = { field, op };
  if (field === "never_opened") cond.value = true;
  if (valueKind(field, op, attrType) === "days") cond.value = 30;
  return cond;
}

/** Changing the field keeps the operator when it still applies and drops a value that no longer fits. */
export function changeField(cond: SegmentCondition, field: SegmentField, attrType: AttrTypeLookup = () => "text"): SegmentCondition {
  const ops = opsFor(field, attrType);
  const op = ops.includes(cond.op) ? cond.op : ops[0];
  const next: SegmentCondition = { field, op };
  if (field === "never_opened") next.value = true;
  else if (valueKind(field, op, attrType) === "days") next.value = 30;
  else if (valueKind(field, op, attrType) === "boolean") next.value = true;
  return next;
}

export function changeOp(cond: SegmentCondition, op: SegmentOp, attrType: AttrTypeLookup = () => "text"): SegmentCondition {
  const before = valueKind(cond.field, cond.op, attrType);
  const after = valueKind(cond.field, op, attrType);
  const next: SegmentCondition = { field: cond.field, op };
  if (before === after && cond.value !== undefined) next.value = cond.value;
  else if (after === "days") next.value = 30;
  return next;
}

export function isComplete(cond: SegmentCondition, attrType: AttrTypeLookup = () => "text"): boolean {
  const kind = valueKind(cond.field, cond.op, attrType);
  if (kind === "none") return true;
  const v = cond.value;
  if (kind === "boolean") return typeof v === "boolean";
  if (kind === "number" || kind === "days") return v !== undefined && v !== "" && Number.isFinite(Number(v)) && (kind !== "days" || Number(v) > 0);
  return typeof v === "string" && v.trim() !== "";
}

/**
 * The payload sent to the API: incomplete rows dropped, text trimmed, number and day
 * values sent as numbers, email values lowercased.
 */
export function serializeRules(rules: SegmentRules, attrType: AttrTypeLookup = () => "text"): SegmentRules {
  const conditions: SegmentCondition[] = [];
  for (const c of rules.conditions) {
    if (!isComplete(c, attrType)) continue;
    const kind = valueKind(c.field, c.op, attrType);
    const out: SegmentCondition = { field: c.field, op: c.op };
    if (kind === "number" || kind === "days") out.value = Number(c.value);
    else if (kind === "boolean") out.value = Boolean(c.value);
    else if (kind === "none") {
      if (c.field === "never_opened") out.value = true;
    } else {
      const text = String(c.value).trim();
      out.value = c.field === "email" ? text.toLowerCase() : text;
    }
    conditions.push(out);
  }
  return { match: rules.match, conditions };
}

/** True when the two rule sets would send the same payload. */
export const sameRules = (a: SegmentRules, b: SegmentRules, attrType?: AttrTypeLookup): boolean =>
  JSON.stringify(serializeRules(a, attrType)) === JSON.stringify(serializeRules(b, attrType));

export interface DescribeContext {
  listName?: (id: string) => string;
  attrLabel?: (key: string) => string;
}

export function fieldLabel(field: SegmentField, ctx: DescribeContext = {}): string {
  if (isAttrField(field)) return ctx.attrLabel?.(attrKey(field)) ?? attrKey(field);
  return BASE_FIELDS.find((f) => f.field === field)?.label ?? field;
}

/** "Tag is vip", "Opened an email in the last 30 days". */
export function describeCondition(c: SegmentCondition, ctx: DescribeContext = {}): string {
  const label = fieldLabel(c.field, ctx);
  if (c.field === "never_opened") return "Has never opened an email";
  if (c.op === "is_set") return `${label} is set`;
  if (c.op === "is_not_set") return `${label} is not set`;
  if (c.op === "in_last_days" || c.op === "not_in_last_days") {
    const days = Number(c.value);
    const unit = days === 1 ? "day" : "days";
    if (c.field === "opened_in_days") return `${c.op === "in_last_days" ? "Opened" : "Did not open"} an email in the last ${days} ${unit}`;
    if (c.field === "clicked_in_days") return `${c.op === "in_last_days" ? "Clicked" : "Did not click"} a link in the last ${days} ${unit}`;
    return `${label} ${OP_LABELS[c.op]} ${days} ${unit}`;
  }
  let value = String(c.value ?? "");
  if (c.field === "list" && ctx.listName) value = ctx.listName(value);
  if (c.field === "status") value = value.toLowerCase().replace(/_/g, " ");
  return `${label} ${OP_LABELS[c.op]} ${value}`;
}

export function describeRules(rules: SegmentRules, ctx: DescribeContext = {}): string {
  if (rules.conditions.length === 0) return "Everyone";
  const joiner = rules.match === "all" ? " and " : " or ";
  return rules.conditions.map((c) => describeCondition(c, ctx)).join(joiner);
}
