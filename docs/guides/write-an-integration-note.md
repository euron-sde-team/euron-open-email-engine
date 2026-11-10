# Integration roadmap notes: developer API, SMTP relay, webhooks

**None of these exist in 0.1.** The engine sends campaigns that people create in the app. This
page states what is missing, what you can do today, and how each item would fit the existing code,
so that a contribution starts from the right place. These are design notes, not commitments, and
not a specification: open an issue before building ([CONTRIBUTING.md](../../CONTRIBUTING.md)).
The decision to leave them out is [ADR 0009](../architecture/adr/0009-no-developer-api-in-0-1.md).

## What you can do today

| Need | Today |
| --- | --- |
| Put contacts in | CSV import (10 MB, 100,000 rows), the hosted subscribe form `POST /f/:slug` (public, rate limited, JSON or form post), or the tenant routes with a user token |
| Get contacts and results out | `GET /contacts/export.csv`, the campaign report and recipients routes, the message log |
| Know about unsubscribes and bounces | Read them in the app, export contacts, or poll `GET /email/messages` and `GET /email/suppressions` |
| Send mail from your application | Not supported. Use a campaign to a list or segment |

The tenant routes ([rest-contract.md](../api/rest-contract.md)) can technically be called with a
tenant bearer token from a script, but they are the app's session API: tokens expire after 12
hours, have the full power of a user and no per-integration scope, and the routes are not
versioned for third parties. Do not build an integration on them.

## 1. Developer REST API (transactional and programmatic sending)

**Missing:** an API key credential, a send endpoint, programmatic contact upserts.

What it would need, and where it would plug in:

- **Credentials.** An `api_keys` table scoped to a tenant (hashed at rest, shown once, a prefix
  for lookup, scopes such as `send`, `contacts:write`, a revoke and last-used time), a bearer
  middleware that resolves a key to a tenant exactly as `authenticateUser` does, and audit entries.
  Keys must not be tenant JWTs.
- **Sending.** A route such as `POST /v1/messages` that renders (with the same safe renderer) and
  calls `mailerService.sendTenant` with category `TRANSACTIONAL`. That path already does the
  reputation gate, suppression check, per-tenant TPS, quota reservation, the idempotency key
  (`idempotencyKey` per request) and the SES call with tags. The caller supplies a verified
  sender, a recipient, content or a template id, and variables.
- **Per-key limits.** A separate rate limiter per key (the middleware factory in
  [`rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts) takes any
  key builder) so one noisy integration cannot consume a tenant's whole TPS.
- **Contacts.** An upsert route reusing the import logic (`prepareRow` and the conflict rules that
  never revive an unsubscribed or bounced contact). `contacts.source = 'API'` is already reserved.
- **Transactional does not mean unrestricted.** Marketing content sent through a transactional
  path would bypass the unsubscribe and the reputation rules for marketing; the category must be
  declared and enforced per key.
- **Docs.** An OpenAPI file generated from the route definitions, versioned under `/v1`, with
  stable machine-readable error codes (the current errors have only HTTP status and a message).

## 2. SMTP relay

**Missing:** an SMTP listener.

Applications and many tools send by SMTP. A relay would:

- accept submissions (STARTTLS, port 587 or 465) authenticated by an API key from section 1;
- parse the message, map the `From` to a verified sender of that tenant (refuse others), and hand
  it to the same `sendTenant` path as the API, so all gates apply;
- rewrite nothing by default (no tracking) but allow an opt-in header for tracking and a category;
- run as its own service and process (not inside the web cluster), with its own connection and
  size limits, because it is a long-lived protocol endpoint exposed to the internet.

Nothing in 0.1 sets up a listener, a load balancer target for SMTP or the key store it needs.
Note that Amazon SES itself offers an SMTP interface; an operator can use that directly for
non-campaign mail, outside the engine and its per-tenant accounting.

## 3. Outbound webhooks

**Missing:** delivery of events to a tenant's own HTTP endpoint.

The events already exist: every outcome passes through
[`email-events.service.ts`](../../apps/api/src/services/email-events.service.ts) (`apply`) and the
tracking service (`insertEvent` for opens and clicks, unsubscribes), into `email_events`. A webhook
feature would:

- store endpoints per tenant (URL, signing secret encrypted at rest with a
  key you add to the configuration, selected event types, active flag);
- enqueue a delivery per matching event on the `mail-work` queue (BullMQ gives retries and
  backoff), outside the database transaction so a slow endpoint never blocks event processing;
- sign each request (HMAC over timestamp and body) so receivers can verify it, include a stable
  event id so receivers can de-duplicate (at-least-once delivery), and disable an endpoint after
  repeated failures;
- **guard outbound requests against SSRF**: only `https`, resolve the host and refuse private,
  loopback, link-local and metadata addresses, re-check on every call (DNS rebinding), cap time
  and response size, and do not follow redirects. There is no helper for this in the repository:
  this roadmap work starts from scratch;
- show a delivery log and a manual redeliver in the app.

Until then, the supported way to react to events is to poll the message log or read the campaign
report.

## 4. Other items people ask for

Not part of this page's three, but also absent in 0.1: automations and drip sequences, A/B tests,
a drag-and-drop editor, a preference centre, send-time optimisation. They are listed in
[HLD.md](../architecture/HLD.md#7-limitations) and
[comparison.md](../architecture/comparison.md).

## How to propose one

1. Open an issue describing the use case and which of the above it needs.
2. Sketch the data model change as a new migration (`0002_*.sql`), never an edit of
   `0001_init.sql` once it is applied ([ADR 0010](../architecture/adr/0010-sql-migrations-prisma-types-only.md)).
3. Keep every query scoped by `tenant_id` and add a cross-tenant test.
4. Route anything that sends mail through `mailerService.sendTenant`; do not call SES directly.
5. Add an ADR if the change alters a documented decision.
