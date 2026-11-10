// CSV import: guess which column holds what, and check a mapping before it is sent.

export type MappingTarget = "email" | "first_name" | "last_name" | "full_name" | "tags" | `attr:${string}` | "skip";

export type ImportMapping = Record<string, MappingTarget>;

const norm = (s: string): string => s.toLowerCase().replace(/^\uFEFF/, "").replace(/[^a-z0-9]+/g, "");

const SYNONYMS: Record<Exclude<MappingTarget, `attr:${string}` | "skip">, string[]> = {
  email: ["email", "emailaddress", "mail", "emailid", "eaddress", "contactemail", "workemail"],
  first_name: ["firstname", "first", "givenname", "fname", "forename"],
  last_name: ["lastname", "last", "surname", "familyname", "lname"],
  full_name: ["name", "fullname", "contactname", "customername"],
  tags: ["tags", "tag", "labels", "groups"],
};

export interface FieldOption {
  key: string;
  label: string;
}

/**
 * One guess per header. A header matches a built-in target by synonym, or a custom
 * field by key or label. Each target is used at most once, first column wins, so two
 * columns never claim "email". Unmatched columns are skipped.
 */
export function suggestMapping(headers: string[], customFields: FieldOption[] = []): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  const custom = customFields.map((f) => ({ target: `attr:${f.key}` as MappingTarget, names: [norm(f.key), norm(f.label)] }));
  for (const header of headers) {
    const n = norm(header);
    let pick: MappingTarget = "skip";
    if (n) {
      for (const [target, names] of Object.entries(SYNONYMS)) {
        if (names.includes(n) && !used.has(target)) {
          pick = target as MappingTarget;
          break;
        }
      }
      if (pick === "skip") {
        const hit = custom.find((c) => c.names.includes(n) && !used.has(c.target));
        if (hit) pick = hit.target;
      }
    }
    // A full-name column is only useful when first and last name are not mapped separately.
    mapping[header] = pick;
    if (pick !== "skip") used.add(pick);
  }
  // Drop "full_name" when separate first/last columns exist.
  if (used.has("full_name") && (used.has("first_name") || used.has("last_name"))) {
    for (const h of headers) if (mapping[h] === "full_name") mapping[h] = "skip";
  }
  return mapping;
}

export interface MappingCheck {
  ok: boolean;
  problems: string[];
}

export function validateMapping(mapping: ImportMapping): MappingCheck {
  const problems: string[] = [];
  const targets = Object.values(mapping).filter((t) => t !== "skip");
  if (!targets.includes("email")) problems.push("Choose the column that holds the email address.");
  const dup = targets.find((t, i) => targets.indexOf(t) !== i && t !== "tags");
  if (dup) problems.push(`More than one column is mapped to "${dup}".`);
  return { ok: problems.length === 0, problems };
}

/** Header-to-target pairs that will be imported, for the review step. */
export const mappedColumns = (mapping: ImportMapping): { header: string; target: MappingTarget }[] =>
  Object.entries(mapping)
    .filter(([, t]) => t !== "skip")
    .map(([header, target]) => ({ header, target }));
