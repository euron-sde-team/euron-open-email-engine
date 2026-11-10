## What and why

<!-- One paragraph: the problem, and how this change solves it. Link the issue. -->

## How it was verified

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] `make test-integration` (if API, database, jobs, SES or sending code changed)
- [ ] `make up && make demo`, then the flow tried in the app or the console (if a user flow changed)
- [ ] `make tf-validate tf-lint tf-security` (if Terraform changed)

## Checklist

- [ ] Docs updated (`docs/`, the configuration reference) for any behavior or config change
- [ ] New migration instead of editing an applied one
- [ ] Every tenant-scoped query filters by `tenant_id`, covered by a test that a second tenant cannot see or change the record
- [ ] Operator routes stay behind the operator JWT; tenant routes behind the tenant JWT and its role checks
- [ ] Public routes (`/t/*`, `/u/*`, `/f/*`, `/c/*`, `/w/*`) need no login, set no cookies, take only signed tokens or slugs, and are rate limited
- [ ] Sending respects the suppression list, the unsubscribe state, the reputation gates and the plan quota; a redirect never leaves the campaign's own links
- [ ] A new AWS call has a simulated mode, so `make up` and the tests need no account
- [ ] Signing secrets and stored credentials never reach a log line or an API response
- [ ] No secrets, account ids, real emails or hostnames (`make sanitize` is clean)
- [ ] Security-relevant change? Described the threat and mitigation above
