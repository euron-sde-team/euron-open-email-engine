# Tracking and public links

Every link an email carries points at the API root, not at `/api/v1`. They are public (no
sign-in), cookie-free, and protected by signed tokens. Code:
[`routes/public.route.ts`](../../apps/api/src/routes/public.route.ts),
[`services/tracking.service.ts`](../../apps/api/src/services/tracking.service.ts),
[`utils/tokens.ts`](../../apps/api/src/utils/tokens.ts),
[`utils/links.ts`](../../apps/api/src/utils/links.ts),
[`utils/open-classify.ts`](../../apps/api/src/utils/open-classify.ts).

## 1. Routes

| Route | Does |
| --- | --- |
| `GET /t/o/:token.gif` | Open pixel. Always answers a 1x1 transparent GIF with `Cache-Control: no-store`, even for a forged token (nothing is recorded) |
| `GET /t/c/:token` | Click redirect. 302 to the stored URL, or a 404 page |
| `GET /u/:token` | Unsubscribe confirmation page. **Changes nothing** |
| `POST /u/:token` | Unsubscribes. Also the RFC 8058 one-click endpoint (`List-Unsubscribe=One-Click`) |
| `GET /w/:token` | View in browser |
| `GET /f/:slug`, `POST /f/:slug` | Hosted subscribe form |
| `GET /c/:token` | Double opt-in confirmation |

Deployment must route these paths to the API and never cache them (the Terraform does:
[`infra/terraform/README.md`](../../infra/terraform/README.md#public-mail-paths)).

## 2. Tokens

Stateless: `base64url(kind|exp|parts...)~HMAC-SHA256`. The HMAC key is derived from the secret
with SHA-256, compared in constant time, and a token longer than 600 characters is refused. A
token carries only ids, never a destination.

| Kind | Parts | Secret | Expires |
| --- | --- | --- | --- |
| `o` open | message id | `EMAIL_TRACKING_SIGNING_SECRET` | never |
| `c` click | message id, link token | `EMAIL_TRACKING_SIGNING_SECRET` | never |
| `u` unsubscribe | tenant id, contact id, message id or `-` | `EMAIL_UNSUBSCRIBE_SIGNING_SECRET` | never |
| `w` view | message id | `EMAIL_UNSUBSCRIBE_SIGNING_SECRET` | never |
| `k` confirm | tenant id, contact id, list id | `EMAIL_UNSUBSCRIBE_SIGNING_SECRET` | 7 days |

Two secrets so that rotating one never breaks the other kind of link; both default to
`JWT_SECRET`. Rotating a secret invalidates every link already sent with it, including the
unsubscribe link in old mail, so rotate rarely and on purpose.

## 3. Click redirect

1. Verify the token (`c`, two parts).
2. Load the message; it must belong to a campaign.
3. Look the destination up in `campaign_links` by campaign, tenant and link token. **The URL is
   read from the database, never from the token or the request**, so there is no open redirect.
4. The URL must be absolute `http` or `https`, at most 2048 characters, with no credentials.
5. Record a `CLICK` event; a human click bumps `email_messages.click_count` and
   `contacts.last_clicked_at`. Answer `302` with `Cache-Control: no-store` and
   `Referrer-Policy: no-referrer`.

Anything else (bad token, unknown link, unsafe URL) is a 404 page.

## 4. Open pixel and machine opens

An open is recorded for a valid token; the message's `open_count` always increases.
`contacts.last_opened_at` is updated only for human opens. Each hit is classified
([`open-classify.ts`](../../apps/api/src/utils/open-classify.ts)) and stored with `machine` and
`ua_class`:

| `ua_class` | Rule |
| --- | --- |
| `prefetch` | A `Purpose`, `Sec-Purpose` or `X-Moz` header saying prefetch or preview, or a hit within 3 seconds of the send |
| `google-proxy`, `yahoo-proxy` | The image proxy user agent |
| `apple-mpp` | An open from an Apple `17.x.x.x` address |
| `scanner` | A known security scanner user agent (Barracuda, Proofpoint, Mimecast, Safe Links and similar) |
| `bot` | Generic bot, crawler or command-line user agents |
| `browser`, `unknown` | Everything else; counted as human |

A machine hit is **still recorded and flagged**, never dropped. Machine clicks are kept out of
`click_count`, the click rate and `last_clicked_at`. Reports show `machineOpens` so open rates
are read with care.

### Why opens are unreliable

Apple Mail Privacy Protection fetches the pixel for the user, often from addresses the rule
above does not recognise, so many opens are real fetches by no one. Image blocking hides real
opens. A client that never loads images records nothing. Treat opens as a trend, clicks as the
signal. This is stated in the reports and in [troubleshooting](../guides/troubleshooting.md#apple-mail-privacy-protection).

## 5. Unsubscribe

[ADR 0007](adr/0007-unsubscribe-by-post-only.md): a link scanner that follows every URL in a
message must not unsubscribe anyone, so `GET /u/:token` only shows a confirmation page with a
button that posts back. `POST /u/:token`:

- sets the contact `UNSUBSCRIBED` (from `SUBSCRIBED` or `PENDING_CONFIRMATION`) and stamps
  `unsubscribed_at`;
- sets every non-unsubscribed list membership to `unsubscribed`;
- adds a suppression with reason `UNSUBSCRIBE` and scope `MARKETING`, so transactional mail still
  flows;
- records an `UNSUBSCRIBE` event if the message is known, and an audit entry;
- is idempotent.

A one-click POST (`List-Unsubscribe=One-Click` in the body) answers JSON `{ "success": true }`;
a form post from the page answers an HTML confirmation. A person who later signs up again
through a form lifts their own suppression ([audience-and-segments.md](audience-and-segments.md#4-subscribe-forms)).

## 6. View in browser

`GET /w/:token` re-renders the campaign for the same contact, untracked, and serves it with
`Content-Security-Policy: default-src 'none'; img-src * data:; style-src 'unsafe-inline';
font-src *; sandbox`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. The HTML is
tenant-authored, so scripts and framing are denied outright.

## 7. Link host

Links are built on `APP_PUBLIC_URL`. When `EMAIL_TRACKING_CUSTOM_DOMAINS=true` **and** the
domain's `tracking_status` is `VERIFIED`, they use `https://track.<tenant domain>` instead.
[ADR 0008](adr/0008-platform-tracking-host-fallback.md): the default is the platform host because
TLS certificates cover only platform hosts. The wizard always shows the `track.<domain>` CNAME
(pointing at `EMAIL_TRACKING_HOST`); a verified CNAME alone changes nothing until the flag is
on and a certificate for that name is served.

## 8. Privacy

- No cookies are set on any public route.
- Client IPs are never stored: only a keyed hash (HMAC with the tracking secret, first 32 hex
  characters) in `email_events.ip_hash`.
- Forms store a hashed IP as `consent_ip_hash`.
- The user agent is reduced to a class; the raw string is not stored.

## 9. Limitations

- Tokens do not expire (except confirmation), so a forwarded email's links keep working.
- Opens are unreliable and flagged; see above.
- Links whose URL contains a merge tag are not tracked.
- A custom tracking host needs certificates this repository does not issue.
