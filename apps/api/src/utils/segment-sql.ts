import { type Expression, type ExpressionBuilder, type SqlBool, sql } from "kysely";
import { BadRequestError } from "../errors";
import type { DB } from "../db/types";

// Segment rules -> a parameterised Kysely condition on `contacts`. Every value reaches the
// database as a bound parameter; field names come from a fixed allowlist and attribute keys
// are matched against a strict pattern and also bound. Nothing is concatenated into SQL.

export type SegmentOp =
  | "is" | "is_not" | "contains" | "starts_with" | "gt" | "lt"
  | "in_last_days" | "not_in_last_days" | "is_set" | "is_not_set";

export interface SegmentCondition {
  field: string;
  op: SegmentOp;
  value?: string | number | boolean;
}

export interface SegmentRules {
  match: "all" | "any";
  conditions: SegmentCondition[];
}

export const MAX_CONDITIONS = 20;
const ATTR_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const STATUSES = ["SUBSCRIBED", "UNSUBSCRIBED", "BOUNCED", "COMPLAINED", "PENDING_CONFIRMATION"];
const SOURCES = ["MANUAL", "IMPORT", "FORM", "API"];

type Eb = ExpressionBuilder<DB, "contacts">;

const escapeLike = (v: string): string => v.replace(/[\\%_]/g, "\\$&");

const OPS_BY_FIELD: Record<string, SegmentOp[]> = {
  email: ["is", "is_not", "contains", "starts_with"],
  first_name: ["is", "is_not", "contains", "starts_with", "is_set", "is_not_set"],
  last_name: ["is", "is_not", "contains", "starts_with", "is_set", "is_not_set"],
  status: ["is", "is_not"],
  source: ["is", "is_not"],
  tag: ["is", "is_not"],
  list: ["is", "is_not"],
  created_at: ["gt", "lt", "in_last_days", "not_in_last_days"],
  opened_in_days: ["in_last_days", "not_in_last_days", "is"],
  clicked_in_days: ["in_last_days", "not_in_last_days", "is"],
  never_opened: ["is"],
};
const ATTR_OPS: SegmentOp[] = ["is", "is_not", "contains", "starts_with", "gt", "lt", "is_set", "is_not_set"];

const needValue = (c: SegmentCondition): string | number | boolean => {
  if (c.value === undefined || c.value === null || c.value === "") {
    throw new BadRequestError(`Condition on ${c.field} needs a value`);
  }
  return c.value;
};

const asText = (c: SegmentCondition): string => String(needValue(c)).slice(0, 200);
const asDays = (c: SegmentCondition): number => {
  const n = Number(needValue(c));
  if (!Number.isInteger(n) || n < 1 || n > 3650) throw new BadRequestError(`${c.field}: days must be a whole number from 1 to 3650`);
  return n;
};

/** Validates rules and returns them normalised. Throws BadRequestError on anything unusable. */
export const validateRules = (raw: unknown): SegmentRules => {
  if (!raw || typeof raw !== "object") throw new BadRequestError("rules are required");
  const r = raw as Partial<SegmentRules>;
  if (r.match !== "all" && r.match !== "any") throw new BadRequestError('rules.match must be "all" or "any"');
  if (!Array.isArray(r.conditions) || r.conditions.length === 0) throw new BadRequestError("Add at least one condition");
  if (r.conditions.length > MAX_CONDITIONS) throw new BadRequestError(`At most ${MAX_CONDITIONS} conditions`);
  const conditions = r.conditions.map((c) => {
    if (!c || typeof c !== "object") throw new BadRequestError("Invalid condition");
    const { field, op, value } = c as SegmentCondition;
    if (typeof field !== "string" || typeof op !== "string") throw new BadRequestError("Invalid condition");
    const allowed = field.startsWith("attr:") ? ATTR_OPS : OPS_BY_FIELD[field];
    if (!allowed) throw new BadRequestError(`Unknown field: ${field.slice(0, 50)}`);
    if (field.startsWith("attr:") && !ATTR_KEY_RE.test(field.slice(5))) throw new BadRequestError("Invalid custom field key");
    if (!allowed.includes(op)) throw new BadRequestError(`${field} does not support "${op}"`);
    if (value !== undefined && !["string", "number", "boolean"].includes(typeof value)) throw new BadRequestError("Invalid value");
    return { field, op, ...(value !== undefined ? { value } : {}) } as SegmentCondition;
  });
  return { match: r.match, conditions };
};

const textOp = (eb: Eb, col: "email" | "first_name" | "last_name", c: SegmentCondition): Expression<SqlBool> => {
  switch (c.op) {
    case "is": return eb(col, "=", c.field === "email" ? asText(c).toLowerCase() : asText(c));
    case "is_not": return eb(col, "<>", c.field === "email" ? asText(c).toLowerCase() : asText(c));
    case "contains": return sql<boolean>`${sql.ref(`contacts.${col}`)} ILIKE ${"%" + escapeLike(asText(c)) + "%"}`;
    case "starts_with": return sql<boolean>`${sql.ref(`contacts.${col}`)} ILIKE ${escapeLike(asText(c)) + "%"}`;
    case "is_set": return sql<boolean>`COALESCE(${sql.ref(`contacts.${col}`)}, '') <> ''`;
    case "is_not_set": return sql<boolean>`COALESCE(${sql.ref(`contacts.${col}`)}, '') = ''`;
    default: throw new BadRequestError("Unsupported operator");
  }
};

const attrExpr = (key: string) => sql<string | null>`(contacts.attributes ->> ${key})`;

const conditionToExpr = (eb: Eb, c: SegmentCondition): Expression<SqlBool> => {
  const f = c.field;
  if (f.startsWith("attr:")) {
    const key = f.slice(5);
    const a = attrExpr(key);
    switch (c.op) {
      case "is": return sql<boolean>`${a} = ${String(needValue(c))}`;
      case "is_not": return sql<boolean>`${a} IS DISTINCT FROM ${String(needValue(c))}`;
      case "contains": return sql<boolean>`${a} ILIKE ${"%" + escapeLike(asText(c)) + "%"}`;
      case "starts_with": return sql<boolean>`${a} ILIKE ${escapeLike(asText(c)) + "%"}`;
      case "gt":
      case "lt": {
        const n = Number(needValue(c));
        if (!Number.isFinite(n)) throw new BadRequestError(`${f}: a number is required`);
        const cmp = c.op === "gt" ? sql`>` : sql`<`;
        // Only values that look numeric are compared; others never match.
        return sql<boolean>`(CASE WHEN ${a} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${a})::numeric END) ${cmp} ${n}`;
      }
      case "is_set": return sql<boolean>`COALESCE(${a}, '') <> ''`;
      case "is_not_set": return sql<boolean>`COALESCE(${a}, '') = ''`;
      default: throw new BadRequestError("Unsupported operator");
    }
  }
  switch (f) {
    case "email":
    case "first_name":
    case "last_name":
      return textOp(eb, f, c);
    case "status": {
      const v = asText(c).toUpperCase();
      if (!STATUSES.includes(v)) throw new BadRequestError(`Unknown status: ${v.slice(0, 30)}`);
      return c.op === "is"
        ? sql<boolean>`contacts.status = ${v}::contact_status`
        : sql<boolean>`contacts.status <> ${v}::contact_status`;
    }
    case "source": {
      const v = asText(c).toUpperCase();
      if (!SOURCES.includes(v)) throw new BadRequestError(`Unknown source: ${v.slice(0, 30)}`);
      return c.op === "is"
        ? sql<boolean>`contacts.source = ${v}::contact_source`
        : sql<boolean>`contacts.source <> ${v}::contact_source`;
    }
    case "tag": {
      const tag = asText(c);
      return c.op === "is" ? sql<boolean>`${tag} = ANY(contacts.tags)` : sql<boolean>`NOT (${tag} = ANY(contacts.tags))`;
    }
    case "list": {
      const listId = asText(c);
      const inList = sql<boolean>`EXISTS (SELECT 1 FROM list_members lm WHERE lm.contact_id = contacts.id AND lm.tenant_id = contacts.tenant_id AND lm.list_id = ${listId} AND lm.status = 'subscribed')`;
      return c.op === "is" ? inList : sql<boolean>`NOT ${inList}`;
    }
    case "created_at": {
      if (c.op === "in_last_days") return sql<boolean>`contacts.created_at >= now() - make_interval(days => ${asDays(c)})`;
      if (c.op === "not_in_last_days") return sql<boolean>`contacts.created_at < now() - make_interval(days => ${asDays(c)})`;
      const d = new Date(String(needValue(c)));
      if (Number.isNaN(d.getTime())) throw new BadRequestError("created_at: a date is required");
      return c.op === "gt" ? sql<boolean>`contacts.created_at > ${d}` : sql<boolean>`contacts.created_at < ${d}`;
    }
    case "opened_in_days":
      return c.op === "not_in_last_days"
        ? sql<boolean>`(contacts.last_opened_at IS NULL OR contacts.last_opened_at < now() - make_interval(days => ${asDays(c)}))`
        : sql<boolean>`contacts.last_opened_at >= now() - make_interval(days => ${asDays(c)})`;
    case "clicked_in_days":
      return c.op === "not_in_last_days"
        ? sql<boolean>`(contacts.last_clicked_at IS NULL OR contacts.last_clicked_at < now() - make_interval(days => ${asDays(c)}))`
        : sql<boolean>`contacts.last_clicked_at >= now() - make_interval(days => ${asDays(c)})`;
    case "never_opened": {
      const want = c.value === undefined ? true : String(c.value) !== "false";
      return want ? sql<boolean>`contacts.last_opened_at IS NULL` : sql<boolean>`contacts.last_opened_at IS NOT NULL`;
    }
    default:
      throw new BadRequestError(`Unknown field: ${f.slice(0, 50)}`);
  }
};

/** The WHERE condition for the rules, for use inside a query that selects from `contacts`. */
export const rulesToExpression = (eb: Eb, rules: SegmentRules): Expression<SqlBool> => {
  const parts = rules.conditions.map((c) => conditionToExpr(eb, c));
  return rules.match === "all" ? eb.and(parts) : eb.or(parts);
};
