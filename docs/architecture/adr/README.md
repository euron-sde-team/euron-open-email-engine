# Architecture decision records

Short records of the decisions that shape Euron Open Email Engine: the context, what was decided,
and what it costs. The system as built is described in [HLD.md](../HLD.md) and [LLD.md](../LLD.md).

| ADR | Decision |
| --- | --- |
| [0001](0001-one-engine-on-ses.md) | One engine on Amazon SES, with a configuration set per tenant and events attributed by message tags |
| [0002](0002-own-tracking.md) | Open and click tracking with the engine's own pixel and redirect; opens are flagged, not trusted |
| [0003](0003-tenant-scoped-everything.md) | Many tenants in one schema, isolated by `tenant_id`; another tenant's id is a 404 |
| [0004](0004-entitlements-first-plans-as-quotas.md) | Plans are snapshotted into per-tenant entitlements; the runtime reads only entitlements; the monthly email quota is the one meter |
| [0005](0005-reputation-gate-before-cost.md) | A per-tenant reputation gate runs first in the mailer, before any cost is incurred |
| [0006](0006-simulated-providers.md) | A simulated provider mode plus Floci, so the product runs and is tested with no AWS account |
| [0007](0007-unsubscribe-by-post-only.md) | Unsubscribe changes state by POST only, so link scanners cannot unsubscribe anyone |
| [0008](0008-platform-tracking-host-fallback.md) | Links use the platform host unless a tenant tracking host is explicitly enabled |
| [0009](0009-no-developer-api-in-0-1.md) | No developer API, SMTP relay or webhooks in 0.1; campaigns only |
| [0010](0010-sql-migrations-prisma-types-only.md) | Plain SQL migrations with a small runner; Prisma only generates Kysely types |

A change that alters a documented decision needs a new or updated ADR linked from the pull
request ([CONTRIBUTING.md](../../../CONTRIBUTING.md)).
