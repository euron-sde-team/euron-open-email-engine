# Open Mail tenant app

The single-page app tenants sign in to: sending domains with a DNS wizard, senders,
contacts, lists, segments, subscribe forms, CSV import, templates, campaigns with a
four-step composer and a report page, a message log, suppressions and reputation, plus
team, settings and the audit log. The accent colour can be changed per workspace in
Settings.

Companion apps in this monorepo:

- [`apps/api`](../api): the API this app consumes (tenant plane under /api/v1, port 5126)
- [`apps/console`](../console): operator console
- [`packages/types`](../../packages/types): the API contract both apps import

## Stack

- React 19, Vite 6, TypeScript strict
- react-router-dom 7, TanStack Query v5, Zustand (persisted auth), axios
- Tailwind CSS 3.4 with hand-vendored Radix components, lucide-react, sonner, cmdk
- Charts are plain SVG (no chart library)

## Run

```bash
pnpm --filter @open-email/web dev        # http://localhost:3650
pnpm --filter @open-email/web test       # unit tests for the lib code
pnpm --filter @open-email/web typecheck
pnpm --filter @open-email/web lint
pnpm --filter @open-email/web build
```

`VITE_API_BASE_URL` points at the API (default `http://localhost:5126/api/v1`).

Public pages (`/u/:token` unsubscribe, `/f/:slug` subscribe forms, `/c/:token`
confirmation, `/w/:token` view in browser) and the tracking endpoints (`/t/...`) are
rendered by the API. The dev server and `vite preview` proxy those paths to
`VITE_PROXY_TARGET` (default `http://localhost:5126`), so a link on the app's origin works.

## Layout

- `src/pages`: one file per route; `src/routes.tsx` gates each area by module
- `src/lib`: pure logic with unit tests (segment rules, merge tags, import mapping, DNS
  grouping, schedule and timezone, report math) and `lib/api/*` (one module per resource)
- `src/components/{charts,email,domains,audience,common,layout,ui}`
- Navigation lives in `components/layout/nav.ts`; names in `lib/brand.ts`
