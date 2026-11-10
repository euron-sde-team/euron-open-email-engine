# Changelog

All notable changes to Euron Open Email Engine are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-10

First release: a self-hosted alternative to Mailchimp or SendGrid for campaigns, built on Amazon
SES, multi-tenant, MIT licensed. See [docs/architecture/comparison.md](docs/architecture/comparison.md)
for what it does and does not do.

### Added

- **Tenant app** (`apps/web`): dashboard with a setup checklist, sending domains with a DNS wizard
  (DKIM, custom MAIL FROM, SPF, DMARC and tracking records, "Check now"), senders, contacts with
  filters, bulk actions and a per-contact timeline, custom fields, lists, a rule-based segment
  builder with a live count, hosted subscribe forms, a three-step CSV import, suppressions, an HTML
  template editor with a sandboxed live preview and eight starter templates, a four-step campaign
  composer with preflight, test sends and scheduling, a campaign report (funnel, timeline,
  per-link clicks, bounces, top domains, recipients), a message log with an event timeline, a
  reputation page, team and roles, settings and an audit log. Light and dark themes.
- **Operator console** (`apps/console`): tenants (create, suspend, reactivate), plans with send
  quotas and module access, entitlement overrides, fleet reputation, SES account health, the
  dead-letter queue, an audited manual unpause, operators and an operator audit log.
- **API** (`apps/api`): one Express 5 service for the tenant plane (`/api/v1`), the operator plane
  (`/api/v1/operator`) and the public links (`/t /u /w /f /c`), with a BullMQ-backed worker for
  campaign sending, imports and four recurring sweeps. See [docs/api/rest-contract.md](docs/api/rest-contract.md).
- **Sending**: one SES account with a configuration set per tenant, delivery events over
  SNS and SQS applied idempotently, per-recipient rendering with a safe renderer, tracked links,
  an open pixel, `List-Unsubscribe` and one-click unsubscribe headers, an audience snapshot,
  per-tenant and account send rates, and a monthly email quota reserved atomically.
- **Tracking**: the engine's own open pixel and click redirect with signed tokens, no open
  redirect, hashed IPs, no cookies, and machine-open flagging (Apple Mail Privacy Protection,
  image proxies, scanners).
- **Reputation**: per-tenant tiers (`ACTIVE`, `WARNING`, `THROTTLED`, `PAUSED`) from bounce and
  complaint rates, enforced before cost, with automatic recovery and an audited operator unpause.
- **Simulated provider mode** and a Floci plus Mailpit local stack provisioned by the production
  Terraform modules, so everything runs with no AWS account.
- Entitlements-first plans (Starter, Growth, Scale seeded), roles and custom roles, tenant and
  operator audit logs.
- Terraform for AWS (ECS Fargate, RDS, ElastiCache, S3, KMS, Secrets Manager, SES and its events
  pipeline, CloudFront, WAF, alarms), Docker Compose, CI, and a sanitization scan.
- Documentation: architecture, ADRs, REST contract, and guides for local use, SES, deployment,
  operations, testing and troubleshooting.

### Limitations

- Opens are unreliable (Apple Mail Privacy Protection, image blocking) and are flagged, not
  hidden.
- Tracking links use the platform host unless `EMAIL_TRACKING_CUSTOM_DOMAINS=true` and
  certificates for each tenant `track.<domain>` name are in place.
- No developer REST API, SMTP relay or outbound webhooks.
- No automations or drip sequences, and no A/B tests.
- Imports are limited to 10 MB and 100,000 rows; segments are evaluated at send time.
- Bearer tokens are not revocable before they expire; there is no two-factor authentication.
- A suspended tenant's in-flight and scheduled campaigns still send.

[0.1.0]: https://github.com/euron-sde-team/euron-open-email-engine/releases/tag/v0.1.0
