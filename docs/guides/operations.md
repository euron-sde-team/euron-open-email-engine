# Operations

Running a deployment day to day: the dead-letter queue, quotas, reputation and unpausing,
backups and scaling workers. Paths are relative to the repository root.

## The operator console

| Page | Use it to |
| --- | --- |
| Dashboard | See platform totals, tenants that need attention, plan distribution |
| Tenants | Create, suspend and reactivate; open one for usage, domains, reputation, plan and entitlement overrides |
| Plans | Edit limits and modules (affects only tenants moved to the plan afterwards) |
| Fleet | See tenants by sending status and a table sortable by bounce and complaint rate |
| Account health | Read SES: mode, sandbox, 24-hour quota, send rate, account-wide rates |
| Dead-letter queue | See events the API could not process |
| Operators, Audit | Operator accounts; every operator action |

## First operator

Local: `make demo` creates `operator@example.com`. On AWS: `make aws-operator ENV=<env>
EMAIL=you@example.com` prints a one-time password in the task log. Elsewhere:

```bash
pnpm --filter @open-email/api exec tsx scripts/bootstrap-operator.ts --email you@example.com
```

(or set `EMAIL_OPERATOR_EMAIL`). Create more operators in the console (SUPERADMIN only).

## After a deploy

See [deploy-aws.md](deploy-aws.md#6-after-a-deploy). Also after any change of region, domain or
secrets.

## Database

- Migrations run before the API starts (`migrate` service in Compose, a one-off task on AWS).
  `node db/migrate.js --status` lists applied and pending files. An applied file is
  checksummed: never edit it ([ADR 0010](../architecture/adr/0010-sql-migrations-prisma-types-only.md)).
- **Backups.** The Terraform database module enables automated RDS backups and, in production,
  Multi-AZ; take a manual snapshot before a risky migration. The database holds everything that
  matters: tenants, contacts, campaigns, events. Test a restore.
- **Growth.** `email_events` and `email_messages` grow with every message; there is no archive or
  pruning job in 0.1. At tens of millions of messages plan partitioning by month or an archive
  job before they dominate storage. The indexes on `(tenant_id, type, occurred_at)` and
  `(campaign_id, type, occurred_at)` serve the reports.
- **Connections.** Each API worker keeps up to `PG_POOL_MAX` connections. Keep tasks times
  workers times that below the database's connection limit (an alarm watches 80 percent).

## Quotas

Three kinds, all visible to the operator:

| Quota | Where set | Where seen | What happens at the limit |
| --- | --- | --- | --- |
| Emails per month | Plan (`monthlyEmails`), or an `ADMIN` override of `limit.monthly_emails` | Tenant dashboard, console tenant page | Preflight and start refuse; mid-campaign the rest are skipped `OVER_QUOTA`. Resets 00:00 UTC on the first of the month |
| Contacts, domains, users | Plan | Same | The create call answers 403 with the limit; imports skip rows; forms accept silently without adding |
| SES account quota | AWS | Console, Account health | SES throttles or rejects; keep plans below the account's 24-hour quota |

To give a tenant more room now, override the entitlement on its page (reason recorded in the audit
log) or move it to another plan. A plan edit does not touch existing tenants.

## Reputation, pause and unpause

The model: [deliverability-and-reputation.md](../architecture/deliverability-and-reputation.md).

1. **Spot it.** An alarm, the Fleet page (tenants not `ACTIVE`), or a tenant's support request.
2. **Look.** The tenant page: reputation history (what crossed which threshold, with the rates),
   domains, usage. Check the tenant's campaigns: a bad import is the usual cause.
3. **Fix with the tenant.** Ask them to remove bounced and unengaged contacts and to use double
   opt-in. Hard bounces and complaints are suppressed automatically.
4. **Unpause** (SUPERADMIN): the tenant page, "Lift restriction", with a reason. The status goes
   to `ACTIVE`, the reason is in the operator audit log and the tenant's history. Their paused
   campaigns stay `PAUSED`; they resume them.
5. **`WARNING` and `THROTTLED` recover by themselves** one level at a time after 48 hours, once
   the rates are better.

Rates need `EMAIL_REPUTATION_MIN_SENDS` (100) sends in 14 days before any tier applies. To stop a
tenant's mail by hand, suspend the workspace: it stops sign-in and pauses its sending and scheduled campaigns with
the reason "Workspace suspended"
([multi-tenancy-and-entitlements.md](../architecture/multi-tenancy-and-entitlements.md#9-suspension)).

## The dead-letter queue

SES events arrive on an SQS queue. The consumer deletes a message only after applying it; a failure
leaves it to be redelivered, and after five receives SQS moves it to the dead-letter queue. A
DLQ alarm fires on any message.

1. Console, Dead-letter queue: depth, oldest age and a sample of up to 10 messages (bodies cut to
   500 characters). Peeking never deletes or redrives anything.
2. Read the sample. The usual causes: a database outage (every event failed), a message whose
   `messageId` tag does not exist in this database (a different environment sharing the SES
   account), or a malformed body.
3. Fix the cause. Redrive from the AWS console: SQS, the DLQ, **Start DLQ redrive** to the source
   queue. Events are idempotent (a unique index on message and type), so redriving twice is
   harmless.
4. Messages older than the queue retention (14 days) are gone. Delivery and bounce state for
   those messages stays as it was, so a lost bounce means a contact keeps a `SUBSCRIBED` status
   and the next bounce will suppress it.

Events for an unknown message or without the `tenantId` and `messageId` tags are logged and
dropped, not dead-lettered.

## Scaling

| Concern | How |
| --- | --- |
| HTTP | More API tasks. Every task serves HTTP; each runs one worker per CPU |
| Background work | Exactly one worker per task owns the jobs (`RUN_JOBS`). BullMQ job schedulers and the `mail-work` queue are coordinated in Redis, so several tasks are safe: a campaign has one job id, recipients are claimed with `FOR UPDATE SKIP LOCKED`, and sends are idempotent per campaign and contact |
| Send rate | Limited by `EMAIL_DEFAULT_TENANT_TPS` and `EMAIL_ACCOUNT_TPS` in Redis. Raise the account value only to SES's maximum send rate. A campaign of 50,000 at 5 per second takes about 3 hours; an operator can raise one tenant's TPS by setting `tenants.config.emailTps` on its row (tenants cannot), capped at the account rate |
| The events consumer | One long-poll loop per jobs worker. More tasks mean more consumers on the same queue, which is safe |
| Redis | Required in production. Without it there is no send rate limit and the recurring jobs run per process |
| Database | Scale vertically first; read replicas are not used |

The campaign job runs 25 seconds and re-enqueues itself, so a slow send never holds a queue slot
for long. If a task dies mid-batch the recipients' claims expire after 5 minutes and another worker
takes them.

## Logs and metrics

Winston logs JSON-ish lines to stdout (CloudWatch on AWS); `LOG_LEVEL` sets the level. Useful
lines: `reputation: tenant ... ACTIVE -> PAUSED`, `scheduled campaign ... could not start`,
`SES events consumer started`, `Redis connected`, `health sweep: domain ... FAILED`. Every error
response carries a `rayId` that is in the log next to the stack.

## Routine

- Weekly: Fleet and Account health; DLQ depth; the tenants in `WARNING`.
- Monthly: quota usage against plans; database size.
- On a schedule: rotate secrets rarely and on purpose. Rotating `JWT_SECRET` signs everyone out;
  rotating a link-signing secret breaks the unsubscribe, view and tracking links in mail already
  sent.
- Test a database restore.

## Limitations

- No built-in archive of old events or messages.
- No operator action to cancel a tenant's campaigns or to pause sending by hand; use the quota
  override.
- The DLQ view is read-only; redrive is done in AWS.
