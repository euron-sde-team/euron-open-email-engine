# Operator console

The control plane of Euron Open Email Engine: create and suspend tenants, set plan
quotas and module access, watch fleet reputation, read the SES account's health and
the dead-letter queue, lift a pause with a recorded reason, and review the operator
audit trail. There is no billing.

## Pages

| Route              | What it does                                                                  |
| ------------------ | ----------------------------------------------------------------------------- |
| `/`                | Platform totals, tenants that need attention, plan distribution, recent audit |
| `/tenants`         | List, search, create, suspend and reactivate                                  |
| `/tenants/:id`     | Fleet row, usage this month against limits, domains, reputation history, manual unpause (reason required), plan and entitlement overrides |
| `/plans`           | Edit `monthlyEmails`, `maxContacts`, `maxDomains`, `maxUsers` and the email modules |
| `/fleet`           | Tenants by sending status and a sortable table by bounce and complaint rate  |
| `/account-health`  | SES mode, sandbox, sending quota, account-wide rates                          |
| `/dlq`             | Dead-letter queue depth, oldest age and a sample                              |
| `/operators`, `/audit`, `/profile` | Operator accounts, audit log, your account                    |

## Stack

React 19, Vite, TypeScript strict, react-router 7, TanStack Query 5, Zustand (persisted
sign-in), axios, Tailwind 3 with vendored Radix components. The API contract comes from
`@open-email/types`. Slate-teal accent, graphite dark theme by default, light theme from the
top bar; status is text with a colour dot, never a pill.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3660, API at VITE_API_BASE_URL
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

`VITE_API_BASE_URL` defaults to `http://localhost:5126/api/v1/operator`. Operator endpoints
used for email: `GET /email/fleet`, `GET /email/account-health`, `GET /email/dlq`,
`GET /tenants/:id/email`, `POST /tenants/:id/email/unpause` with `{ "reason": "..." }`.
Sign in as the seeded `operator@example.com` (password from `make demo`).
