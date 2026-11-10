# Security architecture

The controls Euron Open Email Engine relies on, where each lives in the code, and what it does not
cover yet. The STRIDE analysis is [threat-model.md](threat-model.md). How to report a
vulnerability: [SECURITY.md](../../SECURITY.md). Paths are relative to the repository root.

## 1. Authentication

| Control | Where | Detail |
| --- | --- | --- |
| Password hashing | [`services/auth.service.ts`](../../apps/api/src/services/auth.service.ts), [`services/users.service.ts`](../../apps/api/src/services/users.service.ts) | bcrypt, cost 12 |
| Password length | same, and [`services/operator/auth.service.ts`](../../apps/api/src/services/operator/auth.service.ts) | At least 8 characters on reset and change; no other policy |
| Tenant sign-in | `auth.service.ts` | Email and password. An email may exist in several workspaces: every candidate is compared and a fully active account is preferred. An unknown email still pays one bcrypt comparison against a dummy hash, so timing does not reveal whether an account exists |
| Operator sign-in | `operator/auth.service.ts` | Generic message, but an unknown email returns **without** a bcrypt comparison, so timing can reveal an operator address (limitation) |
| Generic answers | both | `Invalid email or password` for unknown email and wrong password alike. Forgot password always answers success |
| Brute force | [`middlewares/rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts) | Sign-in 10 per 5 min per IP and 5 per 5 min per email; forgot password 5 per 15 min per IP and 3 per email; reset 10 per 15 min per IP. Same on the operator plane |
| Password reset | [`utils/jwt.util.ts`](../../apps/api/src/utils/jwt.util.ts) | A JWT valid 1 hour, signed with `JWT_SECRET` plus the user's current password hash, so it stops verifying once the password changes: single use without a table |
| Invitations and operator onboarding | `users.service.ts`, [`utils/password.ts`](../../apps/api/src/utils/password.ts) | With no password given, a 14-character CSPRNG password is generated and emailed in clear; the member is expected to change it |
| Account and workspace status | [`middlewares/auth.middleware.ts`](../../apps/api/src/middlewares/auth.middleware.ts) | Every request reloads the user joined to its tenant: a user not `ACTIVE` gets 401, a tenant not `ACTIVE` gets 403 |

There is no two-factor authentication in 0.1.

## 2. Tokens

- HS256 JWTs signed with `JWT_SECRET`, valid `JWT_EXPIRY` (12 hours by default).
- Tenant tokens carry `{ id, tenantId, role, type: "tenant" }`; operator tokens
  `{ id, role, type: "operator" }`. Each verifier refuses the other type.
- The role in the token is not trusted: the role and permissions are read from the database on
  every request.
- Sign-out records an audit event; there is no server session to destroy, so a token stays valid
  until it expires.
- Both SPAs keep the token in `localStorage` (Zustand persist). No cookie is used anywhere, so
  there is no CSRF surface, and any script running in the page could read the token. The apps
  render no tenant HTML outside a sandboxed iframe.

## 3. Authorisation

Two gates on every module route, in order: what the tenant bought (entitlement), then what the
user's role allows ([rbac.md](rbac.md)). Setup and administration routes use governance
capabilities (`channels`, `team`, `settings`). Elevated roles can only be changed by an ADMIN.
Operator writes need `SUPERADMIN`.

## 4. Tenant isolation

- One schema; every tenant table has `tenant_id` and every query filters on it
  ([ADR 0003](adr/0003-tenant-scoped-everything.md)). The tenant comes from the verified token and
  the user row, never from input.
- Another tenant's record answers 404 exactly like a missing one.
- Public routes bind to one tenant through what the signed token names (message, contact, form).
- Cross-tenant tests: [`tests/api/tenancy.test.ts`](../../apps/api/tests/api/tenancy.test.ts).

Deliberately global: sending domains and form slugs are unique across tenants
([multi-tenancy-and-entitlements.md](multi-tenancy-and-entitlements.md#2-shared-schema)).

## 5. Public endpoints

| Control | Detail |
| --- | --- |
| Signed tokens | HMAC-SHA256, constant-time compare, ids only, no destination in the token ([tracking.md](tracking.md#2-tokens)) |
| No open redirect | The click destination is read from `campaign_links`, must be `http` or `https`, at most 2048 characters, no credentials |
| Unsubscribe by POST | A GET only shows a page; link scanners cannot unsubscribe anyone ([ADR 0007](adr/0007-unsubscribe-by-post-only.md)) |
| Forms | Honeypot, per-IP and per-form rate limits, email validation, uniform answers that do not reveal whether an address exists |
| Rate limits | Tracking 3000 per minute per IP, other public links 120, forms 20 per 10 minutes per IP ([LLD.md](LLD.md#4-rate-limits)) |
| Privacy | No cookies; client IPs stored only as a keyed hash; the user agent reduced to a class |
| View in browser | Locked-down CSP (`default-src 'none'`, `sandbox`), `X-Frame-Options: DENY`, `no-store` |
| Error pages | The same invalid-link page for every token failure |

## 6. Content safety

Tenant-authored HTML reaches recipients and a few browsers:

- [`render.ts`](../../apps/api/src/utils/render.ts) removes `script`, `iframe`, `object`,
  `embed`, `applet`, `base`, `meta http-equiv`, inline `on...` handlers and `javascript:`,
  `vbscript:`, `data:text/html` URLs, and HTML-escapes every merge-tag value. It is a
  pattern-based filter, not a full HTML parser, so treat it as defence in depth, not a sandbox.
- The app previews HTML in a sandboxed iframe; the public view-in-browser page has a CSP that
  forbids scripts and framing.
- Email headers: subjects have line breaks removed, display names have quotes and line breaks
  removed, sender local parts and reply-to addresses are validated. Header injection through
  merge data is not possible because values only reach the body and subject.
- CSV export prefixes formula-leading cells; CSV import is bounded in size, rows and columns.
- Segment rules compile to parameterised SQL from an allowlist
  ([audience-and-segments.md](audience-and-segments.md#evaluation)).

## 7. Secrets and configuration

| Secret | Purpose | If it leaks or changes |
| --- | --- | --- |
| `JWT_SECRET` | Tenant and operator tokens, reset links, local file links | Anyone could mint tokens; changing it signs everyone out |
| `EMAIL_UNSUBSCRIBE_SIGNING_SECRET` | Unsubscribe, view and confirmation links | Forged unsubscribes; changing it breaks every link already sent |
| `EMAIL_TRACKING_SIGNING_SECRET` | Open and click links, hashed IPs | Forged opens and clicks; changing it breaks old tracking links |
| SES credentials | Task role in AWS; static keys only for emulators | Standard AWS rotation |

`assertProductionConfig` refuses to boot in production with a development or short (under 32
characters) secret, without `CORS_ORIGINS`, without `EMAIL_SES_MODE=aws` set explicitly, or with an
`APP_PUBLIC_URL` that is not an `https` public origin
([configuration](../guides/configuration.md#production-guard)). Never logged: passwords,
tokens, secrets. Recipient addresses do appear in warning logs when a send fails.

## 8. Infrastructure controls (Terraform)

Private subnets for the database and cache, an ALB reachable only through CloudFront (a secret
origin header), TLS everywhere, KMS for secrets and queues, Secrets Manager for the app secrets,
WAF with the managed common and known-bad-inputs rule sets and a per-IP rate rule that exempts
the public mail paths, least-privilege task role (SES identity and configuration-set actions,
SQS receive on the events queue, S3 on the bucket). See [deploy-aws.md](../guides/deploy-aws.md).

## 9. Limitations

- Bearer tokens are not revocable before they expire (12 hours); sign-out only records an audit
  event. Suspending a user or tenant takes effect on the next request, because the database is
  read each time.
- No two-factor authentication, no SSO, no password policy beyond length.
- The HTML sanitiser is pattern-based.
- Link tokens do not expire (except confirmation), and there is no per-token revocation.
- Audit entries are written after the change and are not tamper-evident.
- Failure logs include recipient addresses.
