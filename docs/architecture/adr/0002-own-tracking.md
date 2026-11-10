# ADR 0002: Own pixel and redirect tracking

## Status

Accepted.

## Context

Opens, clicks and per-link statistics are expected from an email product. SES can publish open
and click events, but only by rewriting links through an AWS host and without the context the
product needs (flagging machine opens, per-campaign link tables, contact timelines).

## Decision

The engine tracks engagement itself: a 1x1 GIF at `/t/o/:token.gif` and a redirect at
`/t/c/:token`, served by the API ([`public.route.ts`](../../../apps/api/src/routes/public.route.ts),
[`tracking.service.ts`](../../../apps/api/src/services/tracking.service.ts)). SES open and click
events are ignored.

- Tokens are HMAC-signed and carry ids only. The click destination is read from
  `campaign_links`, so there is no open redirect.
- No cookies. IPs are stored as a keyed hash.
- Hits are classified (Apple Mail Privacy Protection, image proxies, scanners, prefetch) and
  stored with `machine` set; machine hits are kept but excluded from human counters.
- Links whose URL contains a merge tag are not tracked, because the destination must be known
  ahead of time.

## Consequences

Positive:

- Recipient behaviour stays in the operator's database; no third party sees it.
- Per-link and per-contact history, and machine-open flagging, are possible.

Trade-offs:

- **Opens are unreliable** (Apple Mail Privacy Protection, image blocking). They are recorded and
  flagged, never presented as exact.
- The API must be reachable and fast for every email open and click, and the paths must not be
  cached ([`infra/terraform/README.md`](../../../infra/terraform/README.md#public-mail-paths)).
- Tokens do not expire, so forwarded mail keeps working, and a signing-secret rotation breaks
  every link already sent.
- Link host and TLS: see [ADR 0008](0008-platform-tracking-host-fallback.md).

## Alternatives considered

- **SES open and click tracking.** Less code, but links go through an AWS-owned host, and there is
  no machine-open flagging or per-link table.
- **A third-party tracker.** Sends recipient behaviour to another company.
