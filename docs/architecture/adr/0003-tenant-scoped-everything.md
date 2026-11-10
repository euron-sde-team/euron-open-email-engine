# ADR 0003: Tenant-scoped everything, in one shared schema

## Status

Accepted.

## Context

Many tenants share one deployment. Isolation options are a database per tenant, a schema per
tenant, or one schema with a tenant column. The data (contacts, events) is large and the
operator needs fleet-wide views (reputation, usage).

## Decision

One database and one schema. Every tenant-scoped table has `tenant_id`, with `ON DELETE
CASCADE` to `tenants`, and every query filters on it. The tenant comes from the verified token
and the user row ([`auth.middleware.ts`](../../../apps/api/src/middlewares/auth.middleware.ts)),
never from the request. Public routes derive it from the signed token. A record that belongs to
another tenant is a **404**, not a 403, so ids cannot be probed.

Two things are global on purpose: sending domains (SES identities are unique per account) and
subscribe form slugs (the public URL has no tenant segment).

## Consequences

Positive:

- Fleet queries (the operator's reputation table) are single SQL statements.
- One migration path, one backup, one connection pool.
- Deleting a tenant cascades to everything it owns.

Trade-offs:

- Isolation is a coding discipline. A missed `tenant_id` is a data leak, so every endpoint has a
  cross-tenant test ([`tenancy.test.ts`](../../../apps/api/tests/api/tenancy.test.ts)).
- A noisy tenant shares the database with the rest. Plans bound contacts and emails; there is no
  per-tenant query budget.
- No row-level security in PostgreSQL; the application is the only enforcement point.

## Alternatives considered

- **Schema or database per tenant.** Stronger isolation, but migrations, pools and fleet views
  multiply with the tenant count.
- **PostgreSQL row-level security.** A good second layer, deferred: it needs a per-request
  setting on a pooled connection.
