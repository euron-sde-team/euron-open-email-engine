import { escapeHtml as e } from "./render";

// Server-rendered pages for the public links in emails. No JavaScript, no external assets,
// so they work in any client and need no CSP exceptions. Every dynamic value is escaped.

const page = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${e(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#18181b;--muted:#6b7178;--line:#e4e4e7;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#0b0b0d;--fg:#f4f4f5;--muted:#a1a1aa;--line:#27272a;--accent:#6ea8fe}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:30rem;margin:12vh auto 0;padding:0 1rem}
h1{font-size:1.4rem;margin:0 0 .75rem}p{margin:0 0 1rem}.muted{color:var(--muted);font-size:.9rem}
label{display:block;font-size:.9rem;margin:0 0 .25rem}
input[type=email],input[type=text]{width:100%;box-sizing:border-box;padding:.6rem .7rem;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;font:inherit;margin:0 0 1rem}
button{padding:.65rem 1.1rem;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
@media(prefers-color-scheme:dark){button{color:#0b0b0d}}
.hp{position:absolute;left:-9999px;height:0;overflow:hidden}
.err{color:#b91c1c}
@media(prefers-color-scheme:dark){.err{color:#fca5a5}}
</style></head><body><main>${body}</main></body></html>`;

export const unsubscribeConfirmPage = (token: string, email: string, tenant: string): string =>
  page(
    "Unsubscribe",
    `<h1>Unsubscribe</h1><p>Stop marketing email from <strong>${e(tenant)}</strong> to <strong>${e(email)}</strong>?</p>
<form method="post" action="/u/${e(token)}"><button type="submit">Unsubscribe</button></form>`
  );

export const unsubscribedPage = (email: string, tenant: string): string =>
  page("Unsubscribed", `<h1>You are unsubscribed</h1><p><strong>${e(email)}</strong> will no longer receive marketing email from ${e(tenant)}.</p>`);

export const invalidLinkPage = (): string =>
  page("Link not valid", `<h1>This link is not valid</h1><p class="muted">It may have been copied incompletely or has expired.</p>`);

export const confirmedPage = (tenant: string): string =>
  page("Subscription confirmed", `<h1>Subscription confirmed</h1><p>Thanks. You are now subscribed to email from ${e(tenant)}.</p>`);

export const formPage = (f: { slug: string; headline: string; description: string; buttonLabel: string; collectName: boolean }, error?: string): string =>
  page(
    f.headline,
    `<h1>${e(f.headline)}</h1>${f.description ? `<p>${e(f.description)}</p>` : ""}
${error ? `<p class="err" role="alert">${e(error)}</p>` : ""}
<form method="post" action="/f/${e(f.slug)}">
${f.collectName ? `<label for="fn">First name</label><input id="fn" name="firstName" type="text" autocomplete="given-name" maxlength="100"><label for="ln">Last name</label><input id="ln" name="lastName" type="text" autocomplete="family-name" maxlength="100">` : ""}
<label for="em">Email</label><input id="em" name="email" type="email" required autocomplete="email" maxlength="254">
<div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
<button type="submit">${e(f.buttonLabel)}</button></form>`
  );

export const formResultPage = (title: string, message: string, pending: boolean): string =>
  page(title, `<h1>${e(title)}</h1><p>${e(message)}</p>${pending ? `<p class="muted">Check your inbox for a message with a confirmation link.</p>` : ""}`);
