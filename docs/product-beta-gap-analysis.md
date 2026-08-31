# Product beta gap analysis (post-M15)

Status: **APPROVED**. Explicitly approved after roadmap-design commit `99c13e4` (`docs: define post-M15 RecruitIntel roadmap`). This is a documentation-only audit of `baae274`, 35 migrations through `0035_m15_operations.sql`, and the actual Next.js, extension, TypeScript, Python, SQL, test, and operations surfaces. M16 is authorized by the approved roadmap; later milestones retain their stated approval gates.

## Executive finding

RecruitIntel has a strong provenance-first intelligence and private-data foundation. The limiting factor is the gap between implemented private APIs/domain workflows and a coherent, discoverable user experience. A user can browse shared intelligence, configure preferences, receive deterministic recommendations, use the Calendar, and connect Google Calendar. The user cannot complete resume → match → application → outcome from the web navigation, set up the extension without manually handling a grant, or manage privacy/account actions from product UI.

## Capability inventory

| Capability                           | Current state                           | Repository finding                                                                                                                                             |
| ------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication                       | Implemented + user-usable               | Google Better Auth sign-in, sessions and CSRF/origin protections; only Google sign-in is exposed.                                                              |
| Onboarding / first run               | Not implemented                         | Sign-in directs to `/dashboard`; no guided preference, resume, extension or useful-empty-state path.                                                           |
| Profile / job / location preferences | Partially user-usable                   | Settings supports graduation, work authorization, sponsorship, roles, tracks, workplace, locations and schools; it is a dense settings form rather than setup. |
| Company preferences                  | Partially user-usable                   | Private company watches work; no target-company setup/discovery journey exists.                                                                                |
| Recruiting timeline preferences      | Partially user-usable                   | Calendar, dates/windows, plans and Google preferences exist; no daily workflow synthesis.                                                                      |
| Job discovery / freshness            | Partially user-usable                   | Dashboard, companies, jobs, events and provenance exist; Jobs has no practical search/filter UI or user-facing coverage/degraded state.                        |
| Recommendations / explanations       | Implemented + user-usable               | Owner-scoped deterministic feed provides reasons, hard eligibility, unknowns, impressions, watch/dismiss/undo.                                                 |
| Save / dismiss                       | Implemented + user-usable               | Watchlists and dismissal work; saved/applied/plan state is not unified.                                                                                        |
| Job detail                           | Partially user-usable                   | Basic canonical metadata and application URL exist; requirements/provenance/match/application actions are missing.                                             |
| Company / recruiter intelligence     | Partially user-usable                   | Public company/recruiter/school/event APIs/pages expose provenance and freshness; discovery is collection/admin driven.                                        |
| Recruiting windows                   | Partially user-usable                   | Calendar renders confirmed/estimated dates; no “opening soon / prepare now” queue.                                                                             |
| Alerts / notifications               | Partially user-usable                   | M9 in-app alerts/read/dismiss/preferences exist; no email, push, browser notification, delivery ledger, quiet hours or digest.                                 |
| Application tracking                 | Implemented but API/infrastructure only | M10 application/status/timeline/OA/interview/archive/outcome/calendar APIs exist, but no application route, board or sidebar item exists.                      |
| ApplicationPlan / Google Calendar    | Partially user-usable                   | Calendar can create/activate plans and tasks; applications do not drive a visible lifecycle. Google connection/sync UI works.                                  |
| Resume / evidence review             | Implemented but API/infrastructure only | M11 secure upload, parse, evidence confirmation/correction, worker status and delete APIs have no page/component/navigation.                                   |
| Exact-job match / explanation        | Implemented but API/infrastructure only | M11 deterministic match, eligibility, citations and application binding have no web surface.                                                                   |
| Browser companion                    | Partially user-usable                   | MV3 scan/select/import/add-to-board/plan exists, but setup requires manual server URL plus opaque grant; no install/connect/revoke product page.               |
| Bounded AI                           | Internal/API only                       | M13 gateway is safe and optional; no product workflow should require it.                                                                                       |
| Personal analytics                   | Implemented but API/infrastructure only | `/api/me/analytics` provides private funnel counts; no page exposes them.                                                                                      |
| Outreach                             | Not implemented                         | No private contact/outreach/review/send state, authorized mail integration or delivery ledger exists.                                                          |
| Interview preparation                | Partially user-usable                   | Question/topic intelligence, M10 interview/OA data and Calendar categories exist; no preparation hub or application-context plan.                              |
| Privacy / extension grants           | Implemented but API/infrastructure only | Export/delete and grant issue/list/revoke APIs exist; Settings has no account/privacy/grant section.                                                           |
| Admin / operations                   | Internal/admin only                     | Correctly aggregate/redacted M7/M15 control and recovery surfaces.                                                                                             |
| Responsive / accessibility           | Partial baseline                        | Responsive sidebar breakpoint, some labels/focus styles; no systematic keyboard, focus, reduced-motion, semantic-error or small-screen acceptance.             |
| Empty/loading/error/retry            | Partial baseline                        | Some dashboard, Calendar and Google states exist; inconsistent across visible surfaces and absent for API-only workflows.                                      |

## Journey audit

### First run

The user can authenticate and configure preferences, but is not guided to do so, cannot upload a resume in the web app, and does not receive an honest first-use state explaining whether opportunities are unavailable, preferences are incomplete, or collection coverage is degraded.

### Daily discovery

The M9 recommendation feed is the strongest private flow: it shows deterministic reasons, hard eligibility/unknowns, watch and dismiss. The surrounding flow is incomplete: no practical search/filtering, no full requirement/provenance/match area in job detail, and no unified saved/applied/plan state. Operational source freshness is not translated to a user-safe confidence/degraded state.

### Application lifecycle

The backend can create an application, preserve append-only transitions, record OA/interviews/outcomes, bind a resume match, and make calendar work. The web product cannot start or inspect this lifecycle except via the extension's “add to application board” call. This is the principal backend-complete/product-incomplete gap.

### Browser companion

The MV3 design correctly requires an explicit current-tab scan and selected-only ingestion. Its side panel asks users to paste a server URL and scoped bearer grant. There is no guided web installation, grant issue/revoke, connection status, expired-grant recovery, or path from an import to job/match/application views.

### Calendar, interview preparation, recruiter networking and privacy

Calendar supports dates/windows, plans/tasks and one-way Google sync but lacks a priority view for openings, deadlines and follow-ups. M1/M2 question aggregates, M10 interview/OA records and Calendar prep categories exist without a preparation workflow. M4 recruiters are public, evidence-backed people/company discoveries only: they do not establish an email, relationship or permission to contact. There is no outreach implementation. Privacy safety is solid, but export, account deletion, resume removal and extension revocation are not product-discoverable.

## Private beta acceptance bar

RecruitIntel is beta-ready only when an authenticated user can, without direct API calls or a developer token:

1. Complete guided preferences, optionally upload a resume, review/correct evidence, and receive deterministic recommendations or an explicit empty/degraded state.
2. Search/browse canonical opportunities; inspect provenance, constraints, freshness and explanation; save/dismiss; match; and begin an application or plan from the same context.
3. Use an application board through OA, interview and outcome with linked resume version, append-only history and calendar work.
4. Install/connect/revoke the MV3 companion through a guided web flow, scan explicitly, select intended jobs only, and continue in the same workflow.
5. See actionable in-app alerts, Calendar work and recovery states.
6. Export data, revoke the extension, remove a resume and delete the account.
7. Use supported small web viewports and keyboard/screen-reader basics. A native mobile app is not required.

All core beta flows must function with `ZERO_COST_MODE=true`, zero paid search and model spend, no network model provider, and no mandatory paid notification or mail provider.

## Guardrails

M6 remains identity/privacy/export/delete authority; M7 is the only work, retry/dead-letter/fencing plane; M8 history is immutable; M9 is deterministic ranking authority; M10 lifecycle is append-only; M11 eligibility is tri-state and evidence-grounded; M12 stays MV3/activeTab/selected-only; M13 is bounded and non-authoritative; M14 is offline/shadow only; and M15 runtime/recovery guarantees are permanent. No LinkedIn automation, invented email/contact, autonomous outreach/application or fabricated label/evidence is acceptable.
