# RecruitIntel Frontend Design

Owner: frontend/design agent. Backend, schema, collectors, and infra are owned by Codex —
this document only covers `apps/web` and the frontend-only packages it depends on.

## Stack

- Next.js 16 (App Router, webpack build), React 19, TypeScript (strict)
- Tailwind CSS v4 (CSS-first config, no `tailwind.config.js`) + a small set of hand-written
  global classes in `app/globals.css` for things Tailwind utilities don't express well
  (glass surfaces, the sidebar shell)
- `lucide-react` for icons, `clsx` for conditional class composition
- Vitest for unit tests, colocated as `*.test.ts` next to the module under test
- Workspace packages: `@recruitintel/db` (Postgres access + row types), `@recruitintel/shared`
  (formatting helpers), `@recruitintel/types` (zod schemas) — all owned by Codex

## Page architecture

| Route                             | Rendering                                     | Data source                                                          |
| --------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `/dashboard`                      | Server component, `dynamic = "force-dynamic"` | `@recruitintel/db` directly                                          |
| `/companies`, `/companies/[slug]` | Server component                              | `@recruitintel/db` directly                                          |
| `/jobs`, `/events`                | Server component                              | `@recruitintel/db` directly                                          |
| `/calendar`                       | Server shell + client `CalendarApp`           | Canonical Calendar/ApplicationPlan APIs via `lib/api/calendar.ts`    |
| `/settings`                       | Server shell + client `GoogleCalendarCard`    | Canonical Google Calendar integration APIs via `lib/api/calendar.ts` |

The DB-backed pages query `@recruitintel/db` directly from server components (not through a
fetch layer) and wrap every query in try/catch, rendering `<DatabaseError>` if Postgres isn't
reachable — this is intentional: it's a real, already-wired backend, so there's no mock layer
to maintain for it. Calendar and Settings keep client-side interaction state, but their
production data now comes from the Milestone 5 route handlers. They surface intentional loading,
API-unavailable, queued-sync, reauthorization, and provider-error states without exposing raw
provider responses.

Still missing from the original nav spec: **Recruiters**, **Interview Prep**, **Watchlist**.
Not built this pass — no page exists for them yet, so they're intentionally left off the
sidebar to avoid dead links. Add them to `components/app-sidebar.tsx`'s `navigation` array
when those pages land.

## Design system

Defined once in `app/globals.css` as CSS custom properties, then consumed everywhere via
Tailwind arbitrary values (`bg-[var(--panel)]`) or the two shared classes `.surface` /
`.glass-dark`.

**Base palette (minimal, on purpose):**

- `--paper` — warm off-white page background
- `--ink` / `--muted` — near-black text, neutral gray secondary text
- `--panel` — near-black, used for dark solid UI (buttons, badges, sidebar text-on-white)
- `--panel-glass` — translucent version of `--panel`, used with `backdrop-filter: blur()`
  for the sidebar and the company-detail header band
- `--accent` (`#c9974a`, warm gold) — the _one_ accent color. Used sparingly: hover states,
  active-nav glyphs, the eyebrow label color, estimated-status badges.
- `--surface` — translucent white, the frosted "glass" fill used by `.surface` (every card,
  panel, and section wrapper in the app)

Legacy variable names (`--forest`, `--forest-bright`, `--mint`, `--amber`, `--background`)
are kept as aliases onto the new tokens so the original Dashboard/Companies/Jobs/Events pages
render through the new palette without any component edits — `--forest` now resolves to
`--panel` (near-black instead of the old forest green), `--mint`/`--forest-bright` resolve to
`--accent` (gold instead of mint green). New code should use the semantic names directly
rather than the legacy aliases.

**Glass surfaces**: `.surface` (light cards/panels) and `.glass-dark` (dark hero bands) both
use `backdrop-filter: blur()` over a translucent fill plus a hairline border and an inset
top highlight, so panels read as frosted glass over the paper background rather than flat
fills. This is the direct response to the "glass UI, minimal colors, doesn't look like a
generic AI dashboard" design direction — restrained to two panel treatments (light glass,
dark glass) rather than colored gradients or heavy rounding.

**Typography**: Tailwind's default serif stack for headings (`font-serif`), Inter for body —
kept from the original design; the serif/sans pairing reads editorial rather than "SaaS
template," which fits the "Bloomberg terminal for recruiting" brief better than an all-sans
system would.

## Certainty is visually encoded, not just labeled

Per the product's core UX principle (fact vs. observation vs. inference vs. prediction must
never look the same), the calendar's five presentation statuses have deliberately different visual weight
in `components/calendar/status-badge.tsx`:

- `CONFIRMED` — solid emerald fill (the only solid/filled status)
- `ESTIMATED` — dashed border, soft gold fill
- `HISTORICAL` — muted gray, no color
- `CLAIMED` — dashed violet treatment for reported but unconfirmed dates
- `USER_SCHEDULED` — solid ink/black (a personal task, not a claim about the world)

Never restyle `ESTIMATED`, `HISTORICAL`, or `CLAIMED` to look as confident as `CONFIRMED`.

## Recruiting Calendar + Application Planner

Everything reads and writes through `lib/api/calendar.ts`. That adapter validates canonical
`@recruitintel/types` response schemas, translates only presentation fields used by the existing
visual design, and sanitizes API/provider failures. There is no production in-memory store.

### Data flow

```
@recruitintel/types       — canonical Calendar, ApplicationPlan, and Google schemas
lib/types/calendar.ts     — presentation-only Calendar view types derived from canonical types
lib/api/calendar.ts       — typed API adapter, canonical request/response validation, timezone
                             conversion, and presentation mapping
components/calendar/*     — all UI, consumes only lib/api/calendar.ts
components/settings/google-calendar-card.tsx — integration UI, same API module
```

### Components

- `calendar-app.tsx` — page-level client component; owns items/filters/selection state,
  reads `?plan=1&companySlug=&companyName=` for the company-page deep link
- `month-view.tsx`, `week-view.tsx` — pure-ish grid renderers driven by `date-grid.ts`
  (tested in `date-grid.test.ts`)
- `upcoming-agenda.tsx` — chronological list with inline task completion
- `upcoming-windows.tsx` — the "Upcoming Recruiting Windows" cards (Roblox/United
  Airlines/Microsoft-style examples), filtered from the same item store
- `detail-panel.tsx` — selected item detail; for a `RECRUITING_DATE` item or a company-page
  deep link, shows the suggested prep-action list and a "Create application plan" action
- `plan-timeline.tsx` — renders backend-generated ordered/relative tasks and explicitly activates
  a plan with Google sync off unless the user opts in
- `add-item-form.tsx` — quick-add for timed or all-day action/prep items with IANA timezone,
  company association, and explicit sync opt-in; source recruiting dates are never fabricated here
- `filter-bar.tsx`, `sync-status-chip.tsx`, `status-badge.tsx`, `category-badge.tsx`, `labels.ts`

### Application Plan integration point

`/companies/[slug]` has a "Create application plan" button in its header that links to
`/calendar?plan=1&companySlug=<slug>&companyName=<name>`. This is the only edit made to an
existing DB-backed page for this feature — it's a plain link, no client code added to that
server component.

### Google Calendar integration (Settings → Integrations)

`components/settings/google-calendar-card.tsx` uses backend connection status as truth and supports
`DISCONNECTED`, transient `CONNECTING`, `CONNECTED`, `REAUTH_REQUIRED`, transient request
queueing, and `ERROR`. Authorization navigates to the backend-issued OAuth URL. The card loads
owned Google calendars, updates the selected target and all five canonical sync preferences,
reports HTTP 202 as “Calendar sync queued,” and disconnects through the backend. OAuth credentials
never enter frontend state or browser storage.

## Backend integration points

1. **Calendar/planner endpoints** — the Milestone 5 backend contracts are canonical. The frontend
   adapter maps `startsOn`/timed values into existing visual date fields, keeps scheduling status
   separate from intelligence certainty, and never generates application-plan tasks in-browser.
2. **Recruiters, Interview Prep, Watchlist** — no pages exist yet; when Codex has data models
   ready, these can follow the same server-component-queries-`@recruitintel/db`-directly
   pattern already used by Companies/Jobs/Events, or a mocked-first approach like Calendar if
   the backend isn't ready yet.
3. **Google OAuth** — callback, state/PKCE, token exchange, encryption, provider calls, and refresh
   handling are backend-only. The frontend receives only status, owned calendar metadata,
   preferences, an authorization URL, and queued sync-request metadata.
