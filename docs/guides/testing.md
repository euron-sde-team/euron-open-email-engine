# Testing

The layers, how to run each, and what they cover. Paths are relative to the repository root.

| Layer | Command | Needs | Covers |
| --- | --- | --- | --- |
| Unit | `pnpm test` (`make test`) | Nothing | Pure logic in `apps/api/tests/unit`, `apps/web/src/lib/*.test.ts`, `apps/console/src/lib/*.test.ts` |
| Integration (API) | `make test-integration` | Postgres | The Express app in-process with supertest against a migrated, seeded database: `apps/api/tests/api`, `apps/api/tests/operator` |
| Browser (e2e) | `make e2e` | Docker (the full stack) | Playwright against the Floci stack: `e2e/tests` |
| Types and lint | `pnpm typecheck`, `pnpm lint` | Nothing | Strict TypeScript across packages; the API contract check ([`apps/api/contract`](../../apps/api/contract)) compiles the DTOs against `@open-email/types` |
| Sanitization | `make sanitize` | Nothing | [`scripts/check-sanitization.sh`](../../scripts/check-sanitization.sh): no credentials, account ids, internal names, real email addresses or public IPs in anything committable |
| Terraform | `make tf-validate tf-lint tf-security` | Docker or terraform | `fmt`, `validate` per environment, tflint, checkov |

## Unit tests

No database, no network. They cover the renderer (merge tags, defaults, escaping, link rewriting,
the pixel and footer), the segment SQL builder (compiled, never run), signed tokens, the Apple
Mail Privacy Protection classifier, quota arithmetic, the throttle multipliers and reputation
tiers, CSV parsing and formula safety, DNS record computation and checking with an injected
resolver, the production guard and CORS, and the web app's pure helpers (segments, merge tags,
import mapping, DNS grouping, schedule and timezone, report maths).

## Integration tests

```bash
make test-integration     # recreates mail_test, migrates, seeds, runs everything
```

The target runs [`scripts/test-db.sh`](../../scripts/test-db.sh) to drop and create `mail_test`
next to the compose database (host port 5572), then `pnpm db:migrate`, `pnpm demo:seed` and the
suites. Or by hand against any throwaway database:

```bash
PG_DATABASE_HOST=127.0.0.1 PG_DATABASE_PORT=5572 PG_DATABASE_USER=mail PG_DATABASE_PASSWORD=mail \
  PG_DATABASE=mail_test DATABASE_URL= REDIS_URL= pnpm --filter @open-email/api test:integration
```

Rules the suites follow:

- **Fresh tenant per suite.** Most suites onboard a new tenant through the operator API
  (`newTenant()` in [`helpers.ts`](../../apps/api/tests/helpers.ts)), so suites never share state.
  Shared-database tests must establish the state they need.
- **No Redis, no network.** Under test the work queue runs in process and is awaited, rate limits
  are off, and mail is simulated (the simulator always wins under test, even with keys set).
- **Tenant isolation is tested everywhere.** [`tenancy.test.ts`](../../apps/api/tests/api/tenancy.test.ts)
  calls every tenant route with another tenant's ids and expects 404, and checks lists and the
  CSV export for leaks. A new endpoint that returns tenant data gets a case there.

| File | Covers |
| --- | --- |
| `api/tenancy.test.ts` | Cross-tenant 404 on every route; lists and exports never leak |
| `api/campaign-send.test.ts` | Audience snapshot, suppression skip, quota refusal, simulated bounce and complaint, PAUSED freezing a SENDING campaign, scheduler start, idempotency |
| `api/tracking.test.ts` | Pixel, MPP flag, redirect allowlist, one-click unsubscribe, view in browser |
| `api/forms.test.ts` | Hosted forms, double opt-in, honeypot, enumeration safety |
| `api/imports.test.ts` | Upload, mapping, chunks, errors, never reviving unsubscribed or bounced contacts |
| `api/domains.test.ts` | The wizard in simulated mode, an injected DNS resolver, plan limits |
| `api/audience.test.ts` | Contacts, bulk actions, CSV export, lists, segments evaluated by the database, templates |
| `api/rbac.test.ts` | Roles, modules, settings, audit, passwords |
| `api/reporting.test.ts` | Dashboard, campaign report, message log, reputation on the demo data |
| `operator/*.test.ts` | Plans, tenants, entitlements, fleet, account health, DLQ, audited unpause |

To trip a reputation tier with few messages, the test setup sets
`EMAIL_REPUTATION_MIN_SENDS=20` ([`setup-env.ts`](../../apps/api/tests/setup-env.ts)); the simulator turns `bounce@...` addresses
into hard bounces.

## Browser tests

```bash
make e2e          # make up + make demo, then Playwright
```

[`e2e/tests`](../../e2e/tests): the tenant app (sign in, the email-engine navigation, role gating),
the console, the domain wizard, audience and campaign flows, and an accessibility pass with axe in light and dark themes
across the main pages. Fixtures are the demo accounts.

## CI

[`.github/workflows/checks.yml`](../../.github/workflows/checks.yml) runs on every push: lint,
typecheck, unit tests, build and the sanitization scan; the integration tests on Postgres 16 and
Redis 7; and `terraform fmt` and `validate`. The complete opt-in pipeline (CodeQL, gitleaks,
`pnpm audit`, checkov, multi-arch images, the e2e run) is in
[`.github/workflows-full`](../../.github/workflows-full/README.md).

## Writing tests

- A new route: an integration case with a fresh tenant, and a cross-tenant case in
  `tenancy.test.ts`.
- New pure logic: a unit test beside the others; keep it free of I/O.
- Never send real mail from a test; the simulator already guarantees it. Never put real addresses
  in fixtures: `example.com` and `.example` only.
- A UI change that adds a page: a browser case and the axe pass.

## Limitations

- The integration tests need a real PostgreSQL; there is no in-memory mode.
- Nothing tests against real SES. Floci covers the API shape, not sandbox rules, quotas, real
  bounces or reputation ([simulated-providers.md](../architecture/simulated-providers.md)).
- Load testing is manual (`RATE_LIMIT_ENABLED=false`).
