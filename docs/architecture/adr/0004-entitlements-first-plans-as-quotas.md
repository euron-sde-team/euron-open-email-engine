# ADR 0004: Entitlements first, plans as quotas

## Status

Accepted.

## Context

Operators sell tiers: how many emails a month, how many contacts, domains and users, and which
modules. Those tiers change over time, and a plan edit must not silently change what existing
customers have.

## Decision

A **plan** is a sales artifact: a key, a list of modules and four limits (`monthlyEmails`,
`maxContacts`, `maxDomains`, `maxUsers`; null is unlimited). When a tenant is onboarded or moved
to another plan, the plan is **snapshotted** into `tenant_entitlements` rows (`module.<key>`
booleans and `limit.<name>` values). The runtime reads **only** entitlements
([`entitlements.service.ts`](../../../apps/api/src/services/entitlements.service.ts)), never
`plans`. Operator overrides are `ADMIN`-sourced rows that survive plan changes. The monthly email
quota is the one metered counter, reserved atomically per send
([`usage.service.ts`](../../../apps/api/src/services/usage.service.ts)).

## Consequences

Positive:

- Editing a plan never changes an existing tenant; a tenant changes only when an operator moves
  it or overrides a code.
- One place decides what a tenant may do, and it is cheap to cache (60 seconds).
- The quota check is a single conditional `UPDATE`, safe across workers.

Trade-offs:

- Rolling a plan edit out to existing tenants means moving each tenant or overriding it.
- A code that is not granted at all does not block capacity checks (it means "no limit
  configured"), so every plan must write all four limits.
- There is no billing: the operator charges tenants outside the product.

## Alternatives considered

- **Reading the plan at runtime.** Simpler, but every plan edit changes every tenant at once.
- **Per-user usage windows or several meters.** Not needed for email; one monthly counter is the
  whole model.
