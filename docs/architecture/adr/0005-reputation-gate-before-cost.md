# ADR 0005: The reputation gate runs before cost

## Status

Accepted.

## Context

All tenants send through one SES account. A tenant with a bad list can push the account's bounce
or complaint rate over AWS's review thresholds, which would harm every tenant. Reacting after the
mail is sent is too late.

## Decision

Each tenant has a sending status (`ACTIVE`, `WARNING`, `THROTTLED`, `PAUSED`) derived from its
permanent bounce rate and complaint rate over a rolling 14 days, with thresholds below SES's own
review points ([`reputation.service.ts`](../../../apps/api/src/services/reputation.service.ts)).
The gate is the **first** step in the mailer, before suppression checks, the rate limiter, the
quota reservation and the SES call ([`mailer.service.ts`](../../../apps/api/src/services/mailer.service.ts)):

- the status scales the tenant's send rate per category (marketing is slowed at `WARNING`, nearly
  stopped at `THROTTLED` and blocked at `PAUSED`; transactional mail is never blocked);
- reaching `PAUSED` freezes the tenant's `SENDING` campaigns;
- degrading is automatic and immediate; recovering from `WARNING` or `THROTTLED` is automatic
  after 48 hours; leaving `PAUSED` needs an operator with a reason, recorded in the audit log.

## Consequences

Positive:

- A bad list is stopped by its own numbers, not by AWS.
- The decision uses data the engine already has; nothing is sampled.
- Operators get a fleet view and an audited, deliberate unpause.

Trade-offs:

- Thresholds are deployment-wide environment variables, not per tenant.
- A tenant under `MIN_SENDS` (100 in 14 days) is never gated, so a new tenant can send a small
  bad list before any tier applies.
- Complaints reach the engine only when mailbox providers return feedback to SES.
- A paused tenant may be paused unfairly by a single large bad send; the operator decides.

## Alternatives considered

- **Rely on AWS to throttle or suspend.** Punishes every tenant for one.
- **Per-recipient content or list scoring.** Interesting, but needs data SES does not provide.
