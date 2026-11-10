# Simulated providers

The whole product runs, and the whole test suite runs, with no AWS account
([ADR 0006](adr/0006-simulated-providers.md)). There are two levels: the **simulator** built into
the SES client, and **Floci**, an AWS emulator that speaks the real wire protocol.

## 1. The mode switch

[`email-ses.client.ts`](../../apps/api/src/services/email-ses.client.ts) decides at boot:

| Condition | Mode |
| --- | --- |
| Under test (`NODE_ENV=test` or Vitest) | Always simulated, even if keys are configured |
| `EMAIL_SES_MODE=simulated` | Simulated |
| `EMAIL_SES_MODE=aws` | Live SES client (real SES, or Floci through `AWS_ENDPOINT_URL`) |
| Unset | Live when `AWS_SES_FROM_EMAIL` is set, else simulated |

Production refuses to start unless `EMAIL_SES_MODE=aws` is set. The boot log says which mode is
active, and `email_messages.simulated` records it per message.

## 2. What the simulator does

| Area | Behaviour |
| --- | --- |
| Domain onboarding | Deterministic fake DKIM tokens derived from the domain; the same record table as real SES |
| Verifying | "Check now" verifies the domain with no DNS. A pending domain also verifies itself `EMAIL_DOMAIN_SIMULATE_VERIFY_MINUTES` (default 2) minutes after creation; `0` means only on "Check now". Before that, the real DNS lookups still run so the `found` flags are honest |
| Sending | No network call. The message row is written with id `sim_...` and `simulated = true`; the `SEND` event is recorded |
| Outcomes | The simulator then reports the result **through the same handler SES events use** ([`email-events.service.ts`](../../apps/api/src/services/email-events.service.ts)), so contacts, suppressions, campaign counters and reputation react exactly as they do for real events |
| Account health | A fixed account: sending enabled, not in the sandbox, 50,000 per 24 hours, 14 per second |
| Platform mail | Invites and password resets are logged, not sent |
| Configuration sets | Named `email-tenant-<tenantId>`; nothing is created |

The outcome is chosen by the local part of the recipient address:

| Address | Outcome |
| --- | --- |
| `bounce@anything` | Hard bounce (`Permanent`): contact `BOUNCED`, suppression, reputation evaluated |
| `soft@anything` | Soft bounce (`Transient`) |
| `complaint@anything` | Delivery, then a complaint: contact `COMPLAINED`, suppression |
| anything else | `DELIVERY` |

**Opens and clicks are never simulated.** They come only from real hits on the tracking
links, so you can open the pixel URL or follow a link yourself. (The demo seed fabricates
historical opens and clicks directly in the database so the reports have something to show.)

To see reputation tiers move locally, import enough `bounce@...` contacts, send, and watch the
status go to `PAUSED`; lower `EMAIL_REPUTATION_MIN_SENDS` to trip it with few messages.

## 3. Floci

`make up` starts [Floci](https://github.com/floci-io/floci) (port 4677), a free AWS emulator, and
a one-shot Terraform container applies [`infra/terraform/envs/local-floci`](../../infra/terraform/envs/local-floci)
against it: the same modules as production create the KMS key, the app secret, the file bucket,
the platform SES identity with DKIM, and the SNS topic, SQS queue and dead-letter queue for SES
events. The API then runs with `EMAIL_SES_MODE=aws` and `AWS_ENDPOINT_URL` pointed at Floci:

- SES v2 calls (identities, configuration sets, `SendEmail`) are real API calls to the emulator,
  which relays every message to **Mailpit** (http://localhost:8126). You can read the actual
  rendered email.
- Per-tenant configuration sets publish to the emulated SNS topic and the API long-polls the SQS
  queue behind it, so the events path runs end to end.
- Against an emulator there is no real DNS, so domain checks trust the SES status instead of
  looking records up.

What Floci does not reproduce: SES sandbox rules, send quotas, real bounces and complaints,
reputation. Test those on real SES ([connect-ses.md](../guides/connect-ses.md)).

## 4. Rules every simulated path follows

- **Honest.** Simulated messages are marked and never reported as anything else.
- **Same shape.** Callers do not branch on the mode; the client returns the same result type.
- **Deterministic.** Fake DKIM tokens derive from the domain so tests can assert on them.
- **Visible.** The console's Account health shows `mode: simulated`.

## 5. Limitations

- Simulation lives inside the production client. A wrong `EMAIL_SES_MODE` outside production
  silently simulates; production refuses both `simulated` and an unset mode, so a
  production deployment must set `EMAIL_SES_MODE=aws`.
- The simulator does not reproduce provider behaviour (rate limits, sandbox limits, content
  filtering, suppression lists on the AWS side).
- Complaint and soft-bounce flows are one-shot; there are no delivery delays.
