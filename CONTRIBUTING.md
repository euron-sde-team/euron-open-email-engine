# Contributing

Thanks for helping improve Euron Open Email Engine. This guide covers the workflow, the bar a change
has to clear, and the conventions the codebase follows.

## Ground rules

- **Open an issue first** for anything larger than a bug fix or a docs tweak, so we can
  agree on the approach before you invest time.
- **One concern per pull request.** A refactor and a feature are two PRs.
- **Security issues go through private reporting**, never a public issue. See
  [SECURITY.md](SECURITY.md).
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Development setup

Requirements: Docker, Node 22+, pnpm 9 (`corepack enable`).

```bash
pnpm install
make up          # Postgres, Redis, the AWS emulator (provisioned by Terraform),
                 # then migrate, the API, the tenant app and the operator console
make demo        # two fictional tenants full of data, and an operator
make test        # unit tests across every package (no database)
```

The tenant app is at http://localhost:3650, the operator console at http://localhost:3660, the
API at http://localhost:5126 and Mailpit (every message the emulated SES sends) at
http://localhost:8126. No AWS account is needed: sending runs through the Floci emulator or the
built-in simulator. [docs/guides/quickstart-local.md](docs/guides/quickstart-local.md) lists every
port, and [docs/guides/connect-ses.md](docs/guides/connect-ses.md) explains how to connect real
SES.

## Before you open a pull request

Each of these must pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
make test-integration            # the API over HTTP against a migrated, seeded Postgres
make tf-validate tf-lint tf-security   # when you touched infra/terraform
make sanitize                    # no credentials, account ids, real emails or IPs
```

[docs/guides/testing.md](docs/guides/testing.md) explains each test layer.

## Conventions

**Layers (api).** Routes declare endpoints and guards, controllers read the request and
write the response, services hold the business rules, repositories hold the Kysely
queries. Services and repositories are singletons; repositories accept an optional
transaction. Recurring work is one entry in `apps/api/src/jobs/registry.ts`
([LLD.md](docs/architecture/LLD.md)).

**Every tenant query carries `tenant_id`.** A record from another workspace is a 404, never
a 403. A new endpoint that returns workspace data gets an integration test proving the
other seeded workspace cannot read it.

**Entitlements first.** A module route is mounted once in `apps/api/src/routes/index.ts`
behind the entitlement gate and then RBAC. Runtime code reads `tenant_entitlements`, never a plan
([multi-tenancy-and-entitlements.md](docs/architecture/multi-tenancy-and-entitlements.md)).

**All tenant mail goes through the mailer.** Anything that sends on behalf of a tenant calls
`mailerService.sendTenant`, which applies the reputation gate, suppression, the send rate, the
quota and the idempotency key before SES. Never call the SES client directly for tenant mail
([sending-pipeline.md](docs/architecture/sending-pipeline.md)).

**Public links stay safe.** Tokens are signed and carry ids only; a click destination is read from
the database, never from the token or the request; unsubscribe changes state by POST only
([tracking.md](docs/architecture/tracking.md)).

**Simulated mode stays honest.** The SES client has a simulated mode so the app and the test suite
run without an account. Simulated messages are marked, opens and clicks are never simulated, and
tests must never send real mail or use real addresses (`example.com` and `.example` only).

**Configuration lives in one file.** Every environment variable is read in
`apps/api/src/config/index.ts` and nowhere else, documented in
[docs/guides/configuration.md](docs/guides/configuration.md) in the same PR, and
security-relevant ones are enforced at boot by `assertProductionConfig`.

**Database changes are new migrations.** Change `apps/api/prisma/schema.prisma`, run
`pnpm --filter @open-email/api gen:types` to regenerate the Kysely types, and add
`db/migrations/NNNN_description.sql` with the matching SQL. Prisma never touches a database. Never
edit an applied migration: the runner refuses to start when a checksum changes.

**Comments explain why.** The code says what it does. Comments are for the constraint, the
incident, or the trade-off that made it this way.

**Style.** Prettier and ESLint settle formatting. TypeScript strict mode everywhere.

## Commit messages

Imperative mood with an optional scope: `campaigns: refuse to resume while the tenant is paused`,
`web: keep the audience filter when a segment is edited`. Explain the *why* in the body when it is
not obvious.

## Architecture decisions

A change that alters a documented decision (multi-tenancy, entitlements, SQL migrations,
SES configuration sets, tracking, the reputation gate, simulated providers, unsubscribe)
needs a new or updated ADR in [docs/architecture/adr/](docs/architecture/adr/README.md)
explaining the trade-off, linked from the pull request.
