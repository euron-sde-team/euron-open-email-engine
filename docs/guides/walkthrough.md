# Walkthrough

One story from an empty deployment to a campaign report, a bounce and an unpause, using both
apps. It works on a local stack ([quickstart-local.md](quickstart-local.md)) in simulated or Floci
mode. Addresses are fictional (`example.com`, `.example`).

Where the demo data (`make demo`) already has something, the walkthrough says so, but to follow
it from scratch use a fresh tenant as below. Passwords: the seeded accounts use
`EMAIL_DEMO_PASSWORD` from `deploy/compose/.env`.

## Who is in the demo

| Account | App | Notes |
| --- | --- | --- |
| `operator@example.com` | Console, http://localhost:3660 | SUPERADMIN |
| `maya@northwind.example` | Tenant app, http://localhost:3650 | ADMIN, Northwind Mail, Growth, verified domain, full history |
| `theo@northwind.example` | Tenant app | MARKETER |
| `priya@northwind.example` | Tenant app | ANALYST (dashboard, messages, reputation only) |
| `sam@acme-robotics.example` | Tenant app | ADMIN, Acme Robotics, Starter, domain still pending |

## 1. The operator creates a plan and a tenant

Sign in to the console as the operator.

1. **Plans.** The demo has Starter, Growth and Scale. Create one called `PILOT` (the key is
   UPPER_SNAKE): modules audience, templates, campaigns, analytics, email and audit; limits
   1,000 emails a month, 500 contacts, 1 domain, 3 users. A limit left empty is unlimited. A
   plan is only a template: editing it later never changes tenants that already exist.
2. **Tenants, Create tenant.** Name `Harbor Books`, plan `PILOT`, an admin
   (`owner@harbor-books.example`, with no password, one is generated and emailed; locally it goes
   to Mailpit at http://localhost:8126). The tenant, its entitlement snapshot, its first admin
   and the eight starter templates are created together.
3. Open the tenant page: the fleet row, usage against the plan (0 of 1,000 emails), domains
   (none), reputation (`ACTIVE`).

## 2. The tenant verifies a domain

Sign in to the tenant app as the new admin (take the password from the Mailpit email, and change
it). The dashboard shows a setup checklist: domain, sender, contacts, template, campaign.

1. **Domains, Add domain**: `mail.harbor-books.example`. The wizard shows the DNS records: three
   DKIM CNAMEs, a MAIL FROM MX and TXT, SPF and DMARC suggestions, and the tracking CNAME
   `track.mail.harbor-books.example`. Each has a copy button and a status (found, not found,
   unknown), as plain text.
2. Locally, press **Check now**: simulated mode and Floci verify without DNS. On real SES you
   publish the records first ([connect-ses.md](connect-ses.md)); the domain re-checks itself every
   minute.
3. **Senders, Add sender**: `hello` on that domain, display name `Harbor Books`, set as the
   default for marketing. A sender needs a verified domain.
4. **Send a test** from the sender: the message goes to you, not counted against the quota.

## 3. Import contacts

**Import** is three steps.

1. Upload a CSV (10 MB, 100,000 rows at most):

   ```text
   email,first,last,plan
   ada@example.com,Ada,Lovelace,pro
   grace@example.com,Grace,Hopper,free
   bounce@example.com,Bo,Unce,free
   complaint@example.com,Cora,Plaint,free
   soft@example.com,Sofia,Tran,free
   ```

2. Map the columns: `email` to email, `first` to first name, `last` to last name, and `plan` to
   a custom field. Create the custom field `plan` first on the **Lists** page (it has a Custom fields section); an
   unmapped column is skipped. Pick or create a list (`Readers`), add a tag, and tick the
   consent box: the importer confirms they have permission to email these people.
3. Start. The page polls the job: created, updated, skipped, and a list of row errors. Running it
   again changes nothing (rows are matched on email), and it never turns an unsubscribed or
   bounced contact back into a subscriber.

The `bounce@`, `soft@` and `complaint@` addresses are for the simulator; they are used in step 7.

## 4. Build a segment

**Segments, New**. Add conditions: `attr:plan` is `pro`, and `status` is `SUBSCRIBED`, match
**all**. The count and ten sample contacts update as you type (the count has a 3 second
timeout). Save it as "Pro readers".

Segments are evaluated when a campaign starts, not when you save, and the app says so.

## 5. Design a template

**Templates** has eight starters: newsletter, announcement, product launch, promotion, event
invitation, welcome, re-engagement and a plain letter. Starters cannot be deleted; duplicate
one. Edit the HTML on the left; the right is a live preview in a sandboxed frame (no scripts, as
in most inboxes). Insert a merge tag from the menu: `{{first_name | default: "there"}}`. The
preview shows tags that had no value in `missingTags`. Preview with a real contact to see their
values. Keep an `{{unsubscribe_url}}` link; if you leave it out, a footer with one is added.

## 6. Compose and schedule a campaign

**Campaigns, New**. Four steps; drafts save as you move.

1. **Setup**: name, subject, preheader, the sender.
2. **Audience**: all contacts, one or more lists, or a segment (choose "Pro readers").
3. **Content**: pick the template (its HTML is copied into the campaign) and edit.
4. **Review and schedule**: the **preflight** lists what blocks or warns: sender unverified,
   sending paused, no recipients, quota exceeded (errors), and a missing postal address, no
   links, no unsubscribe tag (warnings). Add your company address in **Settings** to clear that
   one. **Send a test** to up to five addresses.

Choose **Schedule for later** and pick a time; the app shows the workspace's timezone and stores
UTC. While `SCHEDULED` you can unschedule or cancel. Or choose **Send now**. The scheduler
starts due campaigns within 30 seconds. Open Mailpit to read what was sent.

## 7. Read the report, handle a bounce

Open the campaign: `SENDING` becomes `SENT` when nothing is queued. The **report** shows the
funnel (recipients, sent, delivered, opened, clicked), the timeline (hourly for 48 hours, then
daily), per-link clicks, bounce reasons, the top recipient domains, and a table of recipients
with their status. Opens carry a count of **machine opens** (Apple Mail Privacy Protection and
proxies): read open rates with that in mind.

Click a tracked link in an email (Mailpit, or the pixel URL for an open) to see a real click
and open arrive.

Now the simulated misbehaviour: `bounce@example.com` was sent a hard bounce. Open **Contacts**:
its status is `BOUNCED` and it is on **Suppressions** with reason `HARD_BOUNCE`; it will never
be mailed again, and an import will not change that. `complaint@example.com` is `COMPLAINED`
and suppressed. `soft@example.com` shows a soft bounce on the message but stays subscribed.

Press the **unsubscribe link** in a message: a page asks you to confirm and only the button
unsubscribes you (a link scanner opening the link changes nothing). The contact becomes
`UNSUBSCRIBED`, suppressed for marketing mail only.

## 8. A pause, and the operator's unpause

Reputation is computed from bounce and complaint **rates** over 14 days, and acts only once a
tenant has at least 100 sends. To see it with a small list, lower the floor: set
`EMAIL_REPUTATION_MIN_SENDS=5` in `deploy/compose/.env`, run `make up`, add contacts
`bounce@one.example`, `bounce@two.example` and so on (the simulator keys on the local part
`bounce`, so use a different domain each time), and send a campaign to them with a few normal
addresses. When the permanent bounce rate passes 5 percent the tenant is paused.

1. The tenant's **Reputation** page moves `ACTIVE` to `WARNING`, `THROTTLED` and then `PAUSED`
   as the rates cross 3, 4 and 5 percent; each change is in the history with its reason.
2. At `PAUSED`, the running campaign becomes `PAUSED` with the reason "Tenant sending paused",
   and new marketing sends are refused at the preflight.
3. In the console, **Fleet** lists the tenant under paused, sorted by rate. Open it: reputation
   history, usage, domains. Press **Lift restriction**, give a reason (required), and confirm.
   The change is in the operator audit log with your name and the reason.
4. Back in the tenant app the status is `ACTIVE`. The paused campaign stays `PAUSED`: press
   **Resume**. Clean the list first, or the next bounces pause it again.

Without lowering the floor, the demo's Northwind Mail tenant shows the same history: one
`WARNING` episode that recovered by itself after 48 hours with clean rates.

## 9. Look around

| Where | See |
| --- | --- |
| Tenant: Dashboard | Usage, 30-day trend, top campaigns, audience, checklist |
| Tenant: Messages | Every message with a timeline of events |
| Tenant: Team | Invite a MARKETER or ANALYST; custom roles |
| Tenant: Audit log | Who changed what |
| Console: Account health | SES mode, sandbox, quota, account-wide rates |
| Console: Dead-letter queue | Depth and a sample of events the API could not process |
| Console: Audit | Every operator action |

## Limitations the walkthrough shows

Opens are unreliable and flagged; links use the platform host; segments are evaluated at send
time; there is no A/B test, automation, developer API, SMTP relay or webhook in 0.1.
