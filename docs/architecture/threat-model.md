# Threat model

A STRIDE pass over the system in [HLD.md](HLD.md). Controls are described in
[security.md](security.md); this page lists what could go wrong, what stops it, and what
remains.

## Assets

| Asset | Why it matters |
| --- | --- |
| The shared SES account and its reputation | One bad tenant can get every tenant's mail filtered, or the account suspended |
| Tenant audiences (emails, names, attributes) | Personal data; a leak is a breach for the tenant and for the operator |
| Tenant isolation | The core promise of a multi-tenant product |
| Sender identity | Mail from a tenant's domain is trusted by its recipients |
| Signing secrets | They protect every link in every email already sent |

## Actors

Anonymous internet; a recipient or a mail scanner; a malicious tenant user; a tenant admin
with a compromised account; an operator account; someone with access to the database or the
AWS account (out of scope).

## Spoofing

| Threat | Control | Residual |
| --- | --- | --- |
| Forging a tenant or operator token | HS256 with a 32+ character secret enforced at boot; the two token types are not interchangeable | A leaked `JWT_SECRET` forges any token |
| Credential stuffing | Per-IP and per-email limits; generic errors | No 2FA; operator timing difference |
| Forged tracking, unsubscribe or confirmation links | HMAC-signed, constant-time compare, separate secrets | Links do not expire |
| A tenant sending as a domain it does not own | The domain is verified with DKIM and MAIL FROM through SES before any sender exists; domains are unique across tenants | A tenant could add a domain it controls but that imitates a brand (lookalike); no content review |

## Tampering

| Threat | Control | Residual |
| --- | --- | --- |
| Changing the destination of a tracked link | The destination is read from the database by link token, not from the URL | |
| Replaying SES events | Unique index on `(message, type)`; effects run once | |
| Editing an applied migration | Checksums; the runner refuses | |
| Header injection through merge data | Values reach only the body and subject; line breaks stripped | |
| SQL injection through segment rules | Field allowlist, bound parameters | |

## Repudiation

Tenant actions are written to `audit_logs` and operator actions to `operator_audit_logs`
(unpause requires a reason). Sign-in and sign-out are recorded with IP and user agent.
Residual: records are written after the change and are not tamper-evident.

## Information disclosure

| Threat | Control | Residual |
| --- | --- | --- |
| Reading another tenant's data | `tenant_id` on every query; 404 for foreign ids; cross-tenant tests | A missed filter in new code, so every endpoint needs a test |
| Account enumeration through forms, sign-in, forgot password | Uniform answers; dummy hash on tenant and operator sign-in | None known |
| Recipient IPs | Stored only as a keyed hash | |
| Token in `localStorage` | No tenant HTML runs in the app origin (sandboxed previews) | XSS in the app would expose it |
| Logs | Passwords, tokens and secrets are not logged | Recipient addresses appear in some warnings |
| Local file links | HMAC-signed, expiring | |

## Denial of service

| Threat | Control | Residual |
| --- | --- | --- |
| Flooding public links or forms | Per-IP and per-form limits; WAF rate rule | Mail proxies share addresses, so tracking limits are generous (3000 per minute) |
| A heavy segment rule | 3 second statement timeout on counts | A heavy rule at send start runs without that timeout inside the snapshot (bounded by the 30 second pool statement timeout) |
| A huge import or export | 10 MB, 100,000 rows, 500-row chunks | |
| One tenant starving others | Per-tenant TPS plus account TPS; monthly quota | `tenants.config.emailTps` can only be set by an operator in the database; tenants cannot write it |
| Redis outage | Rate limits fail open for HTTP; the send limiter allows sends | An outage removes the TPS cap, so SES throttling is the backstop |
| Queue backlog | Claims expire after 5 minutes; jobs retry with backoff | |

## Elevation of privilege

| Threat | Control | Residual |
| --- | --- | --- |
| A marketer reaching governance | `requireCapability` per route; roles read from the database each request | |
| A manager promoting themselves | Only ADMIN may assign or edit elevated roles | |
| A tenant token on the operator plane | Separate token type and middleware | |
| Granting itself a module | Module entitlements are written only by the operator plane | |
| Stored XSS through campaign HTML | Pattern sanitiser, sandboxed preview, CSP on the public view page | The sanitiser is not a parser |

## Abuse specific to an email platform

| Threat | Control | Residual |
| --- | --- | --- |
| Spam from a tenant | Verified domain required; reputation gate; monthly quota; unsubscribe and List-Unsubscribe on every campaign; postal address warning; import consent confirmation | No content scanning, no proof of consent per contact |
| Mailing suppressed or bounced addresses | Suppression checked per message; imports never revive; forms never reactivate | |
| An open redirect for phishing | Destinations come only from the campaign's own stored links | A tenant can still link to anything in its own mail |
| Link scanners unsubscribing people | POST-only unsubscribe | |
| Tracking as surveillance | No cookies, hashed IPs, user agent reduced to a class | Open tracking is inherently an image beacon |

## Out of scope

A compromised host or AWS account, leaked deployment secrets, physical access, and what
workspace admins and operators can already do by design.
