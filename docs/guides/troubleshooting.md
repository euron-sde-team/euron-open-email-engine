# Troubleshooting

Symptoms, causes and fixes, most common first. Every error response carries a `rayId` that is
in the API log next to the stack trace: search the log for it.

## A domain is stuck in PENDING

A domain becomes `VERIFIED` when SES reports **both** DKIM and MAIL FROM as `SUCCESS`.

1. Open the domain and press **Check now**. Each record shows found or not found from a real DNS
   lookup.
2. DKIM missing: the three `<token>._domainkey.<domain>` CNAMEs must exist exactly (no trailing
   domain appended twice: many DNS hosts append the zone, so enter the name relative to the
   zone, `<token>._domainkey.mail`, if the host appends `.example.com`).
3. MAIL FROM missing: the `bounce.<domain>` MX (`10 feedback-smtp.<region>.amazonses.com`) **and**
   the `bounce.<domain>` TXT `v=spf1 include:amazonses.com ~all`. Both are required.
4. Wait: propagation takes minutes to hours. The engine re-checks every minute.
5. After 24 hours with SES reporting a failure the domain becomes `FAILED`; fix the records and
   press **Check now** again.
6. Locally: simulated mode verifies on "Check now" or after `EMAIL_DOMAIN_SIMULATE_VERIFY_MINUTES`
   with no DNS. If it does not, check the mode in Account health.
7. `That domain is already in use` (409): another tenant (or you in another workspace) owns it;
   SES identities are unique per account.
8. Records are right but SES says pending: check the **region**. SES identities are regional and
   the DKIM and MAIL FROM values use `AWS_SES_REGION`.

## A tenant cannot add a sender

A sender needs a `VERIFIED` domain. The message "The sending domain must be verified before
adding senders" means the domain is still pending.

## Mail goes to spam

Most causes are reputation and authentication, not the engine.

- Authenticate fully: DKIM and MAIL FROM `SUCCESS`, SPF and a DMARC record. View the original
  message headers: you want `dkim=pass`, `spf=pass`, `dmarc=pass`.
- A new domain or account: [warm up](connect-ses.md#7-warm-up). Large first sends from an unknown
  domain are filtered.
- Tracked links use the platform host by default, which can differ from the sending domain
  ([tracking.md](../architecture/tracking.md#7-link-host)); some filters weigh that.
- Content: all-image mail, URL shorteners, ALL CAPS and spammy phrases hurt. Add a plain-text
  part (it is generated) and a real postal address.
- List quality: old, purchased or scraped lists produce bounces and complaints. Watch the
  Reputation page.
- Check the sandbox: in the SES sandbox mail only reaches verified recipients.
- DMARC at `p=none` is fine to start; Gmail and Yahoo expect authentication and a one-click
  unsubscribe on bulk mail, which every campaign here carries.

## No opens are recorded

- Open tracking is a 1x1 image. Clients that block images record nothing.
- Test it: send yourself a campaign, open the message source, copy the `/t/o/...gif` URL and open
  it in a browser. An open should appear in the message timeline.
- The pixel URL host must be reachable by the recipient: `APP_PUBLIC_URL` must be your public
  `https` origin, and `/t/*` must route to the API and not be cached
  ([deploy-aws.md](deploy-aws.md#5-dns-and-mail)).
- Recipients' clients can fetch the pixel for them (see below), which inflates opens instead of
  hiding them.
- A **test send** has no tracking pixel tied to a campaign contact; check a real campaign.

## Apple Mail Privacy Protection

Apple Mail with Mail Privacy Protection downloads the pixel through Apple's proxy when mail
arrives, whether or not the person reads it. Many opens are therefore automatic. The engine
flags what it can recognise (`machine`, class `apple-mpp`, `google-proxy`, `prefetch`, scanners
and bots) and keeps those out of the "last opened" date and click counters, but it cannot recognise
every proxied open. Opens are unreliable: use them as a rough trend and prefer **clicks**
(`clicked_in_days` segments, the click rate) to judge engagement. The campaign report shows a
`machineOpens` count so you can see how much of the open rate is suspect.

## A campaign will not send: quota refused

`QUOTA_EXCEEDED` in the preflight, or 422 "This campaign needs N emails but M remain this month",
means the sendable audience is larger than what the plan has left this month (UTC). Options: send
to a smaller audience, wait for the 1st (00:00 UTC), or the operator raises the quota
(plan change, or an entitlement override of `limit.monthly_emails`). The counts exclude
unsubscribed, bounced, complained, pending and suppressed contacts.

If a campaign starts and later skips recipients with `OVER_QUOTA`, another campaign used the
quota meanwhile. Recipients skipped for quota are not retried automatically.

## A campaign is PAUSED

Read `pausedReason` on the campaign:

| Reason | Cause | Fix |
| --- | --- | --- |
| `Paused by a user` | Someone pressed Pause | Resume |
| `Tenant sending paused` | Reputation reached `PAUSED` (bounce or complaint rate over the pause tier) | Clean the list; the operator lifts the restriction ([operations.md](operations.md#reputation-pause-and-unpause)); then resume |
| `Sender or domain not verified` | The sender was archived, or the domain became `FAILED` or was removed | Fix the domain or choose another sender; edit is not allowed while `PAUSED`, so duplicate the campaign if the sender must change |
| An error message on a campaign that was `SCHEDULED` | It could not start at its time (domain lost, tenant paused, quota) | Fix the cause, then press Resume or reschedule |

Resume is refused (422) while the sender is unverified or the tenant is `PAUSED`.

## Recipients show FAILED

A `FAILED` recipient means the SES call failed (or SES rejected). Common causes: still in the SES
**sandbox** (recipient not verified), the sender address is not allowed, an SES permission is
missing, or the region is wrong. The message detail shows the `error`. After fixing, duplicate the
campaign for the failed recipients (a `FAILED` recipient is not retried).

## Events never arrive: delivery stays SENT

Messages stay `SENT` and never become `DELIVERED` or `BOUNCED`.

1. API log: `SES events consumer started` should appear. `SES events consumer idle` means
   `SES_EVENTS_QUEUE_URL` is unset.
2. The tenant's configuration set must publish to the topic. The API attaches the destination
   when the tenant adds the domain and again on every "Check now" or verify-job pass while
   `SES_EVENTS_SNS_TOPIC_ARN` is set. Press "Check now" on the domain, or add the destination manually ([connect-ses.md](connect-ses.md#3-the-events-pipeline)).
3. The topic policy must let SES publish and the queue policy must let the topic send.
4. Console, Dead-letter queue: depth above zero means events arrive but fail to process.
5. Logs: `SES event ... without messageId/tenantId tags, skipping` means mail not sent by this
   engine.

## Imports skip rows or fail

The import detail lists up to 100 errors: `Missing email`, `Invalid email address`,
`Duplicate of row N in this file; kept the first`, `Contact limit of your plan reached`. A file over
10 MB or 100,000 rows is refused: split it. "Map exactly one column to email" means the mapping
needs one email column. Suppressed addresses are imported as unsubscribed, bounced or complained,
never as subscribers; this is by design.

## A contact cannot be re-subscribed

`BOUNCED` and `COMPLAINED` contacts cannot be set `SUBSCRIBED` (409). A person who unsubscribed can
sign up again through a form, which lifts their own unsubscribe. An admin can remove a suppression
entry, which does not change the contact's status.

## Unsubscribe link does nothing

`GET /u/:token` only shows a confirmation page; the person must press the button (a POST). This
is deliberate: link scanners must not unsubscribe anyone
([ADR 0007](../architecture/adr/0007-unsubscribe-by-post-only.md)). If the page says the link is
invalid, the signing secret changed since the mail was sent.

## Links in mail are broken

- `APP_PUBLIC_URL` must be the public origin of the API (it builds every link). A value of
  `localhost` in a real deployment produces links nobody else can open; production refuses it.
- Rotating `EMAIL_TRACKING_SIGNING_SECRET` or `EMAIL_UNSUBSCRIBE_SIGNING_SECRET` breaks links in
  mail already sent.
- `/t /u /w /f /c` must reach the API through CloudFront and the load balancer.

## Sign-in and tenant problems

- "Invalid or expired token": the token lasts `JWT_EXPIRY` (12 hours); sign in again.
- "This workspace is suspended": the operator suspended it.
- "The <module> module is not included in this workspace's plan" (403): the plan lacks it; the
  operator can override the entitlement or move the tenant.
- "Workspace ... limit reached" (403): a plan limit (users, domains, contacts); same fix.
- Locked out after too many attempts: wait for the rate limit window (5 minutes for sign-in).
- Forgot password mail missing: platform mail goes through `AWS_SES_FROM_EMAIL`; if it is unset it
  is only logged. Locally read it in Mailpit.

## Production refuses to start

The error lists each problem: a development or short secret, `CORS_ORIGINS` empty,
`EMAIL_SES_MODE` not set to `aws`, or an `APP_PUBLIC_URL` that is not a public `https` origin
([configuration.md](configuration.md#production-guard)).

## Local stack

- A port is taken: change the `EMAIL_*_PORT` variable and `make up` again.
- Mail does not appear in Mailpit: check that the `floci` and `mailpit` services are up
  (`make ps`) and that the API's mode is `aws` (the Floci overlay), not `simulated`.
- Fresh start: `make down` removes the volumes, then `make up` and `make demo`.
- The apps show a stale API URL: the URL is baked in at build time; rebuild with `make up`.
