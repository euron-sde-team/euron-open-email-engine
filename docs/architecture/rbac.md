# Roles and access

Who may do what inside a tenant, and how that combines with the plan. Paths are relative to the
repository root; the keys and roles are defined in
[`apps/api/src/constants/modules.const.ts`](../../apps/api/src/constants/modules.const.ts).

## 1. Access keys

Nine keys, in two groups.

**Feature modules** (gated by the plan **and** the role):

| Key | Covers |
| --- | --- |
| `audience` | Contacts, custom fields, lists, segments, subscribe forms, imports |
| `templates` | Templates and the starter gallery |
| `campaigns` | Compose, schedule, send, pause, cancel, preview, test, reports |
| `analytics` | The dashboard |
| `email` | Message log, suppressions, sending reputation |
| `audit` | The tenant audit log |

**Governance capabilities** (role only, every workspace has them whatever its plan):

| Key | Covers |
| --- | --- |
| `channels` | Sending domains and sender identities (writes) |
| `team` | Invite, edit and remove users, manage roles |
| `settings` | Workspace name, colour, time zone, footer address |

## 2. Built-in roles

| Role | Access |
| --- | --- |
| `ADMIN` | Everything (`*`) the plan includes, plus all governance capabilities |
| `MANAGER` | All feature modules plus `channels` and `team`; not `settings` |
| `MARKETER` | `audience`, `templates`, `campaigns`, `analytics`, `email` |
| `ANALYST` | `analytics`, `email` |

`ADMIN` and `MANAGER` are the elevated roles: only an ADMIN may invite, edit, reassign or delete
a user in one of them, or edit those roles. Managers manage every other role and user. The
last ADMIN of a workspace cannot be removed, and nobody can delete their own account.

## 3. Custom roles and overrides

A tenant with the `team` capability can create custom roles (a name and a list of keys; the
role key is derived from the name and may not collide with a built-in), edit and delete them
(delete is refused while a user still holds the role). It can also override a built-in role's
keys per tenant (not `ADMIN`); deleting such an override resets the role to its default. The
role editor's catalogue comes from `GET /users/roles`.

### Per-user overrides

A user may carry an explicit `permissions` list that replaces their role's keys. Only an
ADMIN can set it, and every key is validated against the nine above.

## 4. Resolution

[`services/rbac.service.ts`](../../apps/api/src/services/rbac.service.ts), first match wins:

1. The user's explicit `permissions` list.
2. A stored role definition for the role key in the tenant's `roles` table (a custom role, or
   a tenant override of a built-in).
3. The built-in default.
4. Otherwise no access.

`*` matches every key. Role maps are cached 60 seconds per process and invalidated on any role
write. The role in the JWT is not trusted: it is read from the database on every request.

### Visible modules

`GET /auth/me` returns the list the app uses for navigation: for `*` every **entitled**
feature module plus all governance capabilities; for anything else the entitled feature modules
the role grants plus the governance capabilities it grants. An ADMIN on a small plan therefore
does not see a module the plan lacks, which the API would answer with 403 anyway.

## 5. Where each check runs

| Check | Code | Used by |
| --- | --- | --- |
| Entitlement, then role | `requireModule(key)` | Every feature route group in [`routes/index.ts`](../../apps/api/src/routes/index.ts) |
| Role only | `requireCapability(key)` | Domain and sender writes (`channels`), user and role writes (`team`), `PUT /tenant/me` (`settings`) |
| Any of several | `requireAnyAccess(...)` | `GET /email/domains` and `GET /email/senders`: anyone with `channels`, `campaigns` or `email` can read, so the campaign composer can list senders |
| Operator | `requireSuperadmin` | Every operator write: operators, plans, tenants, entitlement overrides, unpause |

Routes that need no module: `/auth/me`, `/auth/logout`, `/tenant/me`, `/tenant/plans`,
`/users` (list and roles catalogue), `PATCH /users/me/password`, `/notifications`.

## 6. Operator roles

`SUPERADMIN` may create operators and plans, onboard and edit tenants, override entitlements
and unpause sending. `OPERATOR` may read everything (tenants, plans, fleet, account health,
DLQ, audit, metrics). The first operator is created with `make aws-operator` or
`scripts/bootstrap-operator.ts` ([operations](../guides/operations.md#first-operator)).

## 7. Limits of the model

- Roles grant a module wholesale. There is no per-record or per-list permission: a marketer
  with `audience` sees every contact, and anyone with `campaigns` can send to every list.
- Reading the sender list is open to `campaigns` and `email` holders by design.
- `GET /users` and the roles catalogue are open to every signed-in user of the tenant.
- The audit log is read-only and tenant-wide; there is no per-user filter beyond `action` and
  `entityType`.
