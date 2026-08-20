# Recruiting calendar and application planning

Milestone 5 connects date-bearing recruiting intelligence to owner-scoped actions and optional
one-way Google Calendar synchronization. It does not add alerts, an application-tracking CRM,
analytics, ML, multi-user authentication, or two-way calendar sync.

## Domain and ownership

`RECRUITINTEL_MVP_OWNER_ID` is the current-owner abstraction. Route handlers resolve it on the
server and never accept an owner ID from the browser. The default is the stable UUID
`00000000-0000-0000-0000-000000000001`. This isolates all calendar, plan, OAuth, and sync reads
without pretending Milestone 5 has implemented user authentication.

`RecruitingDate` is source intelligence. It retains certainty, precision, confidence, source URL,
source ID, source-specific identity, and provenance JSON. `materializeRecruitingDates()` projects
date-bearing `public_recruiting_observations` and `campus_recruiting_events` through stable source
fingerprints. Reprocessing updates the projection rather than duplicating it, and it never promotes
`ESTIMATED`, `HISTORICAL`, or `CLAIMED` evidence to `CONFIRMED`.

`CalendarItem` is the actionable/display projection. Its scheduling status (`TODO`, `DONE`,
`SKIPPED`, or `CANCELLED`) is separate from recruiting-date certainty. Its source is
`RECRUITING_INTELLIGENCE`, `USER`, or `APPLICATION_PLAN`. Source-driven items retain a foreign key
to their `RecruitingDate`; their source fields cannot be rewritten through the calendar PATCH API.

All-day items carry `startsOn`/`endsOn` date values in addition to canonical timestamps. Provider
code uses the date values, so a Chicago all-day item cannot shift to the prior day through UTC
conversion. `endsOn` is inclusive inside RecruitIntel and converted to Google's exclusive end date
at the provider boundary.

## Success and error envelopes

All success responses use `{ "data": ... }`. Lists also have `meta: { total }`. Errors use:

```json
{ "error": { "code": "INVALID_REQUEST", "message": "Human-readable message" } }
```

The executable schemas and inferred types are in `packages/types/src/index.ts`. Timestamps are
RFC 3339 strings and date-only values are `YYYY-MM-DD` strings.

## Calendar API

### `GET /api/calendar`

Optional query parameters: `start` and `end` (RFC 3339 timestamp or date), `type`, `company`
(UUID or slug), and `status`. The response is `{ data: CalendarItem[], meta: { total } }` sorted by
`startsAt`, then ID. Intelligence dates are materialized idempotently before the query.

```ts
interface CalendarItem {
  id: string;
  company: { id: string; name: string; slug: string } | null;
  jobId: string | null;
  recruitingDateId: string | null;
  applicationPlanId: string | null;
  type:
    | "RECRUITING_DATE"
    | "APPLICATION_TASK"
    | "LEETCODE"
    | "INTERVIEW_PREP"
    | "SYSTEM_DESIGN"
    | "BEHAVIORAL_PREP"
    | "RECRUITER_OUTREACH"
    | "RESUME_WORK"
    | "CAREER_EVENT"
    | "OA"
    | "CUSTOM";
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
  allDay: boolean;
  timezone: string;
  status: "TODO" | "DONE" | "SKIPPED" | "CANCELLED";
  source: "RECRUITING_INTELLIGENCE" | "USER" | "APPLICATION_PLAN";
  syncEnabled: boolean;
  completedAt: string | null;
  metadata: Record<string, unknown>;
  recruitingDate: RecruitingDate | null;
  createdAt: string;
  updatedAt: string;
}
```

`RecruitingDate` includes the company, job/school/event/observation/claim IDs, type, title, timing,
certainty (`CONFIRMED | ESTIMATED | HISTORICAL | CLAIMED | USER_CREATED`), existing date precision,
confidence, and `{ kind, name, url, provenance }` source object.

### `POST /api/calendar`

Creates a user item and returns HTTP 201 `{ data: CalendarItem }`.

```json
{
  "companyId": "optional UUID",
  "jobId": "optional UUID",
  "type": "LEETCODE",
  "title": "Practice graph traversal",
  "description": "One bounded session",
  "startsAt": "2026-08-20T18:00:00-05:00",
  "endsAt": "2026-08-20T19:00:00-05:00",
  "allDay": false,
  "timezone": "America/Chicago",
  "status": "TODO",
  "syncEnabled": false,
  "metadata": {}
}
```

For an all-day item, send `allDay: true`, `startsOn`, optional inclusive `endsOn`, and omit timed
fields. The type cannot be `RECRUITING_DATE`; source-driven dates come from provenance projections.

### `PATCH /api/calendar/:id`

Accepts any non-empty subset of `title`, nullable `description`, timing fields, `allDay`, `timezone`,
`status`, `syncEnabled`, or `metadata`, and returns `{ data: CalendarItem }`. Setting status to
`DONE` sets `completedAt`; moving away from `DONE` clears it. Source-driven items only accept
`status` and `syncEnabled` changes.

`POST /api/calendar/:id/complete` is the convenience equivalent of PATCH `{ "status": "DONE" }`.

### `DELETE /api/calendar/:id`

Returns HTTP 204. Deletion is a soft cancellation so an existing external mapping remains available
to the sync worker for provider deletion.

## Application-plan API

### `POST /api/application-plans`

Creates a deterministic draft plan and its calendar items; returns HTTP 201
`{ data: ApplicationPlan }`.

```json
{
  "companyId": "required UUID",
  "jobId": "optional UUID",
  "recruitingDateId": "optional UUID",
  "title": "Apply to Roblox SWE Intern",
  "targetDate": "2026-08-20",
  "timezone": "America/Chicago",
  "template": [
    {
      "relativeDayOffset": -7,
      "taskType": "RESUME_WORK",
      "title": "Resume review",
      "generatedReason": "Tailor the resume before the target date."
    }
  ]
}
```

Omit `template` for deterministic V1 offsets `[-7, -5, -3, -2, 0, +2]`: resume, research,
interview-intelligence review, targeted LeetCode, apply/monitor, and recruiter follow-up. An exact
same plan request returns the existing plan and tasks by plan fingerprint. A company's highest-count
interview topics may label prep items (for example, `Graphs`), while task metadata explicitly says
reported topics are not guaranteed interview content.

`ApplicationPlan` contains company, associations, title, target date/timezone, status, generator
metadata, activation timestamps, and ordered tasks. Each task contains its sequence, relative offset,
type, generated reason, metadata, and full `calendarItem`.

### Other plan routes

- `GET /api/application-plans?company=<uuid-or-slug>&status=<status>` returns a list.
- `GET /api/application-plans/:id` returns one plan.
- `PATCH /api/application-plans/:id` accepts title, target date, timezone, or status. A target-date
  change reschedules generated items by their stored relative offsets.
- `DELETE /api/application-plans/:id` archives the plan and soft-cancels its items.
- `POST /api/application-plans/:id/activate` accepts `{ "sync": false }`. Activation is idempotent.
  `sync: true` explicitly enables the plan items and enqueues at most one active connection request;
  the default never creates Google events.

## Google Calendar API

- `GET /api/integrations/google-calendar/authorize` returns
  `{ data: { authorizeUrl, expiresAt } }`. Navigate the browser to `authorizeUrl`.
- `GET /api/integrations/google-calendar/callback` is Google-only. It consumes state once and
  redirects to `/settings?googleCalendar=connected` or a sanitized error code.
- `GET /api/integrations/google-calendar/status` (also GET on the integration root) returns status.
- `GET /api/integrations/google-calendar/calendars` returns owned target calendars as
  `{ id, summary, primary, timezone, accessRole: "owner" }`; access tokens remain server-only.
- `PATCH /api/integrations/google-calendar` updates `selectedCalendarId` and/or a partial
  `preferences` object.
- `POST /api/integrations/google-calendar/sync` returns HTTP 202 `{ data: CalendarSyncRequest }`.
  It queues durable work; it does not call Google in the HTTP request.
- `DELETE /api/integrations/google-calendar` best-effort revokes Google access, clears the encrypted
  local credential, invalidates pending OAuth state, and returns HTTP 204.

The status response is:

```ts
interface GoogleCalendarStatus {
  provider: "GOOGLE";
  status: "CONNECTED" | "REAUTH_REQUIRED" | "DISCONNECTED" | "ERROR";
  accountEmail: string | null;
  selectedCalendarId: string; // "primary" initially
  scopes: string[];
  preferences: {
    syncRecruitingDates: boolean;
    syncApplicationTasks: boolean;
    syncLeetcode: boolean;
    syncInterviewPrep: boolean;
    syncCareerEvents: boolean;
  };
  lastSyncAt: string | null;
  lastSyncStatus: "PENDING" | "SYNCED" | "UNCHANGED" | "DELETED" | "ERROR" | null;
  reconnectRequired: boolean;
  errorCode: string | null;
}
```

## Exact Claude adapter changes

Claude-owned components and pages were not modified. Only `apps/web/lib/api/calendar.ts` and its
frontend types need an adapter update when Claude switches off mocks:

- `getCalendarItems()` calls GET `/api/calendar`; map `date <- startsOn ?? startsAt.slice(0, 10)`,
  `endDate <- endsOn`, `completed <- status === "DONE"`, and `planId <- applicationPlanId`.
- The mock `status` currently represents certainty. For source items use
  `recruitingDate.dateCertainty`; for action/prep items use `USER_SCHEDULED`. Do not map backend
  scheduling status into the certainty badge.
- Derive mock `category`: intelligence source is `RECRUITING_DATE`; LeetCode/interview/system/
  behavioral prep is `PREP_SESSION`; remaining items are `ACTION`.
- Generated item `metadata.presentationType` supplies mock-only values such as `APPLY`,
  `RESEARCH_COMPANY`, `UPDATE_RESUME`, and `FOLLOW_UP`. Canonical backend task types remain stable.
- `createCalendarItem()` must translate the mock date/time pair to the canonical all-day or timed
  request. `updateCalendarItem({ completed })` translates to status `DONE` or `TODO`.
- The backend requires `companyId` for a plan. For the existing company-slug deep link, resolve the
  company through GET `/api/companies/:slug` before POSTing the plan.
- `createApplicationPlan()`, `getApplicationPlans()`, `getApplicationPlan()`, and
  `activateApplicationPlan()` call the routes above; map `targetLabel <- title` for the old view.
- `getGoogleCalendarAuthorizeUrl()` calls the authorize route. `connectCalendarProvider()` should
  navigate to that URL rather than simulate a timer.
- If Claude exposes target selection, load the owned options from the calendars route and PATCH the
  chosen `selectedCalendarId`; the current UI may keep the callback default of `primary`.
- Map `DISCONNECTED -> NOT_CONNECTED`, `REAUTH_REQUIRED/ERROR -> SYNC_ERROR`, and preserve the
  card's transient `CONNECTING`/`SYNCING` states locally around navigation/HTTP calls.
- The four existing toggles map as follows: `recruitingTasks -> syncApplicationTasks`,
  `leetcodeSessions -> syncLeetcode`, `applicationDeadlines -> syncRecruitingDates`, and
  `careerEvents -> syncCareerEvents`. The new `syncInterviewPrep` preference has no dedicated
  Claude toggle yet and must be preserved when PATCHing another preference.

## Sync lifecycle and observability

Run one queued request with:

```bash
uv run recruitintel-collectors calendar-sync --request-id REQUEST_UUID
```

The worker refreshes an access token in memory, selects eligible items by item opt-in and connection
preferences, then creates, updates, deletes, or no-ops. It records attempted/created/updated/deleted/
unchanged/failed counts, duration, sanitized item error codes, request attempt state, connection
status, and mapping status. Partial failures retry with bounded exponential backoff. Revoked or
invalid refresh credentials transition the connection to `REAUTH_REQUIRED` without repeated retry.

Every external event has a unique database mapping and a deterministic provider event ID derived
from connection and item IDs. If Google accepts a create but local persistence fails, a retry gets
the deterministic existing event and repairs the mapping instead of creating a duplicate.
