# ADR 0007: Unsubscribe changes state by POST only

## Status

Accepted.

## Context

Corporate mail security and some clients fetch every link in a message to scan it. If
`GET /u/:token` unsubscribed the contact, a scanner would unsubscribe people who never asked,
silently shrinking tenants' audiences. RFC 8058 defines a one-click unsubscribe over POST for
exactly this reason.

## Decision

`GET /u/:token` only renders a confirmation page with a button; it changes nothing.
`POST /u/:token` unsubscribes: the contact becomes `UNSUBSCRIBED`, list memberships become
`unsubscribed`, and a suppression with reason `UNSUBSCRIBE` and scope `MARKETING` is added, so
transactional mail still flows. Every campaign message carries `List-Unsubscribe` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so mailbox providers' own unsubscribe button
posts directly. The route is idempotent and rate limited
([`public.route.ts`](../../../apps/api/src/routes/public.route.ts)).

## Consequences

Positive:

- Scanners cannot unsubscribe anyone.
- Gmail, Yahoo and Apple one-click unsubscribe work.

Trade-offs:

- A human needs one extra click on the hosted page.
- A browser that cannot POST (no JavaScript is needed: it is a plain form) is the only failure
  mode.

## Alternatives considered

- **Unsubscribe on GET.** One click less, silent audience loss.
- **A signed GET with a human-detection heuristic.** Fragile; the POST is simple and standard.
