# ADR 0006: A simulated provider mode, built into the SES client

## Status

Accepted.

## Context

Trying the product, contributing and CI should not need an AWS account, and no test may send a
real email. The code around SES (domains, sending, events, reputation) is where most of the logic
is, so it must run in development and in tests, not be skipped.

## Decision

The SES client decides for itself whether it is live
([`email-ses.client.ts`](../../../apps/api/src/services/email-ses.client.ts)). When it is not, it
returns well-formed fake results through the same interface: deterministic fake DKIM tokens, ids
starting `sim_`, a fixed account. The mailer then plays an outcome back through the **same event
handler** that real SES events use: delivery by default, `bounce@` a hard bounce, `soft@` a soft
bounce, `complaint@` a complaint. Opens and clicks are never simulated; they come only from real
hits on the tracking links. "Under test" always wins over any configured key.

Beyond the simulator, `make up` runs [Floci](https://github.com/floci-io/floci) provisioned by the
production Terraform modules, with SES mail relayed to Mailpit, so the real SES API calls and the
SNS to SQS events path also run locally. Details: [simulated-providers.md](../simulated-providers.md).

## Consequences

Positive:

- The whole product, including reputation tiers, works offline.
- Tests exercise the real services with no network and no secrets.
- Going live is configuration: set `EMAIL_SES_MODE=aws` and the SES settings.

Trade-offs:

- Simulation lives inside the production client. Production refuses `EMAIL_SES_MODE=simulated`,
  but an unset mode without `AWS_SES_FROM_EMAIL` also simulates and is not caught: set the mode
  explicitly.
- The fakes do not reproduce SES behaviour (sandbox rules, quotas, filtering, real
  complaints).

## Alternatives considered

- **A stub server speaking SES's wire format.** Floci covers this for the local stack.
- **Mocking in tests only.** Leaves development and demos needing an account.
