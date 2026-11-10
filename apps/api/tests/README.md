# Tests

| Layer | Command | Needs |
| --- | --- | --- |
| `tests/unit` | `pnpm test` | nothing |
| `tests/api`, `tests/operator` | `pnpm test:integration` | a migrated and seeded Postgres |

Unit tests cover the pure helpers: the renderer, the segment SQL builder (compiled, never run),
token signing, Apple MPP classification, quota arithmetic, CSV parsing, import mapping and DNS
record checking with an injected resolver.

Integration tests drive the Express app in-process with supertest against a real database.
They sign in as the seeded demo users or, mostly, onboard a **fresh tenant per suite** through
the operator API (`newTenant()` in [`helpers.ts`](helpers.ts)), so suites never share state.
Redis is disabled under tests: the work queue runs in-process and awaited, and no mail is sent
(simulated provider mode).

```bash
make test-integration     # recreates mail_test, migrates, seeds, runs everything
# or by hand:
PG_DATABASE_HOST=127.0.0.1 PG_DATABASE_PORT=5572 PG_DATABASE_USER=mail PG_DATABASE_PASSWORD=mail \
  PG_DATABASE=mail_test DATABASE_URL= REDIS_URL= pnpm --filter @open-email/api test:integration
```

| File | Covers |
| --- | --- |
| `api/tenancy.test.ts` | Every tenant route called with another tenant's ids: 404; lists and exports never leak |
| `api/campaign-send.test.ts` | Audience snapshot, suppression skip, quota refusal, bounce and complaint simulation, PAUSED freezing a SENDING campaign, scheduler start, idempotency |
| `api/tracking.test.ts` | Pixel, MPP flag, redirect allowlist, unsubscribe one-click, view in browser |
| `api/forms.test.ts` | Hosted forms, double opt-in, honeypot, enumeration safety |
| `api/imports.test.ts` | Upload, mapping, chunks, errors, never reviving unsubscribed or bounced contacts |
| `api/domains.test.ts` | The domain wizard in simulated mode, injected DNS resolver, plan limits |
| `api/audience.test.ts` | Contacts, bulk actions, CSV export, lists, segments evaluated by the database, templates |
| `api/rbac.test.ts` | Roles, modules, settings, audit, passwords |
| `api/reporting.test.ts` | Dashboard, campaign report, message log, reputation on the demo data |
| `operator/*.test.ts` | Plans, tenants, entitlements, fleet, account health, DLQ, audited unpause |
| `unit/hardening.test.ts` | Production config guard, CORS, signed local file links |
