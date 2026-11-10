// Merge tags: the list the editor offers, inserting one at the cursor, and finding
// tags in a body so the editor can warn about the ones nothing fills in.

export interface MergeTagDef {
  key: string;
  label: string;
  /** Shown in the picker so authors know what the recipient will see. */
  example: string;
  /** Default used when the tag is inserted ("there" for a missing first name). */
  fallback?: string;
}

export const BUILTIN_TAGS: MergeTagDef[] = [
  { key: "first_name", label: "First name", example: "Maya", fallback: "there" },
  { key: "last_name", label: "Last name", example: "Rao" },
  { key: "email", label: "Email address", example: "maya@example.com" },
];

/** Tags every sent message resolves itself; they need no data. */
export const SYSTEM_TAGS: MergeTagDef[] = [
  { key: "unsubscribe_url", label: "Unsubscribe link", example: "https://mail.example.com/u/..." },
  { key: "view_in_browser_url", label: "View in browser link", example: "https://mail.example.com/w/..." },
];

/** `{{first_name}}` or, with a fallback, `{{first_name | default: "there"}}`. */
export function formatTag(key: string, fallback?: string): string {
  if (fallback === undefined || fallback === "") return `{{${key}}}`;
  return `{{${key} | default: "${fallback.replace(/"/g, "")}"}}`;
}

export const attrTagKey = (fieldKey: string): string => `attr.${fieldKey}`;

export interface InsertResult {
  text: string;
  caret: number;
}

/** Puts `insertion` where the selection is (replacing a selected range) and returns the new caret. */
export function insertAtCursor(text: string, start: number, end: number, insertion: string): InsertResult {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return { text: text.slice(0, s) + insertion + text.slice(e), caret: s + insertion.length };
}

const TAG_RE = /\{\{\s*([a-zA-Z_][\w.]*)\s*(?:\|[^}]*)?\}\}/g;

/** Unique tag keys used in a body, in order of first use. */
export function extractTags(source: string): string[] {
  const seen = new Set<string>();
  for (const m of source.matchAll(TAG_RE)) seen.add(m[1]);
  return [...seen];
}

/** Tags in a body that are neither built in, system, nor a known custom field. */
export function unknownTags(source: string, customFieldKeys: string[]): string[] {
  const known = new Set<string>([
    ...BUILTIN_TAGS.map((t) => t.key),
    ...SYSTEM_TAGS.map((t) => t.key),
    ...customFieldKeys.map(attrTagKey),
  ]);
  return extractTags(source).filter((k) => !known.has(k));
}

/** Does the body contain the unsubscribe link every marketing email needs? */
export const hasUnsubscribeTag = (source: string): boolean => extractTags(source).includes("unsubscribe_url");
