# Low-level design

How the code is organised and how a request travels through it. The big picture is in
[HLD.md](HLD.md). Paths are relative to the repository root.

## 1. Repository layout

| Path | What it is |
| --- | --- |
| [`apps/api`](../../apps/api) | `@open-email/api`: Express 5 API, background jobs, scripts, tests |
| [`apps/web`](../../apps/web) | `@open-email/web`: the tenant SPA |
| [`apps/console`](../../apps/console) | `@open-email/console`: the operator SPA |
| [`packages/types`](../../packages/types) | `@open-email/types`: the wire contract both apps import |
| [`db`](../../db) | The SQL migration and its runner |
| [`infra`](../../infra) | Dockerfiles and Terraform |
| [`deploy/compose`](../../deploy/compose) | Docker Compose files for the local stacks |
| [`e2e`](../../e2e) | Playwright tests |

One pnpm and Turborepo workspace ([`pnpm-workspace.yaml`](../../pnpm-workspace.yaml),
[`turbo.json`](../../turbo.json)).

## 2. API layers

| Layer | Folder | Rule |
| --- | --- | --- |
| Routes | [`apps/api/src/routes`](../../apps/api/src/routes) | Mount path and guards. [`routes/index.ts`](../../apps/api/src/routes/index.ts) is the single gating map for the tenant plane; [`routes/operator/index.ts`](../../apps/api/src/routes/operator/index.ts) for the operator plane; [`routes/public.route.ts`](../../apps/api/src/routes/public.route.ts) for the links inside emails |
| Controllers | [`apps/api/src/controllers`](../../apps/api/src/controllers) | Used by auth, users, tenant settings, audit, notifications and the operator plane. Read `req`, call one service, answer with `sendSuccessResponse`. The audience, campaign, domain and monitoring routers call their service directly through the small helpers in [`utils/route.ts`](../../apps/api/src/utils/route.ts) (`ctx`, `ok`, `created`) |
| Services | [`apps/api/src/services`](../../apps/api/src/services) | Business rules, transactions, SES calls. Singletons (`export default new XService()`). Throw typed errors from [`errors/index.ts`](../../apps/api/src/errors/index.ts) |
| Repositories | [`apps/api/src/repositories`](../../apps/api/src/repositories) | Kysely queries for the sending infrastructure (domains, identities, messages, suppressions, reputation), users, roles, tenants and audit. The audience and campaign services query Kysely directly because their SQL is the feature |
| Presenters | [`apps/api/src/presenters`](../../apps/api/src/presenters) | Row to wire-shape mappers that produce the `@open-email/types` DTOs |
| Validators | [`apps/api/src/validators`](../../apps/api/src/validators) | zod schemas applied by `validateBody` on the sign-in, reset-password, plan, tenant and operator routes. Everything else validates inside its service and answers 400 with a message |
| Queue and jobs | [`apps/api/src/queue`](../../apps/api/src/queue), [`apps/api/src/jobs`](../../apps/api/src/jobs) | The `mail-work` queue and the recurring sweeps (section 5) |
| Database | [`apps/api/src/db`](../../apps/api/src/db) | Pool and Kysely instance ([`connection.ts`](../../apps/api/src/db/connection.ts)), generated types ([`types.ts`](../../apps/api/src/db/types.ts), [`enums.ts`](../../apps/api/src/db/enums.ts)), the Redis client ([`redis.ts`](../../apps/api/src/db/redis.ts)) |

Pure helpers live in [`apps/api/src/utils`](../../apps/api/src/utils) and carry the unit
tests: `render` (the safe renderer), `segment-sql`, `tokens`, `csv`, `open-classify`,
`email-dns`, `links`, `url-safety`.

### Response and error envelope

Success: `{ data, statusCode, message, success: true }`. Errors go through
[`globalErrorHandler`](../../apps/api/src/middlewares/error-handler.middleware.ts):

```json
{ "success": false, "statusCode": 404, "error": { "message": "Campaign not found" },
  "message": "route: /campaigns/01J..., errorMsg: Campaign not found, rayId: Qm3x..." }
```

| Error class | Status |
| --- | --- |
| `BadRequestError` | 400 |
| `UnauthorizedError` | 401 |
| `ForbiddenError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `UnprocessableError` | 422 |
| `TooManyRequestError` | 429 |
| `InternalServerError` | 500 |

Each error gets an 18-character `rayId` that is also logged. An unexpected exception answers
500; in production both `error.message` and the top-level `message` are generic (route,
`INTERNAL SERVER ERROR`, `rayId`) and the exception text stays in the log.

### Time

`process.env.TZ = "UTC"` is set before any import in [`index.ts`](../../apps/api/src/index.ts)
and again in [`db/connection.ts`](../../apps/api/src/db/connection.ts), because `pg`
serialises `Date` with local getters. Columns are `timestamp(3)` without time zone and the
pool parses them as UTC (`setTypeParser(1114, ...)`). A campaign's `scheduled_at` is a UTC
instant; the tenant's `timezone` is only the zone the UI shows it in. The monthly quota
resets at 00:00 UTC on the first of the month.

### Database pool

[`db/connection.ts`](../../apps/api/src/db/connection.ts) builds one `pg.Pool` per worker from
the `PG_DATABASE_*` variables (`max` 8 in production, 10 otherwise, overridable with
`PG_POOL_MAX`; `statement_timeout` 30 s). The API does not read `DATABASE_URL`; the migration
runner does. Size the database connection limit for tasks times workers times `PG_POOL_MAX`.

## 3. The request pipeline

Order in [`app.ts`](../../apps/api/src/app.ts):

| Step | What | Notes |
| --- | --- | --- |
| 1 | `trust proxy` = `TRUST_PROXY` | Number of proxies in front (ALB 1, CloudFront plus ALB 2). Decides `req.ip` for rate limits and for the hashed IP on tracking events |
| 2 | `GET /up` | Load balancer liveness, before everything else |
| 3 | CORS | `Access-Control-Allow-Origin` only for origins in `CORS_ORIGINS` (default `EMAIL_APP_URL` and `OPERATOR_APP_URL`; `*` is dropped). `OPTIONS` answers 204 |
| 4 | `compression`, `express.json` (10 MB), `express.urlencoded` (10 MB), `helmet` | |
| 5 | `GET /local-files/*` | Local-disk driver only: serves a file for a valid, unexpired HMAC link |
| 6 | `GET /api/health` | `{ ok, service: "open-email-api", at }` |
| 7 | Public router | `/t /u /w /f /c`, mounted before the global limiter. Each route has its own limiter ([tracking.md](tracking.md)) |
| 8 | `globalApiLimiter` | 600 requests per minute per IP across the tenant and operator planes |
| 9 | `/api/v1/operator` | Operator plane: its own auth, mounted before the tenant router so names never collide |
| 10 | `/api/v1` | Tenant plane |
| 11 | 404 and `globalErrorHandler` | |

Tenant plane gating in [`routes/index.ts`](../../apps/api/src/routes/index.ts), three tiers:

```text
public           /auth/login, /auth/forgot-password, /auth/reset-password
authenticated    /auth/me, /auth/logout, /tenant, /users, /notifications
module gated     /dashboard (analytics), /contacts /custom-fields /lists /segments /forms /imports
                 (audience), /templates (templates), /campaigns (campaigns), /email (email), /audit (audit)
setup            /email/domains, /email/senders: any of channels, campaigns or email may read;
                 writes need the channels capability
```

`authenticateUser` verifies the JWT, reloads the user joined to its tenant (a user that is not
`ACTIVE` gets 401, a tenant that is not `ACTIVE` gets 403) and sets `req.authUser` and
`req.tenantId`. A module route then runs `requireModule(key)`: the tenant must hold the
`module.<key>` entitlement, then the user's role must grant the key
([multi-tenancy-and-entitlements.md](multi-tenancy-and-entitlements.md), [rbac.md](rbac.md)).
Handlers take the tenant from `ctx(req)`, never from the body or the URL.

## 4. Rate limits

Defined in one reviewable map in
[`middlewares/rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts):
fixed windows, a Redis counter when `REDIS_URL` is set (shared across instances), else an
in-process window. A Redis error fails open; an absent Redis does not. Every response from a
limited route carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`, and a
rejection adds `Retry-After`. Limits are off under tests and when `RATE_LIMIT_ENABLED=false`.

| Limiter | Window | Max | Key |
| --- | --- | --- | --- |
| global (tenant and operator planes) | 1 min | 600 | IP |
| sign-in | 5 min | 10 per IP, 5 per email | IP, email |
| forgot password | 15 min | 5 per IP, 3 per email | IP, email |
| reset password | 15 min | 10 | IP |
| operator change password | 15 min | 10 | operator |
| tracking (`/t/o`, `/t/c`) | 1 min | 3000 | IP |
| public links (`/u /w /f GET /c`) | 1 min | 120 | IP |
| subscribe form POST | 10 min | 20 per IP | IP |
| subscribe form POST | 1 min | 120 per form | slug |

Separately, the **send limiter** ([`services/rate-limit.service.ts`](../../apps/api/src/services/rate-limit.service.ts))
caps messages per second: a per-tenant counter (`EMAIL_DEFAULT_TENANT_TPS` scaled by the
reputation multiplier) and an account-wide counter (`EMAIL_ACCOUNT_TPS`). Both must pass.
Without Redis it allows everything ([sending-pipeline.md](sending-pipeline.md#rate-limits)).

## 5. Background work

Two mechanisms, both started by the one worker that runs with `RUN_JOBS=true`
([`jobs/index.ts`](../../apps/api/src/jobs/index.ts)).

**Recurring sweeps** ([`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts)): one entry per
job; the scheduler upserts a BullMQ job scheduler per entry, so the schedule lives in Redis and
survives restarts, and without Redis falls back to `setInterval`. Orphaned schedulers are
removed on boot.

| Job | Every | Does |
| --- | --- | --- |
| `campaign-scheduler` | 30 s | Starts `SCHEDULED` campaigns whose time has come (up to 20 per tick; one that cannot start becomes `PAUSED` with the reason) and re-enqueues `SENDING` campaigns |
| `verify-domains` | 1 min | Refreshes `PENDING` sending domains: SES status and DNS lookups, or the simulator |
| `reputation-recovery` | 10 min | Steps `WARNING` and `THROTTLED` tenants up one level after the 48 hour cooldown once rates clear |
| `health-sweep` | 24 h | Re-checks `VERIFIED` domains against SES, records a health snapshot, fails a domain broken for more than 24 hours. Live SES only |

**The `mail-work` queue** ([`queue/work.ts`](../../apps/api/src/queue/work.ts)): campaign
sending and CSV imports. BullMQ with three attempts and exponential backoff, concurrency 4,
one job per campaign or import id (the job id dedupes). Without Redis the handler runs
in-process (awaited under tests).

**The SES events consumer** ([`jobs/ses-events.consumer.ts`](../../apps/api/src/jobs/ses-events.consumer.ts)):
long-polls `SES_EVENTS_QUEUE_URL` (10 messages, 20 s wait), applies each event through
[`email-events.service.ts`](../../apps/api/src/services/email-events.service.ts) and deletes the
message only after it succeeded. A failure leaves it for SQS to redeliver and, after five
receives, move to the dead-letter queue. Idle while the URL is unset.

## 6. Process lifecycle

[`index.ts`](../../apps/api/src/index.ts): the primary forks one worker per CPU in production
(one otherwise); exactly one worker gets `RUN_JOBS=true`, and a replacement inherits the role.
A worker that dies is restarted, at most 10 times a minute. On `SIGTERM` a worker stops the
jobs, closes the HTTP server, Redis and the pool, and is force-killed after 30 seconds.
`assertProductionConfig()` runs first and refuses to start on development defaults
([configuration](../guides/configuration.md#production-guard)).

## 7. Side effects that are not transactional

| Effect | Behaviour |
| --- | --- |
| Audit records | Written after the change, not inside its transaction; a failed write is logged, never surfaced |
| Resolver and entitlement caches | Redis resolver cache (60 s) is invalidated on any domain or identity change; entitlement and role maps are cached 60 s per process and invalidated on write |
| Quota reservation | `tenant_usage_monthly.emails_sent` is incremented before the SES call and given back if the send fails. A crash in between leaves one unit reserved |
| SES identity | Created before the `email_sending_domains` row. If the insert fails the identity is orphaned in SES |
| Onboarding email | Fire and forget after the tenant transaction commits; the operator response says whether mail is configured |
| Tracking events | Recorded after the response data is known; a failed write still serves the pixel or redirect |

## 8. Frontends

| App | Notes |
| --- | --- |
| [`apps/web`](../../apps/web) | React 19, Vite, react-router 7, TanStack Query 5, Zustand with persisted sign-in, axios. [`routes.tsx`](../../apps/web/src/routes.tsx) gates each area with `RequireModule` using the module list from `/auth/me`. Charts are plain SVG |
| [`apps/console`](../../apps/console/src/routes.tsx) | Same stack against `/api/v1/operator`; no module gating, every page needs an operator token |
| Public pages | Rendered by the API as HTML strings ([`utils/public-pages.ts`](../../apps/api/src/utils/public-pages.ts)), not by the SPAs. The dev server proxies `/t /u /w /f /c` to the API so a link on the app origin works |

The token lives in `localStorage` (Zustand persist); there are no cookies anywhere in the
product, so there is no CSRF surface ([security.md](security.md)).
