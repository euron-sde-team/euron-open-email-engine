# Terraform

The same modules build the local emulator environment and both AWS environments.

| Environment | Purpose |
| --- | --- |
| `envs/local-floci` | Applied by `make up` against the Floci emulator: KMS key, app secret, file bucket, platform SES identity with DKIM, the SES events topic, queue and dead-letter queue. |
| `envs/aws-dev` | A cheaper full copy of production (single NAT, single-AZ database, one API task). |
| `envs/aws-prod` | Three AZs, Multi-AZ database, two Redis nodes, deletion protection, WAF. |

Deploy with `make aws-deploy ENV=aws-dev` (copy `terraform.tfvars.example` first). Gates:
`make tf-fmt tf-validate tf-lint tf-security`.

## What gets built

- ECS Fargate API (HTTP plus the background jobs), RDS PostgreSQL, ElastiCache Redis (BullMQ and rate limits), a private S3 bucket (CSV imports, uploaded images), KMS, Secrets Manager.
- SES: the platform identity (DKIM, custom MAIL FROM, a configuration set with CloudWatch metrics) and the event pipeline for tenant sending domains. The API creates one SES identity and one configuration set per tenant domain; each configuration set publishes to the events SNS topic, which feeds an SQS queue with a dead-letter queue (five receives, then it parks).
- Two single-page apps on S3 and CloudFront (tenant app, operator console), with an Application Load Balancer behind CloudFront that only CloudFront can reach.
- Alarms to an SNS topic: API errors and health, CPU and memory, database, failed jobs, dead-letter queue depth, and the SES account bounce and complaint rates (`ses_bounce_rate_threshold`, `ses_complaint_rate_threshold`).

## Public mail paths

CloudFront and the load balancer route these paths on both hosts to the API, uncached:

| Path | Purpose |
| --- | --- |
| `/t/o/*`, `/t/c/*` | open pixel, click redirect |
| `/u/*` | hosted unsubscribe page and RFC 8058 one-click POST |
| `/f/*` | hosted subscribe forms |
| `/c/*` | double opt-in confirmation |
| `/w/*` | view in browser |

Everything under `/api/*` keeps its own rule, and everything else is the single-page app. The WAF rate limit exempts `/t/o/`, `/t/c/`, `/u/` and `/w/` (mailbox image proxies and link scanners hit them in bursts from a few addresses, often without a User-Agent, which the common rule set would otherwise block); the API rate limits those routes itself.

## DNS

Two kinds of records.

**Platform records** (from `terraform output`): `cdn_dns_records` (the two app hosts to CloudFront), `certificate_validation_records` and `mail_dns_records` (DKIM and MAIL FROM of the platform identity). With `route53_zone_id` set, Terraform creates all of them.

**Tenant records** are shown by the domain wizard in the app, not by Terraform. For every sending domain the tenant publishes three DKIM CNAMEs, the custom MAIL FROM MX and SPF, the SPF and DMARC hints, and the **tracking CNAME**:

```
track.<tenant domain>   CNAME   <tracking_cname_target>
```

`terraform output tracking_cname_target` is the value (the `tracking_host` variable, default the tenant app host). It is also passed to the API as `EMAIL_TRACKING_HOST`, which the wizard shows as the record value.

HTTPS caveat: CloudFront and the load balancer present certificates for the platform hosts only. A request for `track.<tenant domain>` reaches them with that name in the TLS handshake, so a tenant-branded tracking host needs a certificate for that name, which this module does not issue. Serve it from a proxy or distribution you control that terminates TLS for those names and forwards to `tracking_host`, or leave the tracking CNAME unverified so links use the platform host.

## SES production access

A new SES account is in the sandbox: it sends only to verified recipients. Request production access in the SES console before tenants send. Set `email_account_tps` to the account's maximum send rate and keep `reputation_thresholds.*_pause` below the rates at which SES reviews an account (5 percent bounces, 0.1 percent complaints).
