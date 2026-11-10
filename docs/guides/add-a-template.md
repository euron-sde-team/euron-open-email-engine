# Add a starter template

Two different things are called templates:

- A **tenant template** is a row a tenant creates in the app (Templates, New, or duplicate a
  starter). No code is involved; see [walkthrough.md](walkthrough.md#5-design-a-template).
- A **starter template** ships with the product: eight of them are copied into every workspace
  when it is created. This guide is about adding or changing those.

The eight today: Newsletter, Announcement, Product launch, Promotion, Event invitation, Welcome,
Re-engagement and Plain letter.

## Where they live

[`apps/api/src/services/starter-templates.ts`](../../apps/api/src/services/starter-templates.ts)
exports `STARTER_TEMPLATES`, an array of `{ name, subject, preheader, html }`, and
`ensureStarterTemplates(tenantId, conn)`, which inserts the ones a tenant lacks (matched by
`name` among rows with `is_starter = true`). It runs when an operator onboards a tenant and in
the demo seed. It is idempotent.

Starters are rows in `templates` with `is_starter = true`; a tenant cannot delete them (409), but
can duplicate and edit the copy.

## Write one

1. Add an entry to `STARTER_TEMPLATES` in a recognisable position. Use the helpers at the top of
   the file (`shell`, `h1`, `p`, `button`) so every starter shares one look: a single column,
   600 px wide, inline styles, no external CSS, no scripts, no web fonts.
2. Use merge tags with defaults so a missing value never leaves a hole:
   `{{first_name | default: "there"}}`, `{{company_name | default: "our team"}}`. Available tags:
   `first_name`, `last_name`, `full_name`, `email`, `company_name`, `company_address`,
   `unsubscribe_url`, `view_in_browser_url`, `current_year` and `attr.<custom field>`
   ([sending-pipeline.md](../architecture/sending-pipeline.md#6-rendering)).
3. Keep links on `https://example.com/...`. Starters must not contain real brands, addresses or
   links: the sanitization scan fails on real email addresses and internal names.
4. You do not need an unsubscribe link in the HTML: a footer with one, the postal address and
   a view-in-browser link is appended when the template has no `{{unsubscribe_url}}`. Add the tag
   yourself to place the link where you want it.
5. Links must be static `http(s)` URLs to be click tracked: a URL containing a merge tag is left
   alone.
6. Write copy that is plain and specific, with no invented statistics, no fake testimonials and no
   urgency tricks.

Mail-client safety: tables or simple blocks, inline styles, images with `alt` text and a width,
a plain-text-friendly structure (the text part is derived from the HTML), and enough contrast to
read in dark mode.

## Check it

- Preview it in the app: Templates, open it (the editor renders it in a sandboxed frame and lists
  tags that had no value).
- `POST /templates/render` renders without saving.
- Send a test from a campaign to your Mailpit inbox (`make up`) and read the real message.
- Run the unit tests for the renderer (`pnpm test`) and, if you changed the count or names,
  update the integration tests that expect eight starters
  (`make test-integration`).
- Run `make sanitize`.

## Existing tenants

A new entry reaches **new** tenants automatically. Existing tenants get it by calling
`ensureStarterTemplates(tenantId)` once for each (a small script, or a one-off task), which adds
only what is missing and never touches edited copies. Nothing runs this on a schedule.
Changing the HTML of an existing starter does not update copies already inserted; a tenant's copy
is theirs.

## Limitations

- There is no visual (drag and drop) editor: templates are HTML.
- Starters are English only, and not localised.
- No per-tenant branding is injected (colour, logo); tenants edit their copy.
