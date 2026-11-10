# Connect Amazon SES

How to go from the local simulator to real mail through your own Amazon SES account: verify
the platform identity, wire the event pipeline, leave the sandbox, publish DNS for a tenant
domain, and warm up. Read [../architecture/sending-pipeline.md](../architecture/sending-pipeline.md)
first if you want the model.

If you deploy with the Terraform in this repository ([deploy-aws.md](deploy-aws.md)), steps 2 to
4 are done for you; this guide then explains what it built and what is left (production access,
DNS, warm-up).

## What the engine does in SES

| Object | Created by | Name |
| --- | --- | --- |
| Platform identity (domain) with DKIM and custom MAIL FROM | Terraform, or you | `AWS_SES_FROM_EMAIL` domain |
| One **configuration set** per tenant | The API, when a tenant adds its first domain | `email-tenant-<tenantId>` |
| An event destination on each configuration set, publishing to SNS | The API | `sns-fanout` (SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT) |
| One **domain identity** per tenant sending domain, with DKIM (RSA 2048) and a custom MAIL FROM `bounce.<domain>` | The API | the tenant's subdomain |
| SNS topic, SQS queue, dead-letter queue | Terraform, or `ses-infra-setup.ts` | `...-ses-events` |

The API never sends from a platform address for tenant mail: a campaign goes out from a
sender on the tenant's own verified domain, through that tenant's configuration set, with the
tags `tenantId`, `messageId`, `category` and `campaignId`. The events consumer finds the
message by those tags.

## 1. Prerequisites

- An AWS account and a region where SES is available. Use the same region everywhere
  (`AWS_SES_REGION`); SES identities are regional.
- A domain you control for the platform sender (for example `mail.example.com`), and access to
  its DNS.
- The API's AWS credentials: on ECS, the task role (Terraform grants it); elsewhere
  `AWS_SES_ACCESS_KEY` and `AWS_SES_SECRET_KEY`.

## 2. Verify the platform identity

The platform sender (`AWS_SES_FROM_EMAIL`, for example `no-reply@mail.example.com`) sends
invites, password resets and operator mail. In the SES console, SES, Configuration, Identities,
create a **domain** identity for `mail.example.com` with Easy DKIM (RSA 2048), and enable a
custom MAIL FROM domain `bounce.mail.example.com`. Publish the records SES shows (below). When
the identity shows **Verified**, set `AWS_SES_FROM_EMAIL` and `EMAIL_SES_MODE=aws`.

Terraform does this in [`modules/email`](../../infra/terraform/modules/email) and can create the
records in Route 53 when you pass `route53_zone_id`.

## 3. The events pipeline

SES publishes delivery events to SNS, SNS fans out to SQS, and the API long-polls the queue:

```text
tenant configuration set -> SNS topic -> SQS queue (raw delivery) -> API consumer
                                              \-> dead-letter queue after 5 receives
```

1. Create the SNS topic and an SQS queue subscribed to it with **raw message delivery**, a
   queue policy that lets the topic send, a topic policy that lets `ses.amazonaws.com` publish
   (restricted to your account), and a dead-letter queue with `maxReceiveCount` 5. Either use
   [`modules/email`](../../infra/terraform/modules/email) or run
   `pnpm --filter @open-email/api exec tsx scripts/ses-infra-setup.ts`, which creates them
   idempotently and prints the values to set.
2. Set `SES_EVENTS_SNS_TOPIC_ARN`, `SES_EVENTS_QUEUE_URL` and `SES_EVENTS_DLQ_URL`
   ([configuration.md](configuration.md#aws)).
3. Restart the API. The log line `SES events consumer started` confirms it.

The API attaches the SNS event destination to a tenant's configuration set when the tenant adds a
domain, and re-ensures it on every "Check now" and every pass of the verify job while
`SES_EVENTS_SNS_TOPIC_ARN` is set. For a domain added before the topic existed, press "Check now"
once.

## 4. IAM

The API's role needs, in the SES region: `ses:SendEmail` and `ses:SendRawEmail` on the
identities and configuration sets; `ses:CreateEmailIdentity`, `DeleteEmailIdentity`,
`GetEmailIdentity`, `PutEmailIdentityMailFromAttributes`, `PutEmailIdentityDkimAttributes`,
`PutEmailIdentityConfigurationSetAttributes`, `TagResource`; `ses:CreateConfigurationSet`,
`CreateConfigurationSetEventDestination`, `GetConfigurationSet`, `DeleteConfigurationSet`,
`PutConfigurationSetSendingOptions`, `PutConfigurationSetReputationOptions`; `ses:GetAccount`; and
on the events queues `sqs:ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`,
`GetQueueAttributes`, `GetQueueUrl`. The exact policy is in
[`modules/deployment`](../../infra/terraform/modules/deployment/main.tf).

## 5. Move out of the sandbox

A new SES account is in the **sandbox**: you can send only to addresses you verified, at a low
daily quota and one message per second. A campaign to real recipients fails there (the
recipients show `FAILED`).

1. In the SES console open **Account dashboard** and choose **Request production access**.
2. Fill in the form honestly: the mail type (marketing, transactional), your website, how you
   collect addresses (hosted forms with double opt-in, CSV imports with a consent
   confirmation), how you handle bounces and complaints (automatic suppression, the reputation
   gate in this engine), and that every campaign carries an unsubscribe link and a one-click
   `List-Unsubscribe` header. Give realistic volumes.
3. Wait for AWS (typically about a day). Then set `EMAIL_ACCOUNT_TPS` to the maximum send rate
   the dashboard shows, and check the daily quota against your plans' `monthlyEmails`.
4. The console's **Account health** page reads `GetAccount` and shows the sandbox flag, the
   quota and the send rate.

Until then, verify a few recipient addresses as identities in SES to test with real inboxes.

## 6. DNS for a tenant domain

When a tenant adds `mail.example.com` the wizard shows these records
([`email-dns.ts`](../../apps/api/src/utils/email-dns.ts)). Publish them at the company that hosts
the DNS for the domain; they usually appear within minutes and can take hours.

| Purpose | Type | Name | Value | Required |
| --- | --- | --- | --- | --- |
| DKIM (three records) | CNAME | `<token>._domainkey.mail.example.com` | `<token>.dkim.amazonses.com` | Yes |
| MAIL FROM | MX | `bounce.mail.example.com` | `10 feedback-smtp.<region>.amazonses.com` | Yes |
| MAIL FROM | TXT | `bounce.mail.example.com` | `v=spf1 include:amazonses.com ~all` | Yes |
| SPF | TXT | `mail.example.com` | `v=spf1 include:amazonses.com ~all` | Recommended |
| DMARC | TXT | `_dmarc.mail.example.com` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@mail.example.com` | Recommended |
| Tracking | CNAME | `track.mail.example.com` | the platform's `EMAIL_TRACKING_HOST` | Optional (see [tracking.md](../architecture/tracking.md#7-link-host)) |

Notes:

- The domain goes `VERIFIED` when SES reports **both** DKIM and MAIL FROM as `SUCCESS`. SPF,
  DMARC and the tracking CNAME are shown with a found or not found flag but do not gate
  verification.
- Use a **subdomain** (`mail.`, `news.`), not the apex, so your reputation is separate from
  your main domain's mail. An apex domain is accepted, but a dedicated subdomain is recommended.
- SPF merges: if the name already has an SPF record, add `include:amazonses.com` to it, never
  publish two SPF records. The checker looks for the include, not an exact match.
- The MAIL FROM domain makes SPF align with the From domain, which DMARC needs.
- Start DMARC at `p=none` and read the reports, then move to `quarantine` and `reject` once
  everything that sends as the domain is aligned. A DMARC policy at `reject` is what Gmail and
  Yahoo reward for bulk senders.
- A domain that stays `PENDING` for more than 24 hours with a failed status from SES becomes
  `FAILED`; fix the records and press **Check now**.

## 7. Warm-up

A new domain and a new SES account have no reputation. Mailbox providers watch how you start.

- Begin with your **most engaged** contacts (people who just signed up or clicked recently):
  a segment on `clicked_in_days` is a good start.
- Send a few hundred in the first days and roughly double the volume every few days while bounces
  stay under about 2 percent and complaints under 0.05 percent. Do not send a large list on day
  one.
- Spread sends over time; the per-tenant TPS settings and scheduling help.
- Keep the list clean: use double opt-in on public forms, never import purchased lists, remove
  hard bounces (automatic) and consider removing people who never open and never click after
  several campaigns.
- Send a consistent cadence from consistent senders. Authenticate fully (DKIM, MAIL FROM, SPF,
  DMARC).
- Watch the tenant's Reputation page and the console's Fleet page. The engine pauses marketing
  at 5 percent bounces or 0.1 percent complaints, before SES's own review.

A dedicated IP (an SES add-on) is optional and needs its own warm-up plan; it is not managed by
this engine.

## 8. Verify end to end

1. Console, Account health: `mode: aws`, `sandbox: false`.
2. Add a domain as a tenant, publish the DNS, press **Check now**: `VERIFIED`.
3. Add a sender, **Send a test** to your own mailbox: it arrives with DKIM passing (check the
   original message headers for `dkim=pass` and `spf=pass`).
4. Send a small campaign to yourself and a colleague. The report shows delivery within seconds,
   which proves the SNS to SQS path; a delivery that never shows means the events path is not
   wired ([troubleshooting.md](troubleshooting.md#events-never-arrive-delivery-stays-sent)).
5. Click a link and open the mail: click and open events arrive from the API itself.

## 9. Limitations

- One SES account and region per deployment; all tenants share its quota and reputation.
- The engine reads only the SES events for its own configuration sets. Mail sent by other
  systems in the same account is not seen.
- The daily SES sending quota is not compared with the plans' quotas anywhere; the console shows
  both and the operator keeps them consistent.
