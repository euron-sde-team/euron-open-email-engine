# @open-email/api

The Euron Open Email Engine API: one Express 5 service that serves the tenant plane (`/api/v1`),
the operator plane (`/api/v1/operator`), the public pages and tracking links at the root
(`/t /u /w /f /c`), and runs the background worker. PostgreSQL through Kysely, Redis for the
queues and rate limits, Node cluster mode.

## Run it

From the repository root, with Postgres and Redis reachable on the settings in `apps/api/.env`
(copy [`.env.example`](.env.example)):

```bash
pnpm install
pnpm db:migrate                       # db/migrations/0001_init.sql
pnpm demo:seed                        # plans, operator, Northwind Mail and Acme Robotics
RUN_JOBS=true pnpm --filter @open-email/api dev    # API plus the worker, http://localhost:5126
```

`RUN_JOBS=true` makes this process the worker: it sends campaigns, processes imports, starts
scheduled campaigns every 30 seconds and verifies pending domains. Without it the process serves
HTTP only (production runs one worker among several API processes).

Health: `GET /up` and `GET /api/health`. With no AWS keys everything runs in **simulated mode**
(see below), so the whole product works offline.

## Simulated mode

`EMAIL_SES_MODE=simulated` (the default without SES keys, and always under tests):

- Adding a domain returns realistic DKIM, MAIL FROM, SPF, DMARC and tracking records without
  calling SES. "Check now" verifies it with no DNS; a pending domain also verifies itself after
  `EMAIL_DOMAIN_SIMULATE_VERIFY_MINUTES`.
- Sends are recorded in `email_messages` (`simulated = true`, id `sim_...`) and never leave the
  machine. The simulator then reports delivery through the same handler SES events use:
  `DELIVERY` by default, a hard bounce for `bounce@...`, a soft bounce for `soft@...`, a
  complaint for `complaint@...`. Opens and clicks come only from real hits on the tracking links.
- Platform mail (invites, password resets) is logged, not sent.

## Public routes (API root, not `/api/v1`)

| Route | Does |
| --- | --- |
| `GET /t/o/:token.gif` | Open pixel: 1x1 gif, `no-store`, records an open (Apple MPP and proxies flagged `machine`) |
| `GET /t/c/:token` | Click redirect: 302 to the URL stored for that link, `http(s)` only, otherwise 404 |
| `GET /u/:token`, `POST /u/:token` | Unsubscribe page; POST is also the RFC 8058 one-click endpoint |
| `GET /w/:token` | View in browser (locked-down CSP) |
| `GET /f/:slug`, `POST /f/:slug` | Hosted subscribe form (honeypot, rate limited, optional double opt-in) |
| `GET /c/:token` | Double opt-in confirmation |

Tokens are HMAC-SHA256 signed, compared in constant time, and carry only ids. Links use
`APP_PUBLIC_URL`; the ALB or CloudFront must route these paths to the API and not cache them.

## Scripts

| Script | Does |
| --- | --- |
| `pnpm dev` | `tsx watch src/index.ts` |
| `pnpm build`, `pnpm start` | Compile to `dist/`, run `dist/index.js` |
| `pnpm lint`, `pnpm typecheck` | ESLint; `tsc` over `src` and `scripts` and `contract/` (the DTOs against `@open-email/types`) |
| `pnpm test` | Unit tests, no database |
| `pnpm test:integration` | `tests/api` and `tests/operator` against a migrated and seeded Postgres ([tests/README.md](tests/README.md)) |
| `pnpm gen:types` | `prisma generate`: regenerate the Kysely types from `prisma/schema.prisma` |
| `pnpm demo:seed` | Seed ([`scripts/seed.ts`](scripts/seed.ts); `--force` wipes first) |

Prisma never touches a database: the schema of record is the SQL in
[`db/migrations`](../../db/migrations); `prisma/schema.prisma` only describes it for type generation.

## Layout

| Path | Contents |
| --- | --- |
| `src/index.ts`, `src/app.ts` | Cluster entry; middleware order and the three planes |
| `src/config/index.ts` | Every environment variable and the production guard |
| `src/routes` | `index.ts` is the tenant gating map; `public.route.ts` the public links; `operator/` the operator plane |
| `src/services` | Business logic: `campaigns`, `campaign-sender`, `mailer`, `email-events`, `tracking`, `contacts`, `segments`, `imports`, `forms`, `templates`, `dashboard`, `reputation`, `usage`, `email-domains`, `email-identities` |
| `src/utils` | Pure, unit-tested helpers: `render`, `segment-sql`, `tokens`, `csv`, `open-classify`, `email-dns`, `links` |
| `src/queue/work.ts` | BullMQ queue for imports and campaign sending (in-process without Redis) |
| `src/jobs` | Recurring sweeps (`registry.ts`) and the SES events consumer |
| `src/presenters` | Row to wire-shape mappers |
| `scripts` | `seed.ts`, `bootstrap-operator.ts`, `ses-infra-setup.ts` |
