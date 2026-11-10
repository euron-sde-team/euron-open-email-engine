# Audience and segments

Contacts, custom fields, tags, lists, rule-based segments, hosted subscribe forms and CSV
import. Code: [`contacts.service.ts`](../../apps/api/src/services/contacts.service.ts),
[`lists.service.ts`](../../apps/api/src/services/lists.service.ts),
[`segments.service.ts`](../../apps/api/src/services/segments.service.ts),
[`utils/segment-sql.ts`](../../apps/api/src/utils/segment-sql.ts),
[`forms.service.ts`](../../apps/api/src/services/forms.service.ts),
[`imports.service.ts`](../../apps/api/src/services/imports.service.ts).
All of it is behind the `audience` module.

## 1. Contacts

One row per `(tenant, lowercased email)`. Fields: first and last name (100 characters), `tags`
(lowercase tags, at most 50), `attributes` (custom field values, at most 100 keys; string
values 500 characters), `source` (`MANUAL`, `IMPORT`, `FORM`; `API` is reserved for the future
developer API), and consent (`consent_at`, a hashed IP for forms).

| Status | Meaning | Mailed by campaigns |
| --- | --- | --- |
| `SUBSCRIBED` | Consented, mailable | Yes |
| `PENDING_CONFIRMATION` | Waiting on a double opt-in click | No |
| `UNSUBSCRIBED` | Opted out, or blocked by an admin | No |
| `BOUNCED` | A hard bounce | No |
| `COMPLAINED` | Marked as spam | No |

Rules the API enforces:

- A user may set a contact `SUBSCRIBED` or `UNSUBSCRIBED` only, and a `BOUNCED` or
  `COMPLAINED` contact can never be re-subscribed (409). Those statuses come from events.
- Creating a contact checks the plan's contact limit. A duplicate email is 409.
- `PATCH` with `attributes` merges into the existing ones; `listIds` replaces the contact's
  non-unsubscribed memberships.
- `GET /contacts` filters by `q` (email or name, substring), `status`, `tag`, `listId` and
  `segmentId`, paged by id (50 by default, at most 200).
- `GET /contacts/:id/timeline` returns up to 200 events across campaigns plus the origin
  (subscribed or imported).
- `POST /contacts/bulk` handles at most 500 ids: `tag`, `untag`, `addToList`, `removeFromList`,
  `delete`.
- `GET /contacts/export.csv` streams up to 100,000 rows. Cells that start with `=`, `+`, `-`,
  `@`, tab or carriage return are prefixed with a quote so a spreadsheet never runs them as a
  formula.

### Custom fields

A key (`^[a-z][a-z0-9_]{0,39}$`), a label and a type (`text`, `number`, `date`, `boolean`), at
most 100 per tenant. They declare which `attr:<key>` names imports and segments accept and
which merge tags resolve (`{{attr.plan}}`). The type is informational: values are stored as
the string, number or boolean given.

## 2. Lists

Static lists with a `doubleOptIn` flag. A membership is `subscribed`, `pending` or
`unsubscribed`; a campaign sent to a list reaches only `subscribed` members whose contact is
also `SUBSCRIBED`. Adding a contact to a list never revives an `unsubscribed` membership. A list
cannot be deleted while a form posts to it. `GET /lists` returns each list's `memberCount`
(subscribed members). Add and remove at most 500 contacts per request.

## 3. Segments

A segment is a saved rule set evaluated against `contacts`:

```json
{ "match": "all",
  "conditions": [
    { "field": "tag", "op": "is", "value": "customer" },
    { "field": "opened_in_days", "op": "in_last_days", "value": 30 },
    { "field": "attr:plan", "op": "is", "value": "pro" }
  ] }
```

`match` is `all` or `any`; 1 to 20 conditions.

| Field | Operators |
| --- | --- |
| `email` | `is`, `is_not`, `contains`, `starts_with` |
| `first_name`, `last_name` | the same, plus `is_set`, `is_not_set` |
| `status`, `source`, `tag`, `list` | `is`, `is_not` |
| `created_at` | `gt`, `lt` (a date), `in_last_days`, `not_in_last_days` |
| `opened_in_days`, `clicked_in_days` | `in_last_days`, `not_in_last_days`, `is` |
| `never_opened` | `is` (true or false) |
| `attr:<key>` | `is`, `is_not`, `contains`, `starts_with`, `gt`, `lt` (numeric values only), `is_set`, `is_not_set` |

Opens in `opened_in_days` and `never_opened` use `contacts.last_opened_at`, which only human
opens update ([tracking.md](tracking.md#4-open-pixel-and-machine-opens)). Because opens are
unreliable, prefer click-based rules for engagement segments.

### Evaluation

[`segment-sql.ts`](../../apps/api/src/utils/segment-sql.ts) turns the rules into a Kysely
expression: field names come from an allowlist, attribute keys from a strict pattern (and are
bound as parameters), every value is a bound parameter and nothing is concatenated into SQL.
`validateRules` rejects an unknown field, an operator the field does not support, a missing
value and a day count outside 1 to 3650.

- `POST /segments/preview` returns a count and ten sample contacts.
- A count runs inside a transaction with `statement_timeout` 3 seconds; a heavy rule answers
  400 "These rules take too long to evaluate".
- `contactCount` on a segment is a cached number from the last save, or computed on demand
  with `?count=true`.
- A campaign to a segment evaluates the rules **at start**, not at schedule time and not later.

## 4. Subscribe forms

A form is a hosted page at `/f/:slug` that adds people to one list. Create it in the app
(`POST /forms`); the slug is generated or chosen (3 to 48 lowercase letters, digits, hyphens,
unique across all tenants).

`POST /f/:slug` (rate limited per IP and per form):

1. A filled **honeypot** field (`website`) gets a normal-looking success and does nothing.
2. The email is validated (254 characters at most).
3. The submission counter increases.
4. A `BOUNCED` or `COMPLAINED` contact is never reactivated, and the answer looks the same.
5. A new contact respects the plan's contact limit; at the limit the answer still looks like
   success (logged), so the form cannot be used to probe quota.
6. With **double opt-in** the contact is `PENDING_CONFIRMATION` and the membership `pending`; a
   confirmation email goes out from the tenant's `TRANSACTIONAL` default sender. Without a
   verified sender the confirmation is not sent (logged). Clicking `/c/:token` (valid 7 days)
   subscribes them.
7. Without double opt-in the contact is `SUBSCRIBED` with the consent time.
8. A person who was `UNSUBSCRIBED` and signs up again through a form lifts their own
   unsubscribe and the `UNSUBSCRIBE` suppression.

Every outcome looks the same to the caller where it could reveal whether an address exists.
A form whose tenant is not `ACTIVE`, or that is switched off, answers "not available".

## 5. CSV import

Three steps, so a wrong mapping is caught before anything is written.

1. `POST /imports` (multipart field `file`, at most 10 MB, 100,000 rows): the file is stored and
   parsed. It must be text (a NUL byte is refused), have a header row with unique non-empty
   names (at most 200 columns) and at least one data row. The delimiter (comma, semicolon or
   tab) is detected. The response has the headers, five sample rows and the row count.
2. `POST /imports/:id/start` with `mapping` (each header to `email`, `first_name`, `last_name`,
   `full_name`, `tags`, `attr:<customFieldKey>` or `skip`; exactly one `email` column), optional
   `listId` and `tags`, and `consentConfirmed: true` (required: the importer confirms they have
   permission to email these people).
3. The `mail-work` queue processes it in chunks of 500 and the app polls `GET /imports/:id`.

Processing rules:

| Rule | Detail |
| --- | --- |
| Idempotent on email | Rows are upserted by `(tenant, email)`; a row twice in one file keeps the first |
| Never revives | An existing contact keeps its status. A **new** contact whose address is suppressed is created as `BOUNCED`, `COMPLAINED` or `UNSUBSCRIBED`, never `SUBSCRIBED` |
| Names | Fill only when empty |
| Tags and attributes | Merged into the existing ones |
| Plan limit | Rows beyond the contact limit are skipped with an error |
| List | Only contacts that end up `SUBSCRIBED` join the chosen list |
| Errors | Up to 100 row errors kept (`row`, `email`, `reason`); counts of created, updated and skipped |

A file that fails unexpectedly ends `FAILED` with a generic error. The uploaded CSV stays in
storage with a `files` row.

## 6. Limitations

- Segments are evaluated at send time and are not live audiences: a campaign's recipients are
  fixed at start.
- Imports are limited to 10 MB and 100,000 rows; split larger files.
- No de-duplication across different addresses of the same person, no merge of contacts.
- No per-list preferences centre; unsubscribing is global to the contact for marketing mail.
- Custom field types are not enforced on write.
- Contacts created by the future developer API will have source `API`; nothing sets it yet.
