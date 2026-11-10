# ADR 0010: Plain SQL migrations; Prisma only generates types

## Status

Accepted.

## Context

The schema uses features ORMs express poorly: partial unique indexes (suppressions, the
once-per-message event index, idempotency keys), a GIN index on tags, `ON CONFLICT` with a
predicate, and PostgreSQL enums.

## Decision

The schema of record is SQL under [`db/migrations`](../../../db/migrations): one initial file,
[`0001_init.sql`](../../../db/migrations/0001_init.sql). A small forward-only runner
([`db/migrate.ts`](../../../db/migrate.ts)) applies pending files in order, each in its own
transaction, under a PostgreSQL advisory lock so concurrent deploys are safe, and records a
SHA-256 checksum. An applied file must never be edited; the runner refuses to start when a
checksum changes. Runtime queries use Kysely.
[`prisma/schema.prisma`](../../../apps/api/prisma/schema.prisma) describes the same tables only so
`prisma generate` can produce the Kysely types (`pnpm --filter @open-email/api gen:types`);
Prisma never connects to a database. Queries are written in SQL where that is the feature (the
audience snapshot, reports).

## Consequences

Positive:

- The SQL is exactly what runs; partial indexes and conflict targets are explicit.
- A deploy is "apply the pending files", the same in Compose, ECS and CI.

Trade-offs:

- Two descriptions of the schema (SQL and Prisma) must be kept in step by hand.
- No down migrations: roll forward with a new file.
- Because 0.1 is unreleased, `0001_init.sql` was edited freely; after any deployment applies it,
  changes need a `0002_*.sql`.

## Alternatives considered

- **Prisma Migrate.** Cannot express the partial indexes; owning the database from the ORM.
- **A heavier migration tool.** More machinery than one forward-only runner needs.
