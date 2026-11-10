# ADR 0008: Links use the platform host unless a tenant tracking host is enabled

## Status

Accepted.

## Context

Branded tracking links (`track.<tenant domain>`) look better and align with the sending domain.
They need a TLS certificate for each tenant's name on the edge that serves them. CloudFront and
the load balancer in this repository carry certificates for the platform hosts only, and issuing
certificates for arbitrary customer names is an operational feature of its own.

## Decision

The domain wizard always shows a `track.<domain>` CNAME pointing at `EMAIL_TRACKING_HOST` and
verifies it, but links use `APP_PUBLIC_URL` (the platform host) **unless**
`EMAIL_TRACKING_CUSTOM_DOMAINS=true` and the domain's `tracking_status` is `VERIFIED`
([`links.ts`](../../../apps/api/src/utils/links.ts),
[`email-resolver.service.ts`](../../../apps/api/src/services/email-resolver.service.ts)). The
flag is for operators who serve those names from a proxy or distribution they control.

## Consequences

Positive:

- Links always work over HTTPS out of the box.
- An operator can opt in without a code change when certificates exist.

Trade-offs:

- By default recipients see the platform host in tracked links, which is less branded and can
  affect how filters judge the links.
- The flag is deployment-wide, not per tenant.
- A verified CNAME with no certificate would produce broken links if the flag were on, so
  the flag is off by default.

## Alternatives considered

- **Always use the tenant host.** Broken HTTPS for every tenant until certificates exist.
- **Issue certificates automatically.** Real work (ACME, storage, renewal); left to the
  operator.
