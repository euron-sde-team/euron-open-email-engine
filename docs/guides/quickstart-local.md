# Quickstart: run it locally

Start Euron Open Email Engine on your machine, seed two demo workspaces and an operator, and
send a campaign. No AWS account, no provider key and no payment account are needed. Paths are
relative to the repository root.

What runs ([`deploy/compose`](../../deploy/compose)): Postgres 16, Redis 7, the Floci AWS
emulator (S3, SES, SQS, SNS, KMS) provisioned by the production Terraform modules, Mailpit
(catches every email the emulated SES sends), then a one-shot `migrate`, the `api`, and the two
single-page apps: `web` (the tenant app) and `console` (the operator console).

## Prerequisites

- Docker with Compose v2 (Docker Desktop, OrbStack, Colima or plain Docker Engine).
- `make`, `bash` and `openssl`.
- For the tests and for running the apps outside Docker: Node 22 ([`.nvmrc`](../../.nvmrc)) and
  pnpm 9 (`corepack enable`), then `pnpm install`.

`make up` itself only needs Docker: the images install their own dependencies.

## Start the stack

```bash
make up
```

`make up` runs `make env` first, which writes `deploy/compose/.env` with random, local-only
values (`EMAIL_JWT_SECRET`, the two link-signing secrets and
`EMAIL_DEMO_PASSWORD`). It never overwrites a value and never prints one.

Then it builds the images, starts Floci and Mailpit, applies
[`infra/terraform/envs/local-floci`](../../infra/terraform/envs/local-floci) against the emulator,
runs the migration, starts the API and both apps and waits until everything is healthy. The first
build takes a few minutes. It prints:

```text
  app      http://localhost:3650
  console  http://localhost:3660  (operator console)
  api      http://localhost:5126/api/health
  mail     http://localhost:8126  (everything SES sends)
  aws      http://localhost:4677  (Floci: S3, SES, SQS, SNS, KMS)
```

`curl -s localhost:5126/api/health` answers `{"ok":true,"service":"open-email-api",...}`.

## Ports

Every host port binds to `127.0.0.1` and can be changed in `deploy/compose/.env` or your shell:

| Service | Host port | Variable |
| --- | --- | --- |
| Tenant app (`apps/web`) | 3650 | `EMAIL_WEB_PORT` |
| Operator console (`apps/console`) | 3660 | `EMAIL_CONSOLE_PORT` |
| API | 5126 | `EMAIL_API_PORT` |
| Postgres (user, password and database `mail`) | 5572 | `EMAIL_PG_PORT` |
| Redis | 6509 | `EMAIL_REDIS_PORT` |
| Floci | 4677 | `EMAIL_FLOCI_PORT` |
| Mailpit web UI | 8126 | `EMAIL_MAILPIT_PORT` |

The apps are static builds on nginx that call the API directly (`http://localhost:<api
port>/api/v1`, the console at `/api/v1/operator`). That URL is compiled in at image build time,
so after changing a port run `make up` again to rebuild.

## Seed the demo

```bash
make demo
```

This runs the seed inside the API container ([`apps/api/scripts/seed.ts`](../../apps/api/scripts/seed.ts))
with `EMAIL_DEMO_PASSWORD`. It creates three plans (Starter, Growth, Scale), an operator and two
fictional tenants. When the database already has tenants it does nothing; `make demo FORCE=1`
wipes and reseeds. It refuses to run with `NODE_ENV=production`.

| Account | Signs in to | Role |
| --- | --- | --- |
| `operator@example.com` | Console, http://localhost:3660 | SUPERADMIN operator |
| `maya@northwind.example` | Tenant app, http://localhost:3650 | ADMIN of Northwind Mail (Growth plan) |
| `theo@northwind.example` | Tenant app | MARKETER at Northwind Mail |
| `priya@northwind.example` | Tenant app | ANALYST at Northwind Mail |
| `sam@acme-robotics.example` | Tenant app | ADMIN of Acme Robotics (Starter plan) |

Every account uses the same password:

```bash
grep '^EMAIL_DEMO_PASSWORD=' deploy/compose/.env
```

**Northwind Mail** has a verified domain (`mail.northwind.example`) with two senders, 600
contacts across four lists, three segments, custom fields, two subscribe forms, six sent
campaigns over about two months with believable opens, clicks, bounces and complaints, one
scheduled, one draft and one paused campaign, suppressions, and a reputation history with one
`WARNING` episode that recovered. **Acme Robotics** has a domain still `PENDING`, so the DNS
wizard has something to show. The historical opens and clicks are written directly into the
database; real tracking hits only come from real emails.

[walkthrough.md](walkthrough.md) tours the product with this data.

## Send your first campaign

1. Sign in as `maya@northwind.example`, open **Campaigns**, duplicate a sent campaign or create
   a new one, choose the `news@mail.northwind.example` sender and a small list.
2. In the review step, read the preflight and choose "Send now".
3. Open http://localhost:8126: every message the emulated SES accepted is there, rendered, with
   the tracked links, the open pixel and the `List-Unsubscribe` headers.
4. Click a link in Mailpit: the browser lands on the API at `/t/c/...`, which records the click
   and redirects. The campaign report shows it.

Open the pixel yourself to record an open: the open pixel URL is in the message source.

## What is simulated

Nothing leaves your machine. With the Floci overlay (`make up`) the API makes **real SES API
calls to the emulator**, which relays each message to Mailpit; delivery events travel the real
SNS to SQS path. Without Docker, or with `EMAIL_SES_MODE=simulated`, no SES call is made at all
and the engine reports the outcomes itself ([../architecture/simulated-providers.md](../architecture/simulated-providers.md)).

| Concern | Local behaviour |
| --- | --- |
| Domain verification | The emulator trusts the SES status, so "Check now" verifies without DNS |
| Bounces and complaints | Not produced by Floci. In simulated mode, recipients `bounce@...`, `soft@...` and `complaint@...` misbehave on purpose |
| Files | Local disk in the `files` volume, served through expiring signed links |
| Redis | A plain container (queues, rate limits, caches) |
| Platform mail (invites, resets) | Goes through the emulator to Mailpit |

## Run the apps outside Docker

For development. Start Postgres and Redis (for example the `postgres` and `redis` services of
the compose file), then:

```bash
cp apps/api/.env.example apps/api/.env      # set JWT_SECRET etc.; ports 5572 and 6509 match compose
pnpm install
pnpm db:migrate
pnpm demo:seed
RUN_JOBS=true pnpm --filter @open-email/api dev      # API plus the worker, :5126
pnpm --filter @open-email/web dev                    # :3650
pnpm --filter @open-email/console dev                # :3660
```

`RUN_JOBS=true` makes that process the worker: it sends campaigns, processes imports, starts
scheduled campaigns and verifies pending domains. Without Redis everything runs in process and
the send rate is not limited. With no AWS settings the engine runs fully simulated.

## Everyday commands

| Command | Does |
| --- | --- |
| `make logs SERVICE=api` | Tail a service |
| `make ps` | Stack status |
| `make down` | Stop and delete the volumes |
| `make test`, `make test-integration`, `make e2e` | [testing.md](testing.md) |
| `make sanitize` | Scan for credentials, account ids, real emails |

## Next

[walkthrough.md](walkthrough.md) for the product, [configuration.md](configuration.md) for
every setting, [connect-ses.md](connect-ses.md) to send through real SES.
