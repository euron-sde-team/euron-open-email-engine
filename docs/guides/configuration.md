# Configuration

Every environment variable the API reads. They are all read in one file,
[`apps/api/src/config/index.ts`](../../apps/api/src/config/index.ts), except the few marked
otherwise. A template is [`apps/api/.env.example`](../../apps/api/.env.example). With Docker
Compose, `make env` generates the secrets into `deploy/compose/.env`
([quickstart-local.md](quickstart-local.md)); on AWS Terraform sets them
([deploy-aws.md](deploy-aws.md)).

Defaults shown are the code defaults. "Prod" says what production requires.

## Server

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` turns on the production guard and one worker per CPU |
| `PORT` | `5126` | HTTP port |
| `RUN_JOBS` | unset | Set by the cluster primary for exactly one worker; set `true` yourself when running a single process outside Docker so it runs the background work |
| `TRUST_PROXY` | `1` | Reverse proxies in front of the API (ALB 1, CloudFront plus ALB 2). Decides the client IP for rate limits and hashed IPs. Compose sets `0` |
| `CORS_ORIGINS` | `EMAIL_APP_URL` and `OPERATOR_APP_URL` | Comma-separated browser origins. `*` is dropped. Prod: must not be empty |
| `LOG_LEVEL` | `info` | Winston level (read by `utils/logger.ts`) |
| `RATE_LIMIT_ENABLED` | on | `false` disables every HTTP limiter (load tests only). Always off under tests |
| `TZ` | `UTC` | Forced to UTC at start; do not change |

## Public URLs

| Variable | Default | Meaning |
| --- | --- | --- |
| `EMAIL_APP_URL` | `http://localhost:3650` | Tenant app origin, for sign-in, invite and reset links. No trailing slash |
| `OPERATOR_APP_URL` | `http://localhost:3660` | Console origin, for operator reset links |
| `APP_PUBLIC_URL` | `http://localhost:5126` | The API's public origin: the base of every tracked link, unsubscribe link, form URL, confirmation link and signed local file link. Prod: must be an `https` public origin, not localhost |
| `BRAND_NAME` | `Open Email Engine` | Display name in platform emails |

## Secrets and authentication

| Variable | Default | Meaning |
| --- | --- | --- |
| `JWT_SECRET` | dev value | Signs tenant and operator tokens, reset links and local file links. Prod: 32+ characters, not the default |
| `JWT_EXPIRY` | `12h` | Token lifetime (jsonwebtoken format). Tokens are not revocable earlier |
| `EMAIL_UNSUBSCRIBE_SIGNING_SECRET` | `JWT_SECRET` | Signs unsubscribe, view-in-browser and confirmation links. Changing it breaks every link already sent. Prod: 32+ characters (or `JWT_SECRET`) |
| `EMAIL_TRACKING_SIGNING_SECRET` | `JWT_SECRET` | Signs the open pixel and click links and keys the IP hash. Same caveat |

## PostgreSQL

| Variable | Default | Meaning |
| --- | --- | --- |
| `PG_DATABASE_HOST` | `localhost` | |
| `PG_DATABASE_PORT` | `5432` | Compose publishes `5572` on the host |
| `PG_DATABASE_USER` | `postgres` | |
| `PG_DATABASE_PASSWORD` | `postgres` | |
| `PG_DATABASE` | `mail` | |
| `PG_POOL_MAX` | `8` in prod, `10` otherwise | Connections per worker. Database limit must cover tasks times workers times this |
| `PG_POOL_MIN` | `0` | |
| `PG_CONNECTION_TIMEOUT` | `15000` | ms |
| `PG_IDLE_TIMEOUT` | `10000` | ms |

The migration runner (`pnpm db:migrate`, `node db/migrate.js`) reads, outside `config/index.ts`:
`DATABASE_URL` (wins when set), else the `PG_DATABASE_*` variables, plus `PG_SSL=true` to verify
TLS and `MIGRATIONS_DIR`. The API itself does not read `DATABASE_URL`.

## Redis

| Variable | Default | Meaning |
| --- | --- | --- |
| `REDIS_URL` | empty | Enables BullMQ (recurring jobs and the `mail-work` queue), shared rate limits, the send rate limiter and the resolver cache. Empty runs everything in process with **no send rate limit** and per-process HTTP limits. Not used under tests |

## Sending

| Variable | Default | Meaning |
| --- | --- | --- |
| `EMAIL_SES_MODE` | empty | `aws` or `simulated`. Empty: simulated when `AWS_SES_FROM_EMAIL` is unset, else `aws`. Always simulated under tests. Prod requires `aws` to be set explicitly (unset and `simulated` are both refused) |
| `EMAIL_DOMAIN_SIMULATE_VERIFY_MINUTES` | `2` | Simulated mode: a pending domain verifies itself after this many minutes without DNS. `0` means only on "Check now" |
| `EMAIL_TRACKING_HOST` | `track.mail-engine.example` | The value of every tenant's `track.<domain>` CNAME record (the platform host that serves `/t/*`). Terraform sets it |
| `EMAIL_TRACKING_CUSTOM_DOMAINS` | `false` | `true` serves links from a tenant's verified `track.<domain>` over https. Needs a certificate for each name ([ADR 0008](../architecture/adr/0008-platform-tracking-host-fallback.md)) |
| `EMAIL_DEFAULT_TENANT_TPS` | `5` | Base sends per second per tenant. Scaled by the reputation multiplier; an operator can override one tenant in `tenants.config.emailTps` (capped at `EMAIL_ACCOUNT_TPS`; tenants cannot write it) |
| `EMAIL_ACCOUNT_TPS` | `14` | Account-wide sends per second. Set it to your SES maximum send rate |
| `EMAIL_SEND_BATCH` | `50` | Recipients one claim takes while a campaign sends |

## Reputation

| Variable | Default | Meaning |
| --- | --- | --- |
| `EMAIL_REPUTATION_MIN_SENDS` | `100` | Sends in 14 days before any tier applies |
| `EMAIL_REPUTATION_BOUNCE_WARN` | `0.03` | Permanent bounce rate for `WARNING`. `THROTTLED` sits halfway to the pause value |
| `EMAIL_REPUTATION_BOUNCE_PAUSE` | `0.05` | Rate for `PAUSED` |
| `EMAIL_REPUTATION_COMPLAINT_WARN` | `0.0005` | Complaint rate for `WARNING` |
| `EMAIL_REPUTATION_COMPLAINT_PAUSE` | `0.001` | Complaint rate for `PAUSED` |

Keep the pause values below SES's own review points (5 percent bounces, 0.1 percent
complaints). See [deliverability-and-reputation.md](../architecture/deliverability-and-reputation.md).

## AWS

| Variable | Default | Meaning |
| --- | --- | --- |
| `AWS_REGION` | `us-east-1` | Region for S3 and the default for SES |
| `AWS_SES_REGION` | `AWS_REGION` | Region of SES, SNS and SQS. DNS record values use it |
| `AWS_SES_ACCESS_KEY`, `AWS_SES_SECRET_KEY` | empty | Static keys for the SES and SQS clients. Empty uses the default AWS chain (the ECS task role). Prefer the role |
| `AWS_SES_FROM_EMAIL` | empty | The **platform** sender for invites, password resets and the operator welcome mail. Its domain must be verified in SES. Empty: that mail is logged, not sent. Also switches the auto mode to `aws` |
| `AWS_SES_FROM_NAME` | `Open Email Engine` | Display name of platform mail |
| `AWS_S3_BUCKET` | empty | Bucket for uploaded files (CSV imports). Empty uses local disk |
| `AWS_S3_ACCESS_KEY`, `AWS_S3_SECRET_KEY` | empty | Static S3 keys; empty uses the default chain |
| `AWS_ENDPOINT_URL` | empty | Points every AWS client at an emulator (Floci). With it set, domain checks trust the SES status instead of looking up DNS |
| `SES_EVENTS_SNS_TOPIC_ARN` | empty | Topic the per-tenant configuration sets publish to. Empty: no event destination is created |
| `SES_EVENTS_QUEUE_URL` | empty | Queue the consumer long-polls. Empty: the consumer stays idle and no delivery events arrive |
| `SES_EVENTS_DLQ_URL` | empty | Dead-letter queue the console peeks at |

The Terraform email module creates the topic, queue and DLQ and passes all three
([`infra/terraform/modules/email`](../../infra/terraform/modules/email)).
[`apps/api/scripts/ses-infra-setup.ts`](../../apps/api/scripts/ses-infra-setup.ts) creates them
for a deployment that does not use the Terraform.

## Storage

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOCAL_STORAGE_DIR` | `<cwd>/.local-storage` | Where files go when `AWS_S3_BUCKET` is empty. Served through HMAC-signed, expiring links |

## Scripts and demo

| Variable | Used by | Meaning |
| --- | --- | --- |
| `EMAIL_DEMO_PASSWORD` (or `DEMO_PASSWORD`) | `pnpm demo:seed` | Password of every demo account. The seed refuses `NODE_ENV=production` |
| `EMAIL_OPERATOR_EMAIL`, `EMAIL_OPERATOR_NAME`, `EMAIL_OPERATOR_PASSWORD` | `bootstrap-operator.ts` | The first operator; the flags `--email` and `--name` win. Without a password one is generated and printed once |

## Compose and Terraform names

Compose uses `EMAIL_*` variable names for host ports (`EMAIL_WEB_PORT`, `EMAIL_CONSOLE_PORT`,
`EMAIL_API_PORT`, `EMAIL_PG_PORT`, `EMAIL_REDIS_PORT`, `EMAIL_FLOCI_PORT`, `EMAIL_MAILPIT_PORT`)
and for secrets (`EMAIL_JWT_SECRET` and the two signing
secrets); it maps them to the API names above. Terraform variables
(`email_ses_mode`, `email_default_tenant_tps`, `email_account_tps`, `reputation_thresholds`,
`tracking_host`, `mail_domain`) map to the same API variables
([`infra/terraform/envs/aws-prod/variables.tf`](../../infra/terraform/envs/aws-prod/variables.tf)).

## Production guard

`assertProductionConfig()` ([`config/index.ts`](../../apps/api/src/config/index.ts)) runs at
start when `NODE_ENV=production` and refuses to boot, listing every problem, when:

- `JWT_SECRET` is the development value or shorter than 32 characters;
- `CORS_ORIGINS` is empty;
- either link-signing secret (or `JWT_SECRET` when unset) is the development value or shorter
  than 32 characters;
- `EMAIL_SES_MODE` is not `aws` (unset and `simulated` are both refused);
- `APP_PUBLIC_URL` is not an `https` origin, or names localhost or 127.0.0.1.

It does **not** check that SES is actually configured, that the event queue is set, or that Redis
is present. Check those yourself ([operations.md](operations.md#after-a-deploy)).

## The apps

| Variable | App | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | web | `http://localhost:5126/api/v1` (baked in at build time) |
| `VITE_PROXY_TARGET` | web dev server and preview | `http://localhost:5126` (where `/t /u /w /f /c` are proxied) |
| `VITE_API_BASE_URL` | console | `http://localhost:5126/api/v1/operator` (baked in at build time) |
