<p align="center">
  <img src="docs/assets/banner.svg" alt="Euron Open Email Engine: a self-hosted, multi-tenant alternative to Mailchimp or SendGrid for campaigns, built on Amazon SES" width="100%">
</p>

<p align="center">
  <img alt="Open source" src="https://img.shields.io/badge/open_source-%E2%9D%A4-ab1757?style=flat">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat"></a>
  <img alt="Node.js 22 LTS" src="https://img.shields.io/badge/node-22_LTS-339933?style=flat&logo=nodedotjs&logoColor=white">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat&logo=typescript&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?style=flat&logo=react&logoColor=white">
  <img alt="Express 5" src="https://img.shields.io/badge/Express-5-000000?style=flat&logo=express&logoColor=white">
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-4169e1?style=flat&logo=postgresql&logoColor=white">
  <img alt="Redis 7" src="https://img.shields.io/badge/Redis-7-dc382d?style=flat&logo=redis&logoColor=white">
  <img alt="Amazon SES" src="https://img.shields.io/badge/email-Amazon_SES-dd344c?style=flat&logo=amazonsimpleemailservice&logoColor=white">
  <img alt="Multi-tenant" src="https://img.shields.io/badge/multi--tenant-yes-ab1757?style=flat">
  <img alt="Terraform" src="https://img.shields.io/badge/IaC-Terraform-7b42bc?style=flat&logo=terraform&logoColor=white">
  <img alt="AWS" src="https://img.shields.io/badge/AWS-ready-ff9900?style=flat&logo=amazonwebservices&logoColor=white">
</p>

<p align="center">
  <a href="https://github.com/euron-sde-team/euron-open-email-engine/stargazers"><img alt="Star this repo" src="https://img.shields.io/github/stars/euron-sde-team/euron-open-email-engine?style=social&label=Star%20this%20repo"></a>
  <a href="https://github.com/euron-sde-team/euron-open-email-engine/fork"><img alt="Fork" src="https://img.shields.io/github/forks/euron-sde-team/euron-open-email-engine?style=social&label=Fork"></a>
  <a href="https://github.com/euron-sde-team/euron-open-email-engine/watchers"><img alt="Watch" src="https://img.shields.io/github/watchers/euron-sde-team/euron-open-email-engine?style=social&label=Watch"></a>
  <br>
  <a href="https://github.com/euron-sde-team/euron-open-email-engine/issues"><img alt="Open issues" src="https://img.shields.io/github/issues/euron-sde-team/euron-open-email-engine?style=flat&color=ab1757"></a>
  <a href="https://github.com/euron-sde-team/euron-open-email-engine/pulls"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-34d399?style=flat"></a>
  <a href="https://github.com/euron-sde-team/euron-open-email-engine/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/euron-sde-team/euron-open-email-engine?style=flat&color=8b95a8"></a>
  <img alt="Runs locally with no AWS account" src="https://img.shields.io/badge/runs_locally-no_AWS_account_needed-0a0f1c?style=flat">
  <br>
  <a href="#built-by-the-team-behind-euron"><img alt="Built by the team behind Euron" src="https://img.shields.io/badge/built_by-Euron-ab1757?style=flat"></a>
</p>

<p align="center">
  <b><a href="#-quickstart">Quickstart</a></b> ·
  <b><a href="#️-architecture">Architecture</a></b> ·
  <b><a href="#-explore-the-repository">Explore the repo</a></b> ·
  <b><a href="docs/architecture/comparison.md">How it compares</a></b> ·
  <b><a href="docs/guides/connect-ses.md">Connect SES</a></b> ·
  <b><a href="#️-deploy-to-aws">Deploy</a></b> ·
  <b><a href="docs/architecture/security.md">Security</a></b> ·
  <b><a href="#-documentation">Docs</a></b>
</p>

**Euron Open Email Engine** is an open-source, self-hosted, **multi-tenant email engine**: a
**Mailchimp or SendGrid alternative for campaigns** that you run yourself, on top of **Amazon
SES**. Every customer (a tenant) brings its **own sending domains**, verifies them with DNS
(DKIM, a custom MAIL FROM, SPF and DMARC hints, a tracking CNAME), creates sender identities,
builds an **audience** of contacts with tags, custom fields, lists and rule-based segments, imports
a CSV or collects subscribers with a hosted form (with optional double opt-in), designs
**templates**, composes **campaigns**, sends them now or **schedules** them, and then **tracks and
monitors** the result: delivery, bounces, complaints, opens, clicks, unsubscribes, per-link
clicks and the sending reputation that keeps the shared SES account healthy. A separate
**operator console** runs the deployment: tenants, plans with monthly send quotas, fleet
reputation, SES account health, the dead-letter queue, and pausing or unpausing a tenant. It is
MIT-licensed and part of the open-source initiative of **ENGAGESPHERE TECHNOLOGY PRIVATE LIMITED**.

The parts that usually go wrong when you run email for other people are designed in, not bolted on:

- **Tenants never see each other.** Every table carries `tenant_id`, every query is scoped by it,
  and another tenant's record is a 404. A route sweep in the test suite proves it.
- **A bad sender cannot burn the shared account.** Bounce and complaint rates are computed over a
  rolling 14 days per tenant. A tenant that crosses the line is throttled, then paused: its
  in-flight campaigns freeze, marketing sends are blocked, and an operator lifts the hold.
- **Mail only goes out from a verified domain.** A campaign refuses to send from a domain whose
  DNS has not been verified, and each tenant has its own SES configuration set, so events and
  reputation never mix.
- **Unsubscribe cannot be triggered by a scanner.** The link opens a page; only a deliberate POST
  (or the RFC 8058 one-click header) unsubscribes, so corporate link scanners do not unsubscribe
  your readers.
- **Opens are honest.** Apple Mail Privacy Protection and proxies load images automatically, so
  those opens are counted but flagged, and the report says to read open rates with care.
- **It runs with no AWS account.** A simulated SES mode and an AWS emulator run the whole product,
  including bounces and complaints, on a laptop.

<p align="center">
  <img src="docs/assets/tour.gif" alt="Product tour: the dashboard, contacts, a segment with a live count, a template editor, the campaign composer, a campaign report, the DNS records for a sending domain, reputation, and the operator console's fleet view" width="100%">
</p>

> [!NOTE]
> Everything in the tour and the screenshots ran for real on a laptop: `make up && make demo`
> brings up the API, the tenant app, the operator console, Postgres, Redis and an AWS emulator,
> and seeds two fictional tenants with 600 contacts and a history of campaigns. The names
> Mailchimp, SendGrid and Amazon SES appear here only to say what this is an alternative to or
> built on; the project is not affiliated with or endorsed by those companies.

<h3 align="center">Built by the team behind Euron</h3>

<p align="center">
  <sub>Euron Open Email Engine is part of the open-source initiative of ENGAGESPHERE TECHNOLOGY PRIVATE LIMITED, made by the people who build<br>the platforms below. If you like how this repository is built, come and see what we build with it.</sub>
</p>

<p align="center">
  <a href="https://euron.one"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/euron-dark.svg"><img src="docs/assets/brand/euron-light.svg" alt="Euron: learn the latest technologies from industry experts. Visit euron.one" width="31%"></picture></a>
  <a href="https://euronsystems.com"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/euron-systems-dark.svg"><img src="docs/assets/brand/euron-systems-light.svg" alt="Euron Systems: the SaaS platform for educators and creators. Visit euronsystems.com" width="31%"></picture></a>
  <a href="https://alphaeuron.com"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/alpha-euron-dark.svg"><img src="docs/assets/brand/alpha-euron-light.svg" alt="Alpha Euron: where school kids grow creativity and tech skills with AI. Visit alphaeuron.com" width="31%"></picture></a>
</p>

<p align="center">
  <a href="https://www.instagram.com/euron_official"><img src="https://img.shields.io/badge/Instagram-E4405F?style=flat-square&logo=instagram&logoColor=white" alt="Instagram"></a>
  <a href="https://www.linkedin.com/company/euronone/posts/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white" alt="LinkedIn"></a>
  <a href="https://x.com/euron712"><img src="https://img.shields.io/badge/X-000000?style=flat-square&logo=x&logoColor=white" alt="X"></a>
  <a href="https://www.youtube.com/@Euron-official"><img src="https://img.shields.io/badge/YouTube-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://whatsapp.com/channel/0029VaeeJwq9RZAfPW9P2l07"><img src="https://img.shields.io/badge/WhatsApp_channel-25D366?style=flat-square&logo=whatsapp&logoColor=white" alt="WhatsApp channel"></a>
</p>

---

## 📚 Table of contents

- [Why Euron Open Email Engine](#-why-euron-open-email-engine)
- [At a glance](#-at-a-glance)
- [Screenshots](#️-screenshots)
- [Features](#-features)
- [Architecture](#️-architecture)
- [How it compares](#-how-it-compares)
- [Tech stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Quickstart](#-quickstart)
- [Use real SES](#-use-real-ses)
- [Explore the repository](#-explore-the-repository)
- [API](#-api)
- [Configuration](#️-configuration)
- [Deploy to AWS](#️-deploy-to-aws)
- [Security model](#-security-model)
- [Testing](#-testing)
- [Documentation](#-documentation)
- [Roadmap](#️-roadmap)
- [FAQ](#-faq)
- [Contributing, security and license](#-contributing-security-and-license)

## 💡 Why Euron Open Email Engine

Hosted tools such as Mailchimp and SendGrid are excellent, and they charge by the contact or by the
message, hold your list, and decide what you may send. Sending through Amazon SES directly is
cheap, but SES is a pipe: it gives you no audience, no templates, no scheduling, no reports and no
guard rails. This repository is the layer in between, for two kinds of people:

- **A company that wants its own Mailchimp-style tool** on SES pricing, with its data in its own
  database and its sending reputation under its own control.
- **A platform, agency or SaaS that sends email for other companies**, and needs each of them to
  bring a domain, stay inside a plan, and not harm everyone else's deliverability.

It is deliberately a campaigns product first. There is no developer send API, SMTP relay or webhook
delivery in 0.1; they are on the [roadmap](#️-roadmap) and described honestly in
[docs/architecture/comparison.md](docs/architecture/comparison.md).

## 📊 At a glance

| | |
| --- | --- |
| Planes | Tenant app (customers), operator console (the platform), public pages (recipients) |
| Sending | Amazon SES, one configuration set per tenant, DKIM, custom MAIL FROM, a reputation gate |
| Audience | Contacts with tags and custom fields, static lists, rule-based segments, CSV import and export, hosted subscribe forms, double opt-in, suppression list |
| Content | HTML templates with safe merge tags and defaults, 8 starter templates, live sandboxed preview |
| Campaigns | Four-step composer, preflight, test sends, schedule now or later, pause, resume, cancel, duplicate |
| Tracking | Own open pixel and click redirect, per-link clicks, machine-open flagging, one-click unsubscribe |
| Reports | Funnel, hourly timeline, links, bounce reasons, top recipient domains, recipient table |
| Roles | Admin, Manager, Marketer, Analyst, plus custom roles |
| Operator | Tenants, plans and quotas, fleet reputation, SES account health, dead-letter queue, pause and unpause, audit |
| Data | One Postgres schema, forward-only SQL migrations |
| Runs on | Docker Compose locally (with an AWS emulator), ECS Fargate + RDS + ElastiCache + SES on AWS |

## 🖼️ Screenshots

| | |
| :---: | :---: |
| <img src="docs/assets/screenshots/01-dashboard.png" alt="Dashboard" width="100%"><br><sub><b>Dashboard.</b> 30 days of sending, usage against the plan, audience health and a setup checklist for new tenants.</sub> | <img src="docs/assets/screenshots/02-campaigns.png" alt="Campaigns" width="100%"><br><sub><b>Campaigns.</b> Drafts, scheduled, sending, paused and sent, with their results.</sub> |
| <img src="docs/assets/screenshots/04-composer.png" alt="Campaign composer" width="100%"><br><sub><b>Composer.</b> Setup, audience, content, then a preflight and a schedule before the send button.</sub> | <img src="docs/assets/screenshots/03-campaign-report.png" alt="Campaign report" width="100%"><br><sub><b>Campaign report.</b> Funnel, opens and clicks over time, links, bounces and domains. Opens include machine opens, and it says so.</sub> |
| <img src="docs/assets/screenshots/13-domain-dns.png" alt="A verified sending domain" width="100%"><br><sub><b>A sending domain.</b> The DNS records grouped by purpose, a copy button on every value, found or not per record.</sub> | <img src="docs/assets/screenshots/17-domain-pending.png" alt="DNS wizard for a pending domain" width="100%"><br><sub><b>The DNS wizard.</b> What a new tenant sees: records to publish, plain-language help, Check now.</sub> |
| <img src="docs/assets/screenshots/05-contacts.png" alt="Contacts" width="100%"><br><sub><b>Contacts.</b> Search, filter by status, tag or list, bulk actions and CSV export.</sub> | <img src="docs/assets/screenshots/06-contact.png" alt="A contact" width="100%"><br><sub><b>A contact.</b> Lists, custom fields and a timeline of every message, open and click.</sub> |
| <img src="docs/assets/screenshots/08-segment-builder.png" alt="Segment builder" width="100%"><br><sub><b>Segments.</b> A rule builder with a live count and a sample of who matches.</sub> | <img src="docs/assets/screenshots/09-import.png" alt="CSV import" width="100%"><br><sub><b>Import.</b> Upload, map columns, review the result; unsubscribed contacts are never resurrected.</sub> |
| <img src="docs/assets/screenshots/10-templates.png" alt="Templates" width="100%"><br><sub><b>Templates.</b> Starter gallery and your own, duplicated or edited.</sub> | <img src="docs/assets/screenshots/11-template-editor.png" alt="Template editor" width="100%"><br><sub><b>Editor.</b> HTML with a merge-tag menu and a live preview in a sandboxed frame.</sub> |
| <img src="docs/assets/screenshots/14-messages.png" alt="Messages" width="100%"><br><sub><b>Messages.</b> Every message sent, with its status and a per-message event timeline.</sub> | <img src="docs/assets/screenshots/15-reputation.png" alt="Reputation" width="100%"><br><sub><b>Reputation.</b> Rolling 14-day rates against the thresholds that throttle or pause marketing.</sub> |
| <img src="docs/assets/screenshots/16-forms.png" alt="Subscribe forms" width="100%"><br><sub><b>Forms.</b> Hosted subscribe pages with embed snippets and optional double opt-in.</sub> | <img src="docs/assets/screenshots/18-dashboard-dark.png" alt="Dashboard in dark mode" width="100%"><br><sub><b>Dark mode.</b> Every screen, in both themes, axe-checked.</sub> |
| <img src="docs/assets/screenshots/21-console-fleet.png" alt="Operator console: fleet" width="100%"><br><sub><b>Fleet.</b> Every tenant's sending health and bounce and complaint rates.</sub> | <img src="docs/assets/screenshots/22-console-plans.png" alt="Operator console: plans" width="100%"><br><sub><b>Plans.</b> Monthly emails, contacts, domains and users, and the modules each plan opens.</sub> |
| <img src="docs/assets/screenshots/23-console-account-health.png" alt="Operator console: account health" width="100%"><br><sub><b>Account health.</b> SES sending state, sandbox, quota and account-wide rates.</sub> | <img src="docs/assets/screenshots/24-console-dlq.png" alt="Operator console: dead-letter queue" width="100%"><br><sub><b>Dead-letter queue.</b> Depth, age and a sample of events that could not be processed.</sub> |

## ✨ Features

**Tenants**
- **Sending domains:** add a subdomain, publish DKIM, MAIL FROM, SPF, DMARC and tracking records, press
  Check now. Status and per-record findings update; the page re-checks on its own.
- **Senders:** several identities per verified domain, a default per message category, send a test
  to yourself.
- **Audience:** contacts, custom fields, tags, lists, segments, CSV import with column mapping,
  export, subscribe forms, consent, suppression list and bounce handling.
- **Templates:** safe merge tags (`{{first_name | default: "there"}}`), unsubscribe and view-in-browser
  links, starters you can copy.
- **Campaigns:** compose in four steps, preflight (domain, sender, quota, audience size, missing
  unsubscribe link), test sends, send now or schedule in the tenant's timezone, pause, resume,
  cancel, duplicate.
- **Monitoring:** per-campaign report, message log with event timelines, reputation, dashboard.
- **Team:** roles with module access, audit log.

**Operators**
- Tenants (create, suspend, reactivate), plans with limits and modules, entitlement overrides.
- Fleet reputation, manual unpause with a recorded reason, SES account health, DLQ monitor, audit.

**Platform**
- A production guard: the API refuses to boot with development secrets, simulated SES or a localhost
  public URL.
- Terraform for AWS (ECS Fargate, RDS, ElastiCache, SES with an SNS and SQS event pipeline, KMS,
  Secrets Manager, CloudFront and WAF) and a local AWS emulator for development.

## 🏗️ Architecture

<p align="center">
  <img src="docs/assets/diagrams/context.svg" alt="Context diagram: tenant staff, the operator and recipients reach the web apps and the Express API; the worker sends through Amazon SES, and SES delivery events return through SNS and SQS; tenants publish records in their own DNS" width="100%">
</p>

### One campaign, from Send to the report

<p align="center">
  <img src="docs/assets/diagrams/sending-pipeline.svg" alt="Sequence of steps: preflight, snapshot, queue, render, SES send; then events back from SES, tracking hits and the report, with the reputation gate that can pause a sending campaign" width="100%">
</p>

1. **Preflight** checks the sender's domain is verified, the quota fits and the audience is not
   empty.
2. **Snapshot**: the audience becomes `campaign_recipients` in one SQL statement, skipping
   unsubscribed, bounced, complained and suppressed contacts.
3. **Queue**: per-tenant rate-limited batches (BullMQ). A paused or suspended tenant stops here.
4. **Render**: merge tags with defaults, HTML-escaped; links rewritten to signed redirects; an open
   pixel; `List-Unsubscribe` and one-click headers.
5. **Send** through SES with the tenant's configuration set. Delivery, bounce and complaint events
   come back through SNS and SQS, update the message, the contact and the reputation, and show up in
   the report with the opens and clicks recorded by the tracking endpoints.

### Tenants, plans and the public routes

<p align="center">
  <img src="docs/assets/diagrams/request-and-tenancy.svg" alt="Route kinds: authenticated tenant routes scoped by tenant, operator routes with a separate token, and public routes for tracking, unsubscribe, view in browser, forms and confirmation; plans set quotas and modules and reputation decides whether marketing may send" width="100%">
</p>

Details: [HLD](docs/architecture/HLD.md), [LLD](docs/architecture/LLD.md),
[sending pipeline](docs/architecture/sending-pipeline.md), [tracking](docs/architecture/tracking.md),
[deliverability and reputation](docs/architecture/deliverability-and-reputation.md).

## 🆚 How it compares

| | This project | Mailchimp | SendGrid | Amazon SES alone |
| --- | :---: | :---: | :---: | :---: |
| Self-hosted, your data in your database | Yes | No | No | Partly |
| Campaigns, templates and segments | Yes | Yes | Yes | No |
| Bring-your-own sending domains per customer | Yes | Limited | Yes | Yes |
| Multi-tenant with plans and quotas | Yes | No | Subusers | No |

A fair, longer comparison, including Postmark, Mailgun, Brevo, Listmonk and Mautic, is in
[docs/architecture/comparison.md](docs/architecture/comparison.md). Product names belong to their
owners; this project is not affiliated with or endorsed by them.

## 🧰 Tech stack

| Layer | Choice |
|---|---|
| Apps | React 19 with Vite and TanStack Query (tenant app and operator console), Tailwind CSS, Radix UI |
| API | Node.js 22, Express 5, Kysely on PostgreSQL 16, zod |
| Jobs | BullMQ on Redis 7: sends, scheduler, imports, DNS checks, SES events |
| Email | Amazon SES v2 (identities, configuration sets, DKIM, MAIL FROM), SNS and SQS for events |
| Files | S3 (or a local emulator) for CSV imports |
| Infrastructure | Terraform, ECS Fargate, ALB, CloudFront and WAF, RDS, ElastiCache, KMS, SES, Secrets Manager, CloudWatch |
| Local AWS | The Floci emulator (S3, SES, SNS, SQS, KMS) and Mailpit |
| Tooling | pnpm workspaces, Turborepo, TypeScript strict, Vitest, Playwright with axe, ESLint |

## 📋 Prerequisites

- Docker with Compose v2 (about 4 GB of memory for the containers)
- Node.js 22 and pnpm 9 (only to run tests or develop outside Docker)
- For real sending: an AWS account with SES, and a domain whose DNS you control
  ([docs/guides/connect-ses.md](docs/guides/connect-ses.md))

No AWS account is needed to run it locally.

## 🚀 Quickstart

```bash
git clone https://github.com/euron-sde-team/euron-open-email-engine.git
cd euron-open-email-engine
make up      # the stack on emulated AWS, provisioned by the same Terraform as production
make demo    # an operator, two tenants, 600 contacts, campaigns with a history of events
```

Open http://localhost:3650 and sign in as `maya@northwind.example` (Northwind Mail, a verified
domain and a campaign history) or `sam@acme-robotics.example` (a domain still waiting for DNS), and
http://localhost:3660 as `operator@example.com` (the console). `make demo` prints the password;
every demo account shares it.

| URL | What |
|---|---|
| http://localhost:3650 | The tenant app |
| http://localhost:3660 | The operator console |
| http://localhost:5126/api/health | The API |
| http://localhost:8126 | Mailpit: every email the app sends |
| http://localhost:4677 | Floci, the AWS emulator (S3, SES, SNS, SQS, KMS) |

Locally, mail goes through the emulated SES into Mailpit. Addresses starting with `bounce@`,
`soft@` or `complaint@` simulate a hard bounce, a soft bounce and a complaint, so you can watch
suppression and reputation react. [docs/guides/quickstart-local.md](docs/guides/quickstart-local.md)
explains each step and [docs/guides/walkthrough.md](docs/guides/walkthrough.md) follows a tenant
from plan to report.

## ✉️ Use real SES

1. Create the SES resources with the Terraform in `infra/terraform` (identities, event topic,
   queue and DLQ) and set `EMAIL_SES_MODE=aws` with the topic and queue URLs.
2. Ask AWS for production access (a new SES account is in the sandbox and can only send to verified
   addresses).
3. Each tenant adds a domain in the app, publishes the records, and the first campaign goes out
   from their domain.

The step-by-step version, with warm-up advice, is
[docs/guides/connect-ses.md](docs/guides/connect-ses.md).

## 🧭 Explore the repository

```
apps/
  api/          Express API and worker (one image, two commands)
    src/
      routes/            tenant, operator and public routes
      services/          campaigns, sending, tracking, audience, segments, imports, reputation
      jobs/              scheduler, send batches, DNS checks, SES events, imports, upkeep
  web/          the tenant app (React)
  console/      the operator console (React)
packages/
  types/        the API contract, shared by the apps and the API
db/migrations/  one SQL migration
deploy/compose/ the local stack (Floci, Mailpit)
infra/          Terraform modules and environments, Dockerfiles
docs/           architecture, ADRs, API, guides
e2e/            Playwright end-to-end tests
```

## 🔌 API

- [REST contract](docs/api/rest-contract.md): envelopes, errors, pagination, every tenant, operator
  and public route.
- [`@open-email/types`](packages/types): the TypeScript contract the apps compile against.

## ⚙️ Configuration

Every variable is declared once in [`apps/api/src/config/index.ts`](apps/api/src/config/index.ts) and
documented in [docs/guides/configuration.md](docs/guides/configuration.md). A production API refuses
to boot with development secrets, `EMAIL_SES_MODE` other than `aws`, weak signing secrets, or a
localhost or non-https public URL.

## ☁️ Deploy to AWS

```bash
make aws-plan ENV=aws-dev     # terraform plan for infra/terraform/envs/aws-dev
make aws-deploy ENV=aws-dev   # build and push images, apply, run migrations
```

ECS Fargate behind one load balancer, RDS PostgreSQL, ElastiCache Redis, SES with an SNS topic and
an SQS queue plus a dead-letter queue, Secrets Manager and KMS, with CloudFront and WAF optional in
dev and on in prod. [docs/guides/deploy-aws.md](docs/guides/deploy-aws.md) walks through the first
deploy and [docs/guides/operations.md](docs/guides/operations.md) through running it.

## 🔐 Security model

- **Tenant isolation.** Every query is scoped by `tenant_id`; another tenant's id is a 404, covered by a
  sweep over every tenant route.
- **Plans are runtime limits.** Quotas are reserved with a single conditional update, so parallel
  sends cannot overshoot a plan.
- **Signed public tokens.** Tracking, unsubscribe, confirmation and view-in-browser links are
  HMAC-signed and compared in constant time; redirects go only to URLs stored for that campaign.
- **Scanner-safe unsubscribe.** A GET shows a page; only a POST changes anything.
- **No secrets in the browser.** The apps hold a short-lived session token; AWS credentials come
  from the task role.
- **Bounded input.** CSV size and rows, page sizes, body sizes and segment query time are capped;
  segments compile to parameterised SQL; CSV exports are formula-injection safe.

[docs/architecture/security.md](docs/architecture/security.md) and
[docs/architecture/threat-model.md](docs/architecture/threat-model.md) cover the rest, including
the limitations.

## 🧪 Testing

```bash
pnpm lint && pnpm typecheck && pnpm test        # unit tests in every package
make test-integration                          # the API against real Postgres and Redis
make e2e                                       # Playwright against the running stack
```

| Suite | Count | Where |
|---|---|---|
| API unit | 87 | `apps/api/tests/unit` |
| API integration | 147 | `apps/api/tests/api`, against Postgres 16 and Redis 7 |
| Tenant app | 34 | `apps/web/src` |
| Console | 18 | `apps/console/src` |
| End to end | 31 | `e2e/tests`, Chromium against the stack, including axe in both themes |

The integration suite covers the guarantees above: a cross-tenant sweep over every tenant route, a
campaign sent end to end in simulated mode (suppression, quota refusal, bounces and complaints
updating contacts and reputation, a paused tenant freezing a sending campaign), the scheduler,
tracking and unsubscribe, forms, imports and the production guard.
[docs/guides/testing.md](docs/guides/testing.md) has the details.

## 📖 Documentation

| | |
|---|---|
| Architecture | [HLD](docs/architecture/HLD.md), [LLD](docs/architecture/LLD.md), [sending pipeline](docs/architecture/sending-pipeline.md), [tracking](docs/architecture/tracking.md), [audience and segments](docs/architecture/audience-and-segments.md), [deliverability and reputation](docs/architecture/deliverability-and-reputation.md), [data model](docs/architecture/data-model.md), [multi-tenancy and entitlements](docs/architecture/multi-tenancy-and-entitlements.md), [RBAC](docs/architecture/rbac.md), [simulated providers](docs/architecture/simulated-providers.md), [comparison](docs/architecture/comparison.md) |
| Security | [security](docs/architecture/security.md), [threat model](docs/architecture/threat-model.md) |
| Decisions | [architecture decision records](docs/architecture/adr) |
| API | [REST contract](docs/api/rest-contract.md) |
| Guides | [quickstart](docs/guides/quickstart-local.md), [walkthrough](docs/guides/walkthrough.md), [configuration](docs/guides/configuration.md), [connect SES](docs/guides/connect-ses.md), [deploy to AWS](docs/guides/deploy-aws.md), [operations](docs/guides/operations.md), [add a template](docs/guides/add-a-template.md), [testing](docs/guides/testing.md), [troubleshooting](docs/guides/troubleshooting.md), [integration roadmap](docs/guides/write-an-integration-note.md) |

## 🗺️ Roadmap

- A developer send API with scoped keys and idempotency, for transactional mail.
- An SMTP relay for apps that cannot call an API.
- Signed outbound webhooks for delivered, bounced, opened and clicked events.
- Automations: welcome series and drip campaigns.
- Subject-line A/B tests with an automatic winner.
- Per-tenant custom tracking domains over HTTPS.
- A visual drag-and-drop template editor.

## ❓ FAQ

<details>
<summary><b>Do I need an AWS account to try it?</b></summary>

No. `make up && make demo` runs everything on an AWS emulator and a simulated SES mode, with every
email landing in Mailpit. Real sending needs SES in production mode and a domain you control.
</details>

<details>
<summary><b>Why can opens look high?</b></summary>

Apple Mail Privacy Protection and some security scanners load images automatically. Those opens are
counted but flagged as machine opens, and every report says so. Clicks are the more reliable signal.
</details>

<details>
<summary><b>Can a tenant use its own tracking domain?</b></summary>

The DNS record is shown and the setting exists, but links use the platform host by default because
TLS certificates are issued for platform hosts. Custom tracking domains over HTTPS are on the roadmap.
</details>

<details>
<summary><b>What happens when a tenant gets too many bounces or complaints?</b></summary>

Its status moves from active to warning, throttled and paused as the 14-day rates climb. A paused
tenant cannot send marketing mail and its in-flight campaigns freeze; an operator reviews the cause
and lifts the hold from the console, with a recorded reason.
</details>

## 🤝 Contributing, security and license

- [CONTRIBUTING.md](CONTRIBUTING.md): how to set up, the checks a pull request must pass, and the
  coding conventions.
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- [MIT License](LICENSE).
