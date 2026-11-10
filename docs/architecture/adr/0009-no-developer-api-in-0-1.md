# ADR 0009: No developer API, SMTP relay or webhooks in 0.1

## Status

Accepted.

## Context

Products in this space also offer a REST send API, an SMTP relay and outbound webhooks. Each
needs its own credentials, scopes, rate limits, idempotency, abuse controls and documentation,
and each widens what a tenant can do to the shared SES account.

## Decision

0.1 is **campaigns only**: people sign in and send to audiences they manage. There is no API key
type, no `/v1/send` endpoint, no SMTP listener and no webhook delivery. The contact `source`
value `API` is reserved. The routes are listed in
[rest-contract.md](../../api/rest-contract.md); the roadmap is in
[write-an-integration-note.md](../../guides/write-an-integration-note.md).

## Consequences

Positive:

- A smaller surface to secure and to explain, and the reputation gate covers every send path
  there is.
- The first release can be reviewed end to end.

Trade-offs:

- Applications cannot send transactional mail through the engine, and external systems are not
  notified of bounces or unsubscribes except by reading the app or exporting CSV.
- Contacts cannot be synced programmatically; import is by CSV.

## Alternatives considered

- **Ship a send API first.** Higher abuse risk before key scoping and per-key limits exist.
- **Expose the tenant routes as the API.** They use session-style bearer tokens meant for the app,
  with 12 hour expiry and no scopes.
