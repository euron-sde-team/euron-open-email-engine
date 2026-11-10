# How it compares

Euron Open Email Engine is a self-hosted alternative to Mailchimp or SendGrid for campaigns,
built on Amazon SES. This page says what it has in common with hosted email platforms and
related open-source tools, where it differs, and what it does not do yet. It does not claim
feature parity with any of them.

Products named here: Mailchimp, SendGrid (Twilio SendGrid), Amazon SES, Postmark, Mailgun,
Brevo, Listmonk and Mautic. They are named only to say what kind of tool this is. This project
is not affiliated with or endorsed by any of those companies or projects, and all names belong
to their owners.

## What it does like them

| Capability | Here |
| --- | --- |
| Campaigns: compose, test, schedule, pause, cancel, report | Yes ([sending-pipeline.md](sending-pipeline.md)) |
| Templates with merge tags and defaults, a starter gallery | Yes, eight starters |
| Audience: contacts, custom fields, tags, lists, rule-based segments, CSV import, export | Yes ([audience-and-segments.md](audience-and-segments.md)) |
| Hosted subscribe forms with optional double opt-in | Yes |
| Open and click tracking, per-link clicks, unsubscribe and one-click List-Unsubscribe | Yes ([tracking.md](tracking.md)) |
| Domain authentication (DKIM, custom MAIL FROM, SPF and DMARC guidance) | Yes, with a DNS wizard |
| Suppression lists, bounce and complaint handling | Yes |
| Reputation controls on bounce and complaint rates | Yes, per tenant ([deliverability-and-reputation.md](deliverability-and-reputation.md)) |
| Teams, roles and an audit log | Yes ([rbac.md](rbac.md)) |

## What is different

- **Self-hosted and open source (MIT).** You run it, you own the database and the data. The
  hosted platforms are services you subscribe to.
- **Bring your own SES.** Mail leaves through your own Amazon SES account, so SES pricing and
  limits apply directly. Mailchimp, SendGrid, Postmark, Mailgun and Brevo operate their own
  sending infrastructure; this project does not.
- **Multi-tenant by design.** One deployment serves many tenants, each with its own sending
  domains, audience and reputation gate, on plans with monthly send quotas. Listmonk and
  Mautic are typically run for one organisation; this is built so an operator can offer
  workspaces to others.
- **An operator plane.** Plans, tenants, fleet reputation, SES account health and the
  dead-letter queue have their own console. There is no billing: the operator charges tenants
  by whatever means they choose.
- **Runs offline.** A simulated provider mode and the Floci emulator mean the whole product
  works with no AWS account ([simulated-providers.md](simulated-providers.md)).

## What it does not do yet

Stated plainly (the full list is in [HLD.md](HLD.md#7-limitations)):

- **No developer REST send API.** Transactional sending from your own application is not
  available; sending is through campaigns.
- **No SMTP relay.**
- **No outbound webhooks.**
- **No automations or drip sequences.**
- **No A/B tests.**
- Opens are unreliable (Apple Mail Privacy Protection, image blocking) and flagged as such.

Several of the tools above cover some of these. If you need them today, they are a better fit.
The roadmap items are in [write-an-integration-note](../guides/write-an-integration-note.md).
