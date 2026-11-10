# ADR 0001: One engine on SES, with a configuration set per tenant

## Status

Accepted.

## Context

The product sends campaigns for many tenants. Each tenant needs its own sending domain and its
own view of delivery, bounces and complaints. Options are one AWS account per tenant, many
providers behind an adapter, or one SES account shared by all tenants.

## Decision

One engine on Amazon SES v2 in the operator's own AWS account. For each tenant the API creates
one **configuration set** (`email-tenant-<tenantId>`) wired to a single SNS topic and, for each
tenant domain, one **SES identity** with DKIM and a custom MAIL FROM domain
([`email-ses.client.ts`](../../../apps/api/src/services/email-ses.client.ts)). Every message
carries the tags `tenantId`, `messageId`, `category` and (for campaigns) `campaignId`, and one
SQS consumer applies the delivery events by reading those tags
([`email-events.service.ts`](../../../apps/api/src/services/email-events.service.ts)). Only
`SEND`, `DELIVERY`, `BOUNCE`, `COMPLAINT` and `REJECT` are subscribed; engagement comes from the
engine's own tracking ([ADR 0002](0002-own-tracking.md)).

## Consequences

Positive:

- One AWS account to run, one set of quotas, one bill, one pipeline to monitor.
- Events are attributed to a tenant by a tag the engine put there, so no per-tenant topic or
  queue is needed.
- The operator brings their own SES: its prices, limits and region apply directly.

Trade-offs:

- All tenants share the account's reputation and sending quota. The per-tenant reputation gate
  ([ADR 0005](0005-reputation-gate-before-cost.md)) exists because of this.
- SES identities are unique per account, so a domain can belong to only one tenant.
- A new SES account starts in the sandbox; the operator must request production access
  ([connect-ses.md](../../guides/connect-ses.md)).
- No other provider is supported; an adapter layer would be a later, separate decision.

## Alternatives considered

- **An AWS account per tenant.** Strong isolation, but onboarding, quotas and billing become
  per-tenant operations.
- **A provider adapter (SES, SendGrid, Mailgun).** Doubles the event model and the DNS wizard for
  a benefit most operators do not need.
- **Dedicated IPs per tenant.** An SES feature the operator can adopt outside this code; not
  modelled here.
