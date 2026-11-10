# REST contract

The wire contract of the API in `apps/api`: envelopes, authentication, errors, pagination, rate
limits and every route. The TypeScript shapes of the `data` payloads are in
[`packages/types/src/index.ts`](../../packages/types/src/index.ts) (`@open-email/types`), which
both apps import and which the API checks at build time
([`apps/api/contract`](../../apps/api/contract)). There is no OpenAPI file; this page is derived
from the route files in [`apps/api/src/routes`](../../apps/api/src/routes).

There is **no developer API** in 0.1: these routes are what the two apps call, they use
short-lived session tokens and are not versioned for third parties
([ADR 0009](../architecture/adr/0009-no-developer-api-in-0-1.md)).

## 1. Planes and base URLs

| Plane | Base | Port (local) |
| --- | --- | --- |
| Tenant | `/api/v1` | 5126 |
| Operator | `/api/v1/operator` | 5126 |
| Public links | the API root: `/t /u /w /f /c` | 5126 |
| Health | `GET /up` (plain `OK`), `GET /api/health` (`{ ok, service, at }`) | 5126 |

## 2. Envelopes

Success:

```json
{ "success": true, "statusCode": 200, "message": "Request successful", "data": { } }
```

Created resources answer `201`. Many `data` payloads are the DTOs in `@open-email/types`
(camelCase). The operator plane returns some database rows as they are (snake_case:
`plan_key`, `brand_color`, ...) where noted below.

Error:

```json
{ "success": false, "statusCode": 404,
  "error": { "message": "Campaign not found" },
  "message": "route: /campaigns/01J..., errorMsg: Campaign not found, rayId: Qm3xK9..." }
```

`error.message` is the human message to show. There are no machine error codes; branch on the
HTTP status. In production a 500 carries a generic message and the `rayId`, which is also in the
server log. Body validation on sign-in, reset, plan, tenant and operator routes answers `400`
with `field: message`.

| Status | Meaning here |
| --- | --- |
| 400 | Invalid input |
| 401 | Missing, invalid or expired token; account not active; wrong credentials |
| 403 | The module is not in the plan, the role lacks the key, the workspace is suspended, or a plan limit is reached |
| 404 | Not found, **including another tenant's id** |
| 409 | State conflict (already started, duplicate email, slug taken, bounced contact re-subscribe) |
| 422 | The request is well formed but cannot be done now (campaign cannot start, sender unverified, quota) |
| 429 | Rate limited |
| 500 | Unexpected error |

## 3. Authentication

Tenant: `POST /api/v1/auth/login` with `{ "email", "password" }` returns
`{ token, user }`; send `Authorization: Bearer <token>` afterwards. Tokens last `JWT_EXPIRY` (12
hours by default) and are not revocable earlier. Operator tokens come from
`POST /api/v1/operator/auth/login` and only work on the operator plane (and the reverse). There
are no cookies and no API keys.

`user` is `{ id, name, email, role, tenant_id, modules[], tenant: { id, slug, name, brand_color,
plan_key, timezone } }`. `modules` is the list the app uses for navigation.

Every tenant request is scoped to the token's tenant. Ids are ULIDs. Never send a tenant id.

## 4. CORS

Only origins in `CORS_ORIGINS` get `Access-Control-Allow-Origin`; allowed methods `GET, POST,
PUT, PATCH, DELETE, OPTIONS`, allowed headers `Content-Type, Authorization, X-Requested-With,
Accept, Origin`. `OPTIONS` answers 204.

## 5. Pagination

List endpoints that can be large return `{ items, nextCursor }`. Pass `?cursor=<nextCursor>`
for the next page; `nextCursor` is `null` at the end. `limit` defaults to 50 (imports 20) and is
capped at 200 (imports 100). Order is newest first by id; campaign recipients are oldest first.
`total` is not returned. Small collections (lists, custom fields, domains, senders,
templates) return a plain array; the audit log returns the latest 200 entries.

## 6. Rate limits

Headers on limited routes: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
(seconds); a `429` adds `Retry-After`.

| Scope | Limit |
| --- | --- |
| Tenant and operator planes (all routes) | 600 per minute per IP |
| `POST /auth/login`, `/operator/auth/login` | 10 per 5 min per IP and 5 per 5 min per email |
| `POST /auth/forgot-password` (and operator) | 5 per 15 min per IP and 3 per 15 min per email |
| `POST /auth/reset-password` (and operator) | 10 per 15 min per IP |
| `POST /operator/auth/change-password` | 10 per 15 min per operator |
| `GET /t/o/*`, `GET /t/c/*` | 3000 per minute per IP |
| `/u /w` and `GET /f`, `GET /c` | 120 per minute per IP |
| `POST /f/:slug` | 20 per 10 min per IP and 120 per minute per form |

Limits are fixed windows, Redis-backed when `REDIS_URL` is set and per process otherwise, and
off when `RATE_LIMIT_ENABLED=false`. The message send rate (messages per second) is a separate
control ([sending-pipeline.md](../architecture/sending-pipeline.md#rate-limits)).

## 7. Tenant plane

Access column: the module (`M`) or capability (`C`) a route needs; `-` means any signed-in user
of the tenant. A module route also needs the module in the tenant's plan (403 otherwise).

### Auth, workspace, team

| Method and path | Access | Does |
| --- | --- | --- |
| `POST /auth/login` | public | Sign in. Body `{ email, password }` |
| `POST /auth/forgot-password` | public | Email a reset link; always succeeds. Body `{ email }` |
| `POST /auth/reset-password` | public | Body `{ token, password }` (8 characters or more) |
| `GET /auth/me` | - | `{ user }` |
| `POST /auth/logout` | - | Records an audit event |
| `GET /tenant/me` | - | `{ tenant, usage, modules, limits }` |
| `PUT /tenant/me` | C settings | Body any of `name`, `brand_color`, `timezone` (IANA), `company_address` (500 characters), `config` (merged) |
| `GET /tenant/plans` | - | Active plans |
| `GET /users` | - | Members |
| `GET /users/roles` | - | Roles and the module catalogue |
| `PATCH /users/me/password` | - | Body `{ currentPassword, newPassword }` |
| `POST /users` | C team | Body `{ name, email, role, password?, permissions? }`; without a password one is generated and emailed |
| `PUT /users/:id` | C team | Body any of `name`, `role`, `status`, `permissions` |
| `DELETE /users/:id` | C team | Not yourself, not the last admin, not an elevated user unless ADMIN |
| `POST /users/:id/reset-password` | C team | Generate and email a new password |
| `POST /users/roles` | C team | Body `{ name, permissions[] }` |
| `PUT /users/roles/:key`, `DELETE /users/roles/:key` | C team | Edit or delete (or reset an override of) a role |
| `GET /audit` | M audit | Latest 200 entries; filters `action`, `entityType` |
| `GET /notifications` | - | The user's notifications |
| `POST /notifications/read-all`, `POST /notifications/:id/read` | - | Mark read |

### Dashboard

| Method and path | Access | Returns |
| --- | --- | --- |
| `GET /dashboard` | M analytics | `TenantDashboard`: usage against limits, reputation, 30-day daily series, top campaigns, audience counts, setup checklist |

### Sending setup

| Method and path | Access | Does |
| --- | --- | --- |
| `GET /email/domains`, `GET /email/domains/:id` | C channels, M campaigns or M email | `SendingDomain[]` / one |
| `POST /email/domains` | C channels | Body `{ domain }`. Creates the configuration set and SES identity (or the simulated one). Returns the domain with `DnsRecord[]` (DKIM, MAIL FROM, SPF, DMARC, TRACKING). 409 if the domain is taken, 403 at the plan's domain limit |
| `POST /email/domains/:id/check` | C channels | Refresh status and DNS now |
| `DELETE /email/domains/:id` | C channels | Delete the SES identity and the row |
| `GET /email/senders` | C channels, M campaigns or M email | `SenderIdentity[]` |
| `POST /email/senders` | C channels | `SenderIdentityInput`: `{ domainId, localPart, displayName?, replyTo?, defaults? }`; the domain must be `VERIFIED` |
| `PATCH /email/senders/:id` | C channels | `displayName`, `replyTo`, `defaults`, `status` (`ACTIVE`, `ARCHIVED`) |
| `DELETE /email/senders/:id` | C channels | |
| `POST /email/senders/:id/test` | C channels | Send a test message to the signed-in user (not counted) |

### Audience (module `audience`)

| Method and path | Does |
| --- | --- |
| `GET /contacts` | Query `q`, `status`, `tag`, `listId`, `segmentId`, `cursor`, `limit`. `Paged<Contact>` |
| `POST /contacts` | `ContactInput`. 409 duplicate, 403 at the contact limit |
| `GET /contacts/:id`, `PATCH /contacts/:id`, `DELETE /contacts/:id` | `status` may be set to `SUBSCRIBED` or `UNSUBSCRIBED` only |
| `GET /contacts/:id/timeline` | `ContactTimelineEntry[]` (200 most recent) |
| `POST /contacts/bulk` | `ContactBulkInput`: `ids` (at most 500), `action` (`tag`, `untag`, `addToList`, `removeFromList`, `delete`), `value`. Returns `{ affected }` |
| `GET /contacts/export.csv` | CSV stream, formula-safe, at most 100,000 rows |
| `GET /custom-fields`, `POST /custom-fields`, `DELETE /custom-fields/:key` | `{ key, label, type }`; at most 100 |
| `GET /lists`, `POST /lists`, `GET /lists/:id`, `PATCH /lists/:id`, `DELETE /lists/:id` | `ListInput`. Delete is refused while a form uses the list |
| `POST /lists/:id/members`, `DELETE /lists/:id/members` | Body `{ contactIds }` (at most 500) |
| `GET /segments` (`?count=true`), `POST /segments`, `GET /segments/:id`, `PATCH /segments/:id`, `DELETE /segments/:id` | `SegmentInput` with `SegmentRules` |
| `POST /segments/preview` | Body `{ rules }`. Returns `SegmentPreview`: a count and ten contacts |
| `GET /forms`, `POST /forms`, `GET /forms/:id`, `PATCH /forms/:id`, `DELETE /forms/:id` | `SubscribeFormInput`; 409 if the slug is taken |
| `GET /imports`, `GET /imports/:id` | `ImportJob` |
| `POST /imports` | Multipart field `file` (CSV, 10 MB, 100,000 rows). Returns `ImportUpload` (headers, sample rows) |
| `POST /imports/:id/start` | `ImportStartInput`: `{ mapping, listId?, tags?, consentConfirmed: true }` |

### Templates (module `templates`)

| Method and path | Does |
| --- | --- |
| `GET /templates`, `POST /templates` | `EmailTemplate[]`; create with `EmailTemplateInput` |
| `GET /templates/:id`, `PATCH /templates/:id`, `DELETE /templates/:id` | Starter templates cannot be deleted (409) |
| `POST /templates/:id/duplicate` | A copy named "... (copy)" |
| `POST /templates/render` | Body `{ html, subject?, preheader?, contactId? }`. Returns `RenderedEmail` with `missingTags`; without `contactId` a sample contact is used |

### Campaigns (module `campaigns`)

| Method and path | Does |
| --- | --- |
| `GET /campaigns` | Query `status`, `cursor`, `limit`. `Paged<Campaign>` with `stats` |
| `POST /campaigns` | `CampaignInput`; `templateId` copies the template's subject, preheader and HTML |
| `GET /campaigns/:id`, `PATCH /campaigns/:id` | Patch only while `DRAFT` (409 otherwise) |
| `DELETE /campaigns/:id` | Only `DRAFT` or `CANCELLED` |
| `POST /campaigns/:id/duplicate` | A draft copy |
| `GET /campaigns/:id/preview` | Query `contactId`. `RenderedEmail` |
| `GET /campaigns/:id/preflight` | `CampaignPreflight` |
| `POST /campaigns/:id/test` | Body `{ to }`, 1 to 5 addresses. Returns `{ results: [{ to, status }] }` |
| `POST /campaigns/:id/schedule` | Body `{ at? }` (future ISO-8601, at most 366 days out); omit `at` to send now. 422 when the preflight has errors or the audience does not fit the quota |
| `POST /campaigns/:id/unschedule` | `SCHEDULED` to `DRAFT` |
| `POST /campaigns/:id/pause`, `/resume`, `/cancel` | See the state machine in [sending-pipeline.md](../architecture/sending-pipeline.md#1-campaign-states) |
| `GET /campaigns/:id/report` | `CampaignReport`: rates, timeline, links, bounces, top domains, machine opens |
| `GET /campaigns/:id/recipients` | Query `status`, `cursor`, `limit`. `Paged<RecipientRow>` |

### Messages, suppressions, reputation (module `email`)

| Method and path | Does |
| --- | --- |
| `GET /email/messages` | Query `status`, `category`, `campaignId`, `q` (recipient substring), `cursor`, `limit`. `Paged<MessageRow>` |
| `GET /email/messages/:id` | `MessageDetail` with up to 500 events |
| `GET /email/reputation` | `ReputationSummary` |
| `GET /email/suppressions` | Query `q`, `reason`, `cursor`, `limit`. `Paged<SuppressionEntry>` |
| `POST /email/suppressions` | `SuppressionInput` `{ email, category?, note? }`; reason `ADMIN_BLOCK`; also unsubscribes a matching contact when the scope covers marketing |
| `DELETE /email/suppressions/:id` | Remove the suppression (the contact stays as it is) |

## 8. Operator plane

All routes except the auth ones need an operator token. Writes need `SUPERADMIN`; an `OPERATOR`
may read.

| Method and path | Access | Does |
| --- | --- | --- |
| `POST /operator/auth/login` | public | `{ email, password }` returns `{ token, user }` |
| `POST /operator/auth/forgot-password`, `POST /operator/auth/reset-password` | public | As on the tenant plane |
| `GET /operator/auth/me` | operator | `{ user }` |
| `POST /operator/auth/change-password` | operator | `{ currentPassword, newPassword }` |
| `GET /operator/operators` | operator | List operators |
| `POST /operator/operators` | SUPERADMIN | `{ name, email, role, password? }` |
| `PUT /operator/operators/:id` | SUPERADMIN | `name`, `role`, `status` |
| `GET /operator/plans` | operator | Plan rows |
| `POST /operator/plans` | SUPERADMIN | `{ key (UPPER_SNAKE), name, description?, modules[], limits }` where `limits` has `monthlyEmails`, `maxContacts`, `maxDomains`, `maxUsers` (non-negative integers or null) |
| `PUT /operator/plans/:id` | SUPERADMIN | `name`, `description`, `modules`, `limits`, `is_active`, `sort_order`. Never changes existing tenants |
| `GET /operator/tenants` | operator | Query `q`, `status`. Tenant rows with usage |
| `POST /operator/tenants` | SUPERADMIN | `{ name, plan_key, slug?, brand_color?, timezone?, admin: { name, email, password? } }`. Creates the tenant, entitlement snapshot, first admin and starter templates |
| `GET /operator/tenants/:id` | operator | Tenant, entitlements, usage, admin users |
| `PUT /operator/tenants/:id` | SUPERADMIN | `name`, `brand_color`, `status` (`ACTIVE`, `SUSPENDED`, `CLOSED`), `plan_key` (re-snapshots) |
| `PUT /operator/tenants/:id/entitlements` | SUPERADMIN | `{ code, enabled?, limit_value? }`: an `ADMIN` override |
| `GET /operator/tenants/:id/email` | operator | `OperatorTenantEmail`: fleet row, usage, domains, reputation |
| `POST /operator/tenants/:id/email/unpause` | SUPERADMIN | `OperatorUnpauseInput` `{ reason }` (required, 500 characters at most). Sets sending `ACTIVE` |
| `GET /operator/email/fleet` | operator | `FleetOverview` |
| `GET /operator/email/account-health` | operator | `AccountHealth` (SES `GetAccount`, or simulated) |
| `GET /operator/email/dlq` | operator | `DlqSummary`: depth, oldest age, a sample of up to 10 messages (never deleted or redriven here) |
| `GET /operator/metrics/overview` | operator | `OperatorMetricsOverview` |
| `GET /operator/audit` | operator | Query `action`, `tenantId` |

## 9. Public routes (API root, no auth)

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /t/o/:token.gif` | none | `200 image/gif`, 1x1, `Cache-Control: no-store`. Always, even for a bad token |
| `GET /t/c/:token` | none | `302` to the stored URL, or a `404` HTML page |
| `GET /u/:token` | none | HTML confirmation page. **Does not unsubscribe.** `400` page for a bad token |
| `POST /u/:token` | form body, or `List-Unsubscribe=One-Click` (RFC 8058), or `Content-Type: application/json` | One-click or JSON: `200 { "success": true }`. Form: an HTML confirmation. `400` page for a bad token |
| `GET /w/:token` | none | The campaign HTML for that message, with `Content-Security-Policy: default-src 'none'; img-src * data:; style-src 'unsafe-inline'; font-src *; sandbox`. `404` page for a bad token |
| `GET /f/:slug` | none | The hosted form HTML, or a `404` page |
| `POST /f/:slug` | form or JSON `{ email, firstName?, lastName?, website }` (`website` is the honeypot, leave empty) | HTML result page; with JSON `{ success: true, data: { pending, message } }`, or `{ success: false, error: { message } }` (400 invalid email, 404 unavailable) |
| `GET /c/:token` | none | Double opt-in confirmation HTML, `400` page for a bad or expired token (7 days) |
| `GET /local-files/*` | `expires`, `sig` | Local-disk storage only: a file for a valid, unexpired signed link |

Links in emails are built on `APP_PUBLIC_URL` (or a tenant's tracking host when enabled). The
dev servers of the two apps proxy `/t /u /w /f /c` to the API. In production CloudFront and the
load balancer route them to the API, uncached
([`infra/terraform/README.md`](../../infra/terraform/README.md#public-mail-paths)).

## 10. Not in 0.1

No developer REST send API, no API keys, no SMTP relay, no outbound webhooks, no GraphQL, no
OpenAPI document, no bulk contact upsert endpoint (import is by CSV). See
[write-an-integration-note.md](../guides/write-an-integration-note.md).
