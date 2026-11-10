// Safe email renderer. Merge tags are looked up in a fixed table of values and substituted as
// text; nothing in a template is ever evaluated. Values are HTML-escaped, dangerous markup
// (scripts, event handlers, javascript: URLs) is stripped, links are rewritten through an
// injected function, and an open pixel is appended. Pure: no I/O, so it is unit-tested.

export interface RenderContact {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  attributes?: Record<string, unknown> | null;
}

export interface RenderInput {
  subject: string;
  preheader?: string | null;
  html: string;
  text?: string | null;
  contact: RenderContact;
  company?: { name?: string | null; address?: string | null };
  unsubscribeUrl?: string | null;
  viewUrl?: string | null;
  /** Returns the tracked URL for a link, or null to leave it alone. */
  trackLink?: (url: string) => string | null;
  /** 1x1 image URL appended to the body; omitted for previews and tests. */
  pixelUrl?: string | null;
  now?: Date;
}

export interface RenderOutput {
  subject: string;
  html: string;
  text: string;
  missingTags: string[];
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const TAG_RE =
  /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]{0,60})\s*(?:\|\s*default\s*:\s*(?:"([^"]{0,200})"|'([^']{0,200})'))?\s*\}\}/g;

/** Dangerous markup removed before anything is sent or shown. */
export const sanitizeHtml = (html: string): string =>
  html
    .replace(/<\s*(script|iframe|object|embed|applet|base|meta\s+http-equiv)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, "")
    .replace(/<\s*(script|iframe|object|embed|applet|base)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|formaction)\s*=\s*("|')\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1=$2#$2');

const valueOf = (
  name: string,
  input: RenderInput,
  year: number
): string | null | undefined => {
  const c = input.contact;
  switch (name) {
    case "first_name":
      return c.firstName?.trim() || null;
    case "last_name":
      return c.lastName?.trim() || null;
    case "full_name": {
      const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      return full || null;
    }
    case "email":
      return c.email;
    case "company_name":
      return input.company?.name?.trim() || null;
    case "company_address":
      return input.company?.address?.trim() || null;
    case "unsubscribe_url":
      return input.unsubscribeUrl ?? null;
    case "view_in_browser_url":
      return input.viewUrl ?? null;
    case "current_year":
      return String(year);
    default:
      if (name.startsWith("attr.")) {
        const raw = c.attributes?.[name.slice(5)];
        if (raw === null || raw === undefined || raw === "") return null;
        return typeof raw === "object" ? null : String(raw);
      }
      return undefined;
  }
};

/** Substitutes merge tags. `mode` decides escaping; unknown tags render as empty. */
export const substituteTags = (
  template: string,
  input: RenderInput,
  mode: "html" | "text",
  missing?: Set<string>
): string => {
  const year = (input.now ?? new Date()).getUTCFullYear();
  return template.replace(TAG_RE, (_m, name: string, dq?: string, sq?: string) => {
    const fallback = dq ?? sq;
    const v = valueOf(name, input, year);
    const out = v ?? fallback;
    if (out === undefined || out === null) {
      missing?.add(name);
      return "";
    }
    if (mode === "text") return out;
    return escapeHtml(out);
  });
};

/** Names of every merge tag a template uses. */
export const tagsIn = (template: string): string[] => {
  const names = new Set<string>();
  for (const m of template.matchAll(TAG_RE)) names.add(m[1]);
  return [...names];
};

const HREF_RE = /(<a\b[^>]*?\bhref\s*=\s*)("([^"]*)"|'([^']*)')/gi;

/** Static http(s) links in a template: the ones that can be tracked ahead of time. */
export const extractLinks = (html: string): string[] => {
  const out = new Set<string>();
  for (const m of html.matchAll(HREF_RE)) {
    const url = (m[3] ?? m[4] ?? "").trim();
    if (!url || url.includes("{{")) continue;
    if (/^https?:\/\//i.test(url)) out.add(decodeAttr(url));
  }
  return [...out];
};

const decodeAttr = (v: string): string => v.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

const rewriteLinks = (html: string, input: RenderInput): string => {
  const track = input.trackLink;
  if (!track) return html;
  return html.replace(HREF_RE, (whole, pre: string, quoted: string, dq?: string, sq?: string) => {
    const raw = decodeAttr((dq ?? sq ?? "").trim());
    if (!/^https?:\/\//i.test(raw)) return whole;
    if (raw === input.unsubscribeUrl || raw === input.viewUrl) return whole;
    const tracked = track(raw);
    return tracked ? `${pre}"${escapeHtml(tracked)}"` : whole;
  });
};

const footerHtml = (input: RenderInput): string => {
  const addr = input.company?.address?.trim();
  const name = input.company?.name?.trim();
  const lines = [name, addr].filter(Boolean).map((l) => escapeHtml(l as string));
  const unsub = input.unsubscribeUrl
    ? `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7178;">Unsubscribe</a>`
    : "";
  const view = input.viewUrl
    ? `<a href="${escapeHtml(input.viewUrl)}" style="color:#6b7178;">View in browser</a>`
    : "";
  const links = [view, unsub].filter(Boolean).join(" &middot; ");
  return `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e4e4e7;font-size:12px;line-height:1.5;color:#6b7178;text-align:center;">${lines.join("<br>")}${lines.length && links ? "<br>" : ""}${links}</div>`;
};

export const htmlToText = (html: string): string =>
  html
    .replace(/<(style|head|title)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const l = label.replace(/<[^>]+>/g, "").trim();
      return l && l !== href ? `${l} (${href})` : href;
    })
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const renderEmail = (input: RenderInput): RenderOutput => {
  const missing = new Set<string>();
  const subject = substituteTags(input.subject, input, "text", missing)
    .replace(/[\r\n]+/g, " ")
    .trim();

  let body = sanitizeHtml(input.html);
  const hasUnsubTag = /\{\{\s*unsubscribe_url\b/.test(body);
  body = substituteTags(body, input, "html", missing);
  if (!hasUnsubTag && (input.unsubscribeUrl || input.company?.address)) {
    const footer = footerHtml(input);
    body = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, `${footer}</body>`) : body + footer;
  }
  body = rewriteLinks(body, input);

  const pre = input.preheader ? substituteTags(input.preheader, input, "text", missing).trim() : "";
  if (pre) {
    const hidden = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(pre)}</div>`;
    body = /<body\b[^>]*>/i.test(body) ? body.replace(/(<body\b[^>]*>)/i, `$1${hidden}`) : hidden + body;
  }
  if (input.pixelUrl) {
    const pixel = `<img src="${escapeHtml(input.pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
    body = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, `${pixel}</body>`) : body + pixel;
  }

  let text: string;
  if (input.text && input.text.trim()) {
    text = substituteTags(input.text, input, "text", missing);
    if (!/\{\{\s*unsubscribe_url/.test(input.text) && input.unsubscribeUrl) {
      text += `\n\nUnsubscribe: ${input.unsubscribeUrl}`;
    }
  } else {
    // Derive the text part from the template HTML with tags substituted in text mode.
    const textSource = sanitizeHtml(input.html);
    text = htmlToText(substituteTags(textSource, input, "text"));
    if (input.unsubscribeUrl && !/\{\{\s*unsubscribe_url/.test(input.html)) {
      text += `\n\nUnsubscribe: ${input.unsubscribeUrl}`;
    }
  }

  return { subject, html: body, text, missingTags: [...missing] };
};
