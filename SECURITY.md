# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.x (latest minor) | Yes |
| Older minors | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab, "Report a vulnerability"):
https://github.com/euron-sde-team/euron-open-email-engine/security/advisories/new

Please include:

- the affected component (`apps/api`, `apps/web`, `apps/console`, `packages/types`,
  `infra/terraform/...`) and version or commit,
- a description of the issue and its impact,
- steps to reproduce, or a proof of concept (against your own deployment or the local
  stack, never someone else's),
- any suggested mitigation.

What to expect:

| Stage | Target |
| ----- | ------ |
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 business days |
| Fix or mitigation for critical / high issues | within 30 days |
| Coordinated public disclosure | after a fix is released, credited to you unless you prefer otherwise |

## Scope

In scope: the code in this repository and the infrastructure it provisions with its
default settings. We are most interested in:

- **Tenant isolation.** Reading or changing another workspace's contacts, lists, segments,
  templates, campaigns, messages, events, suppressions, files or audit log; any query path that is
  not scoped by `tenant_id`.
- **Authentication and authorisation.** Signing in as someone else, forging or reusing a token
  across the tenant and operator planes, password reset flaws, sign-in rate limits that can be
  sidestepped, reaching a module the plan or the role does not grant.
- **Entitlements and quota.** Sending beyond the plan's monthly emails, exceeding a contact,
  domain or user limit, or using a module the plan does not include.
- **Public links.** Forging or replaying open, click, unsubscribe, view-in-browser or
  confirmation tokens; unsubscribing or subscribing a person without their action (including by
  a link scanner); an open redirect through the click endpoint; reading another tenant's
  campaign through `/w/:token`; enumerating addresses through the hosted subscribe forms.
- **Sending.** Mailing a suppressed, bounced or unsubscribed address, bypassing the reputation
  gate, sending from a domain that is not verified, or header injection through merge data or
  sender fields.
- **Content.** Script execution from a template or campaign in the app or on the public
  view-in-browser page.
- **Imports and exports.** Formula injection through the CSV export, or resource exhaustion
  through the import limits.
- **Files.** Reading a stored file without a valid, unexpired signed link.

Out of scope:

- **What admins can already do.** Workspace admins manage their own users, roles, domains,
  senders and data; operators manage tenants and plans. Reports that rely on that access are out
  of scope; reports that let someone gain it are very much in scope.
- **Documented limitations** listed in
  [docs/architecture/security.md](docs/architecture/security.md#9-limitations), such as bearer
  tokens that are not revocable before they expire.
- **Open-rate inaccuracy.** Apple Mail Privacy Protection and image blocking make opens
  unreliable by nature ([docs/architecture/tracking.md](docs/architecture/tracking.md)).
- **The demo seed.** `make demo` creates well-known demo accounts on purpose and refuses to run
  with `NODE_ENV=production`.
- **Simulated mode.** `EMAIL_SES_MODE=simulated` exists for local development and tests.
- Findings that require a compromised host, compromised AWS account, or leaked deployment
  secrets.
- Denial of service through resource exhaustion of a deployment you operate yourself.

## Hardening checklist for operators

- Deploy with the Terraform in `infra/terraform` (or match it): private subnets, TLS everywhere,
  encryption at rest with a customer-managed key, Redis with TLS, secrets only in Secrets Manager.
- Keep `NODE_ENV=production`: the API refuses to boot with the development `JWT_SECRET`
  or link-signing secrets, with short ones, without `CORS_ORIGINS`,
  without `EMAIL_SES_MODE=aws` set explicitly, or with an `APP_PUBLIC_URL` that is not a public `https`
  origin.
- Set `EMAIL_SES_MODE=aws` explicitly, and confirm in the console's Account health page that the
  mode is `aws`.
- Back up the signing secrets: changing `EMAIL_UNSUBSCRIBE_SIGNING_SECRET` or
  `EMAIL_TRACKING_SIGNING_SECRET` breaks every link in mail already sent.
- Set `TRUST_PROXY` to the number of proxies in front of the API (1 behind the ALB, 2 behind
  CloudFront and the ALB) so rate limits see the real client address.
- Run Redis in production: without it there is no send rate limit.
- Keep the SES account out of the sandbox only after reviewing your sign-up and list policies, and
  keep `reputation_thresholds` below SES's own review points.
- Route `/t /u /w /f /c` to the API and never cache them.
- Subscribe someone to the alarm topic (`alarm_email`).
