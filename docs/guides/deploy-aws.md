# Deploy on AWS

One command builds the production shape on your AWS account with the Terraform in
[`infra/terraform`](../../infra/terraform): ECS Fargate for the API and worker, RDS PostgreSQL,
ElastiCache Redis, an S3 bucket, KMS and Secrets Manager, SES with its event pipeline, two single-page
apps on S3 and CloudFront, a WAF, and CloudWatch alarms. Paths are relative to the repository
root. After the deploy, finish with [connect-ses.md](connect-ses.md): production access, DNS and
warm-up.

## 1. What you need

- An AWS account and credentials that can create the resources (an administrator in a fresh
  account is simplest; scope it down for an ongoing pipeline).
- Tools on the machine that deploys: `terraform` 1.x, Docker with buildx, the AWS CLI,
  `python3`, `make`.
- Two host names, for example `mail.example.com` (the tenant app, with the API under `/api/*`)
  and `console.mail.example.com` (the operator console).
- Either a Route 53 hosted zone for them (Terraform creates the certificates and DNS), or two
  ACM certificates you bring (one regional, one in `us-east-1` for CloudFront) and DNS records you
  publish from the outputs.

## 2. Configure

```bash
cd infra/terraform/envs/aws-prod            # or aws-dev
cp terraform.tfvars.example terraform.tfvars
# edit: region, name_prefix, domain, console_domain, route53_zone_id ...
cp backend.tf.example backend.tf            # optional remote state
```

| Variable | Meaning |
| --- | --- |
| `name_prefix` | 3 to 24 lowercase letters, digits, hyphens; prefixes every resource |
| `domain`, `console_domain` | The two hosts |
| `route53_zone_id` | Automatic certificates and DNS. Otherwise set `certificate_arn` and `cdn_certificate_arn` |
| `mail_domain` | The platform sending domain (default: `domain`). System mail is sent as `no-reply@<mail_domain>` |
| `tracking_host` | Where tenants' `track.<domain>` CNAMEs point (default: `domain`) |
| `email_ses_mode` | `aws` (default). `simulated` is for demo deployments only |
| `email_default_tenant_tps`, `email_account_tps` | Send rates; set the account value to your SES maximum send rate |
| `reputation_thresholds` | `bounce_warn`, `bounce_pause`, `complaint_warn`, `complaint_pause` (fractions) |
| `alarm_email` | Who receives alarms |
| `cpu_architecture` | `X86_64` (default) or `ARM64`; images must match (`PLATFORM=linux/arm64`) |
| `db_instance_class`, `cache_node_type` | Sizes |

`aws-dev` is a cheaper full copy (single NAT, single-AZ database, one API task). `aws-prod` uses
three AZs, a Multi-AZ database, two Redis nodes, deletion protection and the WAF.

The secrets (`JWT_SECRET` and the two link-signing secrets) are
generated into Secrets Manager under `<name_prefix>/app`. Third-party provider keys do not
exist: SES is reached through the task role.

## 3. Deploy

```bash
make aws-deploy ENV=aws-prod           # tag = the git commit; TAG=... to pin
```

[`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh) does, in order:

1. Applies the image registry (and its KMS key).
2. Builds the API image and pushes it.
3. Applies the network, database and the migrate task definition.
4. Runs the migrations as a one-off ECS task and waits (it must exit 0).
5. Applies everything else: cache, mail, storage, edge, CloudFront, the API service.
6. Waits for the API service to be stable.
7. Builds both single-page apps for their hosts, uploads them (hashed assets cached for a
   year, `index.html` never cached) and invalidates CloudFront.

Re-running it deploys the next commit. `make aws-plan ENV=...` shows a plan without applying, and
`make aws-migrate ENV=...` runs migrations alone (`scripts/aws-run-task.sh <env> migrate
--status` lists applied and pending).

If you built with Graviton (`cpu_architecture = "ARM64"`), build for it:
`PLATFORM=linux/arm64 make aws-deploy`. A mismatch builds fine but the tasks die at start with
"exec format error".

## 4. First operator and plans

```bash
make aws-operator ENV=aws-prod EMAIL=you@example.com
```

This runs `bootstrap-operator` as a one-off task and prints a one-time password in the task log
stream; sign in to the console and change it. **The demo seed is for local stacks only**, so a new
production deployment starts with no plans: create plans in the console (Plans), then tenants
([walkthrough.md](walkthrough.md#1-the-operator-creates-a-plan-and-a-tenant)).

## 5. DNS and mail

| Record | From | Purpose |
| --- | --- | --- |
| The two app hosts to CloudFront | `terraform output cdn_dns_records` | Reach the apps (created for you with a Route 53 zone) |
| Certificate validation | `certificate_validation_records` | ACM (with a zone: automatic) |
| Platform DKIM and MAIL FROM | `mail_dns_records` | Verify `no-reply@<mail_domain>` |
| `track.<tenant domain>` CNAME | `tracking_cname_target` | Shown to tenants by the wizard |

SES starts in its **sandbox**. Request production access before tenants send to real recipients
([connect-ses.md](connect-ses.md#5-move-out-of-the-sandbox)). The platform identity, configuration
sets, the SNS topic, the SQS queue and its dead-letter queue are created by Terraform, and the API
task already has their names in its environment.

Tracking links use the platform host unless you opt in to tenant hosts
([ADR 0008](../architecture/adr/0008-platform-tracking-host-fallback.md)). CloudFront and the load
balancer route `/t/o/*`, `/t/c/*`, `/u/*`, `/f/*`, `/c/*` and `/w/*` on both hosts to the API,
uncached; the WAF rate rule exempts `/t/o/`, `/t/c/`, `/u/` and `/w/` because mailbox image
proxies and link scanners hit them in bursts.

## 6. After a deploy

A short checklist, because the production guard does not verify these
([configuration.md](configuration.md#production-guard)):

- `GET https://<domain>/api/health` answers `ok`.
- Console, Account health: `mode: aws`. (If it says `simulated`, `EMAIL_SES_MODE` is wrong.)
- API logs show `Email sending: SESv2 driver enabled`, `Redis connected` and `SES events consumer
  started`.
- Console, Dead-letter queue: `configured: true`, depth 0.
- Create a tenant, add a domain, publish DNS, send a test message to yourself.
- The alarm email address confirmed its SNS subscription.

## 7. Alarms

[`modules/observability`](../../infra/terraform/modules/observability/main.tf) alarms to an SNS
topic: load balancer 5xx and unhealthy targets, ECS CPU and memory, database CPU, free storage
and connections, failed background jobs (a log metric filter), SQS dead-letter queue depth above
zero (the events queue), and the SES account bounce rate (default 4 percent) and complaint rate
(default 0.08 percent), set below SES's own review points. Tune them with the module variables.

## 8. Running costs and sizing

The biggest fixed costs are the NAT gateways, the Multi-AZ database and the Redis nodes; SES is
charged per message. `aws-dev` is the right size to try it. The API and worker are one service:
scale horizontally by raising the task count (only one worker per task owns the background work,
and BullMQ coordinates across tasks), and mind the database connection limit
([operations.md](operations.md#scaling)).

## 9. Tear down

`terraform -chdir=infra/terraform/envs/<env> destroy`. Deletion protection on the production
database and the KMS key's deletion window protect against accidents; read the plan. SES
identities created by the API for tenant domains are not Terraform resources: delete the tenant
domains in the app first, or remove the identities in the SES console.

## 10. Limitations

- Terraform manages the platform identity; tenant identities and configuration sets are created
  by the API at runtime.
- The tenant-branded tracking host needs certificates the Terraform does not issue.
- One region; no multi-region failover of SES or the database.
