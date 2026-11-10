# Multi-tenancy and entitlements

How one deployment serves many tenants, and how a plan becomes a quota. Paths are relative to
the repository root.

## 1. The two planes

| Plane | Who | Prefix | Token |
| --- | --- | --- | --- |
| Operator | Platform staff | `/api/v1/operator` | `{ id, role, type: "operator" }` |
| Tenant | A workspace's staff | `/api/v1` | `{ id, tenantId, role, type: "tenant" }` |

Each verifier refuses the other token type, so a tenant token never opens the operator plane
even though both are signed with `JWT_SECRET`. Recipients are a third, unauthenticated kind of
caller that reaches only the signed public links ([tracking.md](tracking.md)).

## 2. Shared schema

One database, one schema. Every tenant-scoped table carries `tenant_id` with
`ON DELETE CASCADE` ([data-model.md](data-model.md)), and every query filters on it
([ADR 0003](adr/0003-tenant-scoped-everything.md)). A record of another tenant is answered
exactly like a missing one: 404, never 403, because the lookup includes `tenant_id`.
[`tests/api/tenancy.test.ts`](../../apps/api/tests/api/tenancy.test.ts) calls every tenant
route with another tenant's ids and checks lists and exports for leaks.

Two things are deliberately global:

- **Sending domains** are unique across all tenants (case-insensitive). SES identities are
  unique per AWS account, so two tenants cannot both add `mail.example.com`.
- **Subscribe form slugs** are unique across all tenants because the public URL is `/f/:slug`.

## 3. How a request gets its tenant

`authenticateUser` ([`middlewares/auth.middleware.ts`](../../apps/api/src/middlewares/auth.middleware.ts))
verifies the JWT, then loads the user joined to its tenant with both `users.id` and
`users.tenant_id` from the token. A missing row is 401, a user that is not `ACTIVE` is 401, a
tenant that is not `ACTIVE` (suspended or closed) is 403. The tenant id then comes from
`ctx(req)`; no route reads it from the body, the query or the URL.

Public routes derive the tenant from the signed token (the message, contact or form it names),
never from the request.

## 4. Onboarding a tenant

`POST /api/v1/operator/tenants` ([`services/operator/tenants.service.ts`](../../apps/api/src/services/operator/tenants.service.ts)),
SUPERADMIN only. In one transaction: create the tenant, snapshot the plan into entitlement
rows, create the first ADMIN user, and add the eight starter templates. After the commit a
welcome email with a generated password goes out (fire and forget; the response carries
`emailDispatched`). The first admin should change that password at once.

## 5. Plans and the snapshot

A plan is a sales artifact: a key, the **modules** it unlocks and four **limits**
([ADR 0004](adr/0004-entitlements-first-plans-as-quotas.md)).

| Limit | Wire name | Entitlement code | Enforced |
| --- | --- | --- | --- |
| Emails per UTC month | `monthlyEmails` | `limit.monthly_emails` | Campaign preflight, the campaign start, and every send ([sending-pipeline.md](sending-pipeline.md#quota)) |
| Contacts | `maxContacts` | `limit.max_contacts` | Contact create, subscribe forms, CSV import |
| Sending domains | `maxDomains` | `limit.max_domains` | Domain create |
| Users | `maxUsers` | `limit.max_users` | User create |

A missing or null limit is unlimited. Modules are the keys `audience`, `templates`,
`campaigns`, `analytics`, `email` and `audit`; each becomes a `module.<key>` entitlement.
Seeded plans ([`scripts/seed.ts`](../../apps/api/scripts/seed.ts)):

| Plan | Modules | Emails per month | Contacts | Domains | Users |
| --- | --- | --- | --- | --- | --- |
| Starter | audience, templates, campaigns, analytics, email | 5,000 | 2,000 | 1 | 3 |
| Growth | all | 50,000 | 25,000 | 5 | 15 |
| Scale | all | 500,000 | 500,000 | 25 | 100 |

The snapshot ([`plan-snapshot.ts`](../../apps/api/src/services/operator/plan-snapshot.ts)) writes
one boolean row per module and one row per limit into `tenant_entitlements`. **Editing a plan
never touches existing tenants**: their rows are independent after onboarding. Changing a
tenant's plan (`PUT /operator/tenants/:id` with `plan_key`) deletes its `PLAN` rows and
re-snapshots the new plan; `ADMIN` rows survive.

### Sources: PLAN and ADMIN

| Source | Written by | Survives a plan change |
| --- | --- | --- |
| `PLAN` | Onboarding or a plan change | No, replaced |
| `ADMIN` | `PUT /operator/tenants/:id/entitlements` (an override of one code: `enabled`, `limit_value`) | Yes, and it wins on conflict |

Overrides are audited (`tenant.entitlement_overridden`). There is no expiry; remove an
override by setting it back.

## 6. Where entitlements are read

[`services/entitlements.service.ts`](../../apps/api/src/services/entitlements.service.ts) is the
only reader. The runtime never reads `plans`.

- `ensureModuleEnabled(tenantId, key)`: 403 `The <key> module is not included in this
  workspace's plan`, used by `requireModule` on every module route.
- `getLimit(tenantId, code)`: `null` when the code is not granted at all, `Infinity` when
  granted without a cap.
- `ensureCapacity(...)`: 403 `Workspace <label> limit reached (<n>). Upgrade the plan to add
  more.` A code that is not granted at all does not block (it is treated as no limit).

Entitlements are cached 60 seconds per process and invalidated on the writes above, so a plan
change is visible within a minute on other API processes.

## 7. Usage

Only one counter exists: `tenant_usage_monthly.emails_sent` per tenant and UTC month. Reserving
quota is a single conditional `UPDATE ... WHERE emails_sent + n <= limit`, so concurrent workers
cannot overshoot. A send gives the unit back if SES refuses it. Test sends and sender test
messages do not count. Contacts, domains and users are counted live from their tables.
`GET /api/v1/dashboard` and `GET /api/v1/operator/tenants/:id/email` show used against limit and
when the month resets.

## 8. What the client sees

`GET /auth/me` returns `modules`: for an ADMIN every entitled feature module plus the three
governance capabilities; for other roles the entitled modules their role grants plus any
governance capability it grants. The tenant app builds navigation and route guards from that
list. `GET /tenant/me` returns the tenant, usage, the entitled modules and the limits.

## 9. Suspension

An operator sets `status` to `SUSPENDED` or `CLOSED` with `PUT /operator/tenants/:id`. From the
next request every tenant user gets 403 `This workspace is suspended`, and the public form of
that tenant stops accepting submissions. Suspending (or closing) also stops sending: the operator action pauses the tenant's `SENDING` and `SCHEDULED` campaigns with `pausedReason` "Workspace suspended", the sender pauses a campaign whose tenant is not `ACTIVE`, and the scheduler never starts one. Reactivating does not resume anything; a tenant user resumes each paused campaign by hand (a campaign paused before it started begins from a fresh audience snapshot).
