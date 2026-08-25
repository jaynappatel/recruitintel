from __future__ import annotations

# SQL is kept inline so fanout bounds and indexed joins remain reviewable beside each rule.
# ruff: noqa: E501
import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

from recruitintel_collectors.orchestration.enums import CoverageStatus
from recruitintel_collectors.orchestration.models import ClaimedWork, WorkExecutionResult

from .provider import InAppNotificationProvider, NotificationCandidate, NotificationProvider
from .scoring import ALGORITHM_VERSION, score_opportunity

RULE_VERSION = "deterministic-in-app-alerts-v1"
FANOUT_BATCH = 250
Connection = psycopg.AsyncConnection[dict[str, Any]]
Request = dict[str, Any]
EnabledTypes = set[str]


def _fingerprint(*parts: object) -> str:
    return hashlib.sha256("|".join(str(part) for part in parts).encode()).hexdigest()


def _set(rows: list[dict[str, Any]], column: str) -> set[str]:
    return {str(row[column]) for row in rows if row.get(column) is not None}


class PostgresAlertEngine:
    """Bounded M7 worker for deterministic, transactional IN_APP alerts only."""

    def __init__(
        self, database_url: str, provider: NotificationProvider | None = None
    ) -> None:
        self.database_url = database_url
        self.provider = provider or InAppNotificationProvider()

    async def _connect(self) -> psycopg.AsyncConnection[dict[str, Any]]:
        return await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)

    async def fanout(self, work: ClaimedWork) -> WorkExecutionResult:
        async with await self._connect() as connection:
            async with connection.transaction():
                request_id = work.alert_evaluation_request_id
                if request_id is None:
                    request_id = await self._scheduled_request(connection, work)
                request = await self._request(connection, request_id)
                candidates = await self._candidate_users(
                    connection, request, work.fanout_after_user_id
                )
                batch, has_more = candidates[:FANOUT_BATCH], len(candidates) > FANOUT_BATCH
                for user_id in batch:
                    await self._enqueue_user_request(connection, request, user_id)
                if has_more and batch:
                    await connection.execute(
                        """
                        insert into public.work_items (
                          work_type, work_class, alert_evaluation_request_id,
                          fanout_after_user_id, priority, idempotency_fingerprint,
                          exclusive_key, correlation_id, causation_id, parent_work_item_id
                        ) values (
                          'ALERT_FANOUT', 'PERSONALIZATION', %s, %s, 55, %s,
                          'm9-alert-fanout:' || %s::text, %s, %s, %s
                        ) on conflict (idempotency_fingerprint) do nothing
                        """,
                        (
                            request_id,
                            batch[-1],
                            _fingerprint("m9-fanout", request_id, batch[-1]),
                            request_id,
                            work.correlation_id,
                            work.id,
                            work.id,
                        ),
                    )
                if work.alert_evaluation_request_id is None:
                    await connection.execute(
                        """update public.alert_evaluation_requests set status = 'SUCCEEDED',
                             started_at = coalesce(started_at, now()), finished_at = now()
                           where id = %s""",
                        (request_id,),
                    )
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            discovered=len(batch),
            processed=len(batch),
            diagnostics={"boundedFanout": FANOUT_BATCH, "continuation": has_more},
        )

    async def _scheduled_request(
        self, connection: psycopg.AsyncConnection[dict[str, Any]], work: ClaimedWork
    ) -> UUID:
        fingerprint = _fingerprint("m9-scheduled-due-scan", work.id)
        cursor = await connection.execute(
            """
            insert into public.alert_evaluation_requests (
              trigger_type, request_fingerprint, safe_context
            ) values ('SCHEDULED_DUE_SCAN', %s, '{"eventKind":"SCHEDULED_DUE_SCAN"}')
            on conflict (request_fingerprint) do update
              set request_fingerprint = excluded.request_fingerprint
            returning id
            """,
            (fingerprint,),
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("scheduled alert request was not created")
        return UUID(str(row["id"]))

    async def _request(
        self, connection: psycopg.AsyncConnection[dict[str, Any]], request_id: UUID
    ) -> dict[str, Any]:
        cursor = await connection.execute(
            "select * from public.alert_evaluation_requests where id = %s", (request_id,)
        )
        row = await cursor.fetchone()
        if row is None:
            raise ValueError("alert evaluation request was not found")
        return row

    async def _candidate_users(
        self,
        connection: psycopg.AsyncConnection[dict[str, Any]],
        request: dict[str, Any],
        after_user_id: UUID | None,
    ) -> list[UUID]:
        trigger = request["trigger_type"]
        params: tuple[Any, ...]
        if trigger == "OPPORTUNITY_CHANGE":
            query = """
              with subject as (
                select event.opportunity_id, event.company_id, opportunity.role_family,
                  opportunity.is_internship, opportunity.is_new_grad,
                  opportunity.experience_level
                from public.opportunity_change_events event
                join public.job_opportunities opportunity on opportunity.id = event.opportunity_id
                where event.id = %s
              ), candidates as (
                select watch.user_id from public.watchlist_items watch, subject
                where watch.state = 'ACTIVE' and (
                  watch.opportunity_id = subject.opportunity_id or watch.company_id = subject.company_id
                )
                union select preference.user_id from public.user_preferred_role_families preference, subject
                  where preference.role_family = subject.role_family and subject.role_family <> 'OTHER'
                union select preference.user_id from public.user_preferred_early_career_tracks preference, subject
                  where (preference.track = 'INTERNSHIP' and subject.is_internship)
                     or (preference.track = 'NEW_GRAD' and subject.is_new_grad)
                union select preference.user_id from public.user_preferred_experience_levels preference, subject
                  where preference.experience_level = subject.experience_level
              ) select distinct candidate.user_id from candidates candidate
                join public.users user_row on user_row.id = candidate.user_id and user_row.status = 'ACTIVE'
                left join public.user_notification_preferences notification on notification.user_id = candidate.user_id
                where coalesce(notification.in_app_enabled, true) and candidate.user_id > coalesce(%s, '00000000-0000-0000-0000-000000000000')
                order by candidate.user_id limit %s
            """
            params = (request["opportunity_change_event_id"], after_user_id, FANOUT_BATCH + 1)
        elif trigger == "RECRUITER":
            query = """
              with subject as (select id, company_id from public.recruiter_profiles where id = %s),
              candidates as (
                select watch.user_id from public.watchlist_items watch, subject
                where watch.state = 'ACTIVE' and (
                  watch.recruiter_profile_id = subject.id or watch.company_id = subject.company_id
                )
                union select target.user_id from public.user_target_schools target
                  join public.recruiter_school_relationships relationship
                    on relationship.school_id = target.school_id, subject
                  where relationship.recruiter_profile_id = subject.id
              ) select candidate.user_id from candidates candidate
                join public.users user_row on user_row.id = candidate.user_id and user_row.status = 'ACTIVE'
                left join public.user_notification_preferences notification on notification.user_id = candidate.user_id
                where coalesce(notification.in_app_enabled, true) and candidate.user_id > coalesce(%s, '00000000-0000-0000-0000-000000000000')
                order by candidate.user_id limit %s
            """
            params = (request["recruiter_profile_id"], after_user_id, FANOUT_BATCH + 1)
        elif trigger == "CAMPUS_EVENT":
            query = """
              with subject as (select company_id, school_id from public.campus_recruiting_events where id = %s),
              candidates as (
                select company_watch.user_id from public.watchlist_items company_watch, subject
                where company_watch.state = 'ACTIVE' and company_watch.company_id = subject.company_id
                  and (subject.school_id is null or exists (
                    select 1 from public.user_target_schools school
                    where school.user_id = company_watch.user_id and school.school_id = subject.school_id
                  ))
              ) select candidate.user_id from candidates candidate
                join public.users user_row on user_row.id = candidate.user_id and user_row.status = 'ACTIVE'
                left join public.user_notification_preferences notification on notification.user_id = candidate.user_id
                where coalesce(notification.in_app_enabled, true) and candidate.user_id > coalesce(%s, '00000000-0000-0000-0000-000000000000')
                order by candidate.user_id limit %s
            """
            params = (request["campus_recruiting_event_id"], after_user_id, FANOUT_BATCH + 1)
        elif trigger == "INTERVIEW_INTELLIGENCE":
            query = """
              with subject as (select company_id from public.company_interview_questions where id = %s),
              candidates as (
                select watch.user_id from public.watchlist_items watch, subject
                where watch.state = 'ACTIVE' and watch.company_id = subject.company_id
                union select watch.user_id from public.watchlist_items watch, subject
                where watch.state = 'ACTIVE' and exists (
                  select 1 from public.job_opportunities opportunity
                  where opportunity.id = watch.opportunity_id
                    and opportunity.company_id = subject.company_id
                )
              ) select candidate.user_id from candidates candidate
                join public.users user_row on user_row.id = candidate.user_id and user_row.status = 'ACTIVE'
                left join public.user_notification_preferences notification on notification.user_id = candidate.user_id
                where coalesce(notification.in_app_enabled, true) and candidate.user_id > coalesce(%s, '00000000-0000-0000-0000-000000000000')
                order by candidate.user_id limit %s
            """
            params = (request["company_interview_question_id"], after_user_id, FANOUT_BATCH + 1)
        elif trigger == "RECRUITING_DATE":
            query = """
              with subject as (select * from public.recruiting_dates where id = %s),
              candidates as (
                select watch.user_id from public.watchlist_items watch, subject
                where watch.state = 'ACTIVE' and (
                  watch.company_id = subject.company_id or watch.school_id = subject.school_id or
                  (watch.opportunity_id is not null and exists (
                    select 1 from public.job_opportunity_postings membership
                    where membership.opportunity_id = watch.opportunity_id
                      and membership.job_id = subject.job_id and membership.valid_to is null
                  ))
                )
                union select target.user_id from public.user_target_schools target, subject
                  where target.school_id = subject.school_id
              ) select distinct candidate.user_id from candidates candidate
                join public.users user_row on user_row.id = candidate.user_id and user_row.status = 'ACTIVE'
                left join public.user_notification_preferences notification on notification.user_id = candidate.user_id
                where coalesce(notification.in_app_enabled, true) and candidate.user_id > coalesce(%s, '00000000-0000-0000-0000-000000000000')
                order by candidate.user_id limit %s
            """
            params = (request["recruiting_date_id"], after_user_id, FANOUT_BATCH + 1)
        elif trigger == "RECRUITING_EVENT":
            query = """
              with subject as (select company_id from public.recruiting_events where id = %s),
              candidates as (
                select watch.user_id from public.watchlist_items watch, subject
                where watch.state = 'ACTIVE' and watch.company_id = subject.company_id
              ) select candidate.user_id from candidates candidate
                join public.users user_row on user_row.id = candidate.user_id and user_row.status = 'ACTIVE'
                left join public.user_notification_preferences notification on notification.user_id = candidate.user_id
                where coalesce(notification.in_app_enabled, true) and candidate.user_id > coalesce(%s, '00000000-0000-0000-0000-000000000000')
                order by candidate.user_id limit %s
            """
            params = (request["recruiting_event_id"], after_user_id, FANOUT_BATCH + 1)
        elif trigger == "SCHEDULED_DUE_SCAN":
            query = """
              with candidates as (
                select user_id from public.watchlist_items where state = 'ACTIVE'
                union select user_id from public.user_recruiting_preferences
                union select user_id from public.user_preferred_role_families
                union select user_id from public.user_preferred_early_career_tracks
                union select user_id from public.user_target_schools
                union select user_id from public.calendar_items
                  where status = 'TODO' and deleted_at is null and starts_at between now() - interval '1 hour' and now() + interval '8 days'
              ) select distinct candidate.user_id from candidates candidate
                join public.users user_row on user_row.id = candidate.user_id and user_row.status = 'ACTIVE'
                left join public.user_notification_preferences notification on notification.user_id = candidate.user_id
                where coalesce(notification.in_app_enabled, true) and candidate.user_id > coalesce(%s, '00000000-0000-0000-0000-000000000000')
                order by candidate.user_id limit %s
            """
            params = (after_user_id, FANOUT_BATCH + 1)
        else:
            return []
        cursor = await connection.execute(query, params)
        return [UUID(str(row["user_id"])) for row in await cursor.fetchall()]

    async def _enqueue_user_request(
        self,
        connection: psycopg.AsyncConnection[dict[str, Any]],
        parent: dict[str, Any],
        user_id: UUID,
    ) -> None:
        fingerprint = _fingerprint("m9-owner-evaluation", parent["id"], user_id)
        cursor = await connection.execute(
            """
            insert into public.alert_evaluation_requests (
              user_id, parent_request_id, trigger_type, opportunity_change_event_id,
              recruiting_event_id, recruiting_date_id, recruiter_profile_id,
              campus_recruiting_event_id, company_interview_question_id,
              calendar_item_id, request_fingerprint, safe_context
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (request_fingerprint) do update
              set request_fingerprint = excluded.request_fingerprint
            returning id
            """,
            (
                user_id,
                parent["id"],
                parent["trigger_type"],
                parent["opportunity_change_event_id"],
                parent["recruiting_event_id"],
                parent["recruiting_date_id"],
                parent["recruiter_profile_id"],
                parent["campus_recruiting_event_id"],
                parent["company_interview_question_id"],
                parent["calendar_item_id"],
                fingerprint,
                parent["safe_context"],
            ),
        )
        child = await cursor.fetchone()
        if child is None:
            raise RuntimeError("owner alert request was not created")
        child_id = child["id"]
        await connection.execute(
            """
            insert into public.work_items (
              work_type, work_class, alert_evaluation_request_id, user_id,
              priority, idempotency_fingerprint, exclusive_key, correlation_id
            ) values (
              'ALERT_EVALUATE', 'PERSONALIZATION', %s, %s, 60, %s,
              'm9-alert-user:' || %s::text, gen_random_uuid()
            ) on conflict (idempotency_fingerprint) do nothing
            """,
            (child_id, user_id, _fingerprint("m9-evaluate", child_id, user_id), user_id),
        )

    async def evaluate(self, work: ClaimedWork) -> WorkExecutionResult:
        if work.alert_evaluation_request_id is None or work.user_id is None:
            raise ValueError("alert evaluation work requires request and owner")
        async with await self._connect() as connection:
            async with connection.transaction():
                request = await self._request(connection, work.alert_evaluation_request_id)
                if UUID(str(request["user_id"])) != work.user_id:
                    raise PermissionError("alert request owner mismatch")
                enabled = await self._enabled_types(connection, work.user_id)
                if not enabled:
                    return WorkExecutionResult(coverage=CoverageStatus.COMPLETE, processed=0)
                inserted = await self._evaluate_request(connection, request, enabled)
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            processed=inserted,
            diagnostics={"channel": "IN_APP"},
        )

    async def _enabled_types(
        self, connection: psycopg.AsyncConnection[dict[str, Any]], user_id: UUID
    ) -> set[str]:
        cursor = await connection.execute(
            """
            select coalesce(master.in_app_enabled, true) as in_app_enabled,
              type.alert_type::text, coalesce(
                preference.enabled,
                type.alert_type <> 'RECOMMENDED_OPPORTUNITY_OPENED'
              ) or exists (
                select 1 from public.watchlist_items watch
                where watch.user_id = %s and watch.state = 'ACTIVE'
                  and watch.notification_override = 'ENABLED'
              ) as enabled
            from unnest(enum_range(null::public.alert_type)) type(alert_type)
            left join public.user_notification_preferences master on master.user_id = %s
            left join public.user_alert_type_preferences preference
              on preference.user_id = %s and preference.alert_type = type.alert_type
            """,
            (user_id, user_id, user_id),
        )
        rows = await cursor.fetchall()
        if rows and not rows[0]["in_app_enabled"]:
            return set()
        return {str(row["alert_type"]) for row in rows if row["enabled"]}

    async def _type_allowed_at(
        self,
        connection: Connection,
        user_id: UUID,
        alert_type: str,
        occurred_at: datetime,
        watch_override: str | None = None,
    ) -> bool:
        """Apply master, type, temporal activation, then an applicable watch override."""
        cursor = await connection.execute(
            """
            select coalesce(master.in_app_enabled, true) master_enabled,
              coalesce(master.activated_at, user_row.created_at) master_activated_at,
              type_preference.enabled type_enabled,
              type_preference.updated_at type_activated_at
            from public.users user_row
            left join public.user_notification_preferences master on master.user_id = user_row.id
            left join public.user_alert_type_preferences type_preference
              on type_preference.user_id = user_row.id and type_preference.alert_type = %s
            where user_row.id = %s
            """,
            (alert_type, user_id),
        )
        row = await cursor.fetchone()
        if row is None or not row["master_enabled"]:
            return False
        if row["master_activated_at"] > occurred_at:
            return False
        if watch_override == "DISABLED":
            return False
        if watch_override == "ENABLED":
            return True
        default_enabled = alert_type != "RECOMMENDED_OPPORTUNITY_OPENED"
        if row["type_enabled"] is None:
            return default_enabled
        if row["type_enabled"] and row["type_activated_at"] > occurred_at:
            return False
        return bool(row["type_enabled"])

    async def _applicable_watch(
        self,
        connection: Connection,
        user_id: UUID,
        occurred_at: datetime,
        *,
        opportunity_id: UUID | None = None,
        company_id: UUID | None = None,
        recruiter_profile_id: UUID | None = None,
        school_id: UUID | None = None,
    ) -> tuple[bool, str | None]:
        """Return the most-specific watch that existed when the event occurred."""
        cursor = await connection.execute(
            """
            select notification_override::text
            from public.watchlist_items
            where user_id = %s and state = 'ACTIVE' and created_at <= %s and (
              (%s::uuid is not null and opportunity_id = %s) or
              (%s::uuid is not null and recruiter_profile_id = %s) or
              (%s::uuid is not null and school_id = %s) or
              (%s::uuid is not null and company_id = %s)
            )
            order by case
              when opportunity_id is not null then 0
              when recruiter_profile_id is not null then 1
              when school_id is not null then 2
              else 3 end,
              case notification_override when 'DISABLED' then 0 when 'ENABLED' then 1 else 2 end,
              created_at, id
            limit 1
            """,
            (
                user_id,
                occurred_at,
                opportunity_id,
                opportunity_id,
                recruiter_profile_id,
                recruiter_profile_id,
                school_id,
                school_id,
                company_id,
                company_id,
            ),
        )
        row = await cursor.fetchone()
        return (False, None) if row is None else (True, str(row["notification_override"]))

    async def _evaluate_request(
        self,
        connection: psycopg.AsyncConnection[dict[str, Any]],
        request: dict[str, Any],
        enabled: set[str],
    ) -> int:
        trigger = request["trigger_type"]
        if trigger == "OPPORTUNITY_CHANGE":
            return await self._opportunity_alerts(connection, request, enabled)
        if trigger == "RECRUITER":
            return await self._recruiter_alert(connection, request, enabled)
        if trigger == "CAMPUS_EVENT":
            return await self._campus_alert(connection, request, enabled)
        if trigger == "INTERVIEW_INTELLIGENCE":
            return await self._interview_alert(connection, request, enabled)
        if trigger == "RECRUITING_DATE":
            return await self._recruiting_date_alert(connection, request, enabled)
        if trigger == "RECRUITING_EVENT":
            return await self._recruiting_event_alert(connection, request, enabled)
        if trigger == "CALENDAR_ITEM":
            return await self._calendar_alert(connection, request, enabled)
        if trigger == "SCHEDULED_DUE_SCAN":
            return await self._scheduled_alerts(connection, request, enabled)
        return 0

    async def _insert_alert(
        self,
        connection: psycopg.AsyncConnection[dict[str, Any]],
        *,
        user_id: UUID,
        alert_type: str,
        entity_key: str,
        title: str,
        body: str,
        reasons: list[str],
        occurred_at: datetime,
        reminder_window: str = "NONE",
        expires_at: datetime | None = None,
        opportunity_id: UUID | None = None,
        company_id: UUID | None = None,
        recruiter_profile_id: UUID | None = None,
        school_id: UUID | None = None,
        campus_event_id: UUID | None = None,
        recruiting_date_id: UUID | None = None,
        interview_question_id: UUID | None = None,
        calendar_item_id: UUID | None = None,
        opportunity_change_event_id: UUID | None = None,
        algorithm_version: str | None = None,
    ) -> int:
        dedupe = _fingerprint(1, user_id, alert_type, entity_key, reminder_window, RULE_VERSION)
        status = await self.provider.deliver(
            connection,
            NotificationCandidate(
                user_id=user_id,
                alert_type=alert_type,
                entity_key=entity_key,
                title=title,
                body=body,
                reason_codes=tuple(reasons),
                occurred_at=occurred_at,
                dedupe_fingerprint=dedupe,
                rule_version=RULE_VERSION,
                reminder_window=reminder_window,
                expires_at=expires_at,
                opportunity_id=opportunity_id,
                company_id=company_id,
                recruiter_profile_id=recruiter_profile_id,
                school_id=school_id,
                campus_event_id=campus_event_id,
                recruiting_date_id=recruiting_date_id,
                interview_question_id=interview_question_id,
                calendar_item_id=calendar_item_id,
                opportunity_change_event_id=opportunity_change_event_id,
                algorithm_version=algorithm_version,
            ),
        )
        return 1 if status == "CREATED" else 0

    async def _user_context(
        self, connection: psycopg.AsyncConnection[dict[str, Any]], user_id: UUID
    ) -> tuple[dict[str, Any], dict[str, set[str]]]:
        cursor = await connection.execute(
            """
            select preference.graduation_year, preference.us_work_authorized,
              preference.requires_employer_sponsorship,
              coalesce((select array_agg(role_family::text) from public.user_preferred_role_families where user_id = %s), '{}') roles,
              coalesce((select array_agg(track::text) from public.user_preferred_early_career_tracks where user_id = %s), '{}') tracks,
              coalesce((select array_agg(experience_level::text) from public.user_preferred_experience_levels where user_id = %s), '{}') levels,
              coalesce((select array_agg(workplace_mode::text) from public.user_preferred_workplace_modes where user_id = %s), '{}') modes
            from public.users user_row left join public.user_recruiting_preferences preference
              on preference.user_id = user_row.id where user_row.id = %s
            """,
            (user_id, user_id, user_id, user_id, user_id),
        )
        row = await cursor.fetchone()
        if row is None:
            raise ValueError("user was not found")
        location_cursor = await connection.execute(
            """select kind::text, city, region, country_code, remote_region
               from public.user_preferred_locations where user_id = %s""",
            (user_id,),
        )
        watch_cursor = await connection.execute(
            """select company_id, opportunity_id, recruiter_profile_id, school_id
               from public.watchlist_items where user_id = %s and state = 'ACTIVE'""",
            (user_id,),
        )
        watch_rows = await watch_cursor.fetchall()
        preferences = {
            "graduationYear": row["graduation_year"],
            "usWorkAuthorized": row["us_work_authorized"],
            "requiresEmployerSponsorship": row["requires_employer_sponsorship"],
            "roleFamilies": list(row["roles"]),
            "earlyCareerTracks": list(row["tracks"]),
            "experienceLevels": list(row["levels"]),
            "workplaceModes": list(row["modes"]),
            "locations": [
                {
                    "kind": item["kind"],
                    "city": item["city"],
                    "region": item["region"],
                    "countryCode": item["country_code"],
                    "remoteRegion": item["remote_region"],
                }
                for item in await location_cursor.fetchall()
            ],
        }
        watches = {
            "companies": _set(watch_rows, "company_id"),
            "opportunities": _set(watch_rows, "opportunity_id"),
            "recruiters": _set(watch_rows, "recruiter_profile_id"),
            "schools": _set(watch_rows, "school_id"),
        }
        return preferences, watches

    async def _opportunity_subject(
        self, connection: psycopg.AsyncConnection[dict[str, Any]], event_id: UUID
    ) -> dict[str, Any] | None:
        cursor = await connection.execute(
            """
            with recursive chain as (
              select opportunity.*, 0 depth from public.opportunity_change_events event
              join public.job_opportunities opportunity on opportunity.id = event.opportunity_id
              where event.id = %s
              union all select successor.*, chain.depth + 1 from chain
                join public.job_opportunities successor on successor.id = chain.superseded_by_id
                where chain.depth < 20
            ), resolved as (select * from chain order by depth desc limit 1),
            locations as (
              select membership.opportunity_id, jsonb_agg(distinct jsonb_build_object(
                'city', location.city, 'region', location.region,
                'countryCode', location.country_code, 'remoteRegion', location.remote_region
              )) value from public.job_opportunity_postings membership
              join public.job_locations location on location.job_id = membership.job_id
              where membership.valid_to is null group by membership.opportunity_id
            ), constraints as (
              select membership.opportunity_id, array_agg(distinct constraint_row.constraint_type::text) value
              from public.job_opportunity_postings membership
              join public.job_constraints constraint_row on constraint_row.job_id = membership.job_id
              where membership.valid_to is null and constraint_row.explicit group by membership.opportunity_id
            )
            select resolved.*, event.id event_id, event.event_type::text,
              event.change_version, event.occurred_at, company.canonical_name company_name,
              coalesce(locations.value, '[]') locations,
              coalesce(constraints.value, '{}') constraints,
              greatest(resolved.created_at, coalesce(resolved.published_at, resolved.earliest_first_seen_at)) effective_opened_at,
              coalesce(capability.authority::text, 'UNREVIEWED') source_authority,
              coalesce(capability.reviewed, false) source_authority_reviewed
            from resolved join public.opportunity_change_events event on event.id = %s
            join public.companies company on company.id = resolved.company_id
            left join public.jobs canonical on canonical.id = resolved.canonical_source_posting_id
            left join public.source_job_capabilities capability on capability.source_id = canonical.source_id
            left join locations on locations.opportunity_id = resolved.id
            left join constraints on constraints.opportunity_id = resolved.id
            """,
            (event_id, event_id),
        )
        return await cursor.fetchone()

    @staticmethod
    def _score_facts(row: dict[str, Any]) -> dict[str, Any]:
        constraints = set(row["constraints"])
        return {
            "opportunityId": str(row["id"]),
            "companyId": str(row["company_id"]),
            "status": row["status"],
            "lifecycleStatus": row["lifecycle_status"],
            "roleFamily": row["role_family"],
            "experienceLevel": row["experience_level"],
            "isInternship": row["is_internship"],
            "isNewGrad": row["is_new_grad"],
            "graduationYears": list(row["graduation_years"]),
            "workplaceMode": row["workplace_mode"],
            "locations": row["locations"],
            "effectiveOpenedAt": row["effective_opened_at"],
            "deadlineAt": row["deadline_at"],
            "deadlineReliable": row["source_authority_reviewed"],
            "sourceAuthority": row["source_authority"],
            "sourceAuthorityReviewed": row["source_authority_reviewed"],
            "sponsorshipAvailable": True if "SPONSORSHIP_AVAILABLE" in constraints else None,
            "sponsorshipUnavailable": True if "SPONSORSHIP_UNAVAILABLE" in constraints else None,
            "workAuthorizationRequired": (
                True
                if {"WORK_AUTHORIZATION_REQUIRED", "CITIZENSHIP_REQUIRED"} & constraints
                else None
            ),
        }

    async def _opportunity_alerts(
        self,
        connection: psycopg.AsyncConnection[dict[str, Any]],
        request: dict[str, Any],
        enabled: set[str],
    ) -> int:
        row = await self._opportunity_subject(connection, request["opportunity_change_event_id"])
        if row is None or row["event_type"] not in {"CREATED", "OPENED", "REOPENED"}:
            return 0
        user_id = UUID(str(request["user_id"]))
        preferences, watches = await self._user_context(connection, user_id)
        score = score_opportunity(
            preferences, watches, self._score_facts(row), as_of=datetime.now(UTC)
        )
        count = 0
        opportunity_id, company_id = UUID(str(row["id"])), UUID(str(row["company_id"]))
        open_key = f"{opportunity_id}:open-cycle:{row['change_version']}"
        watched_company, company_override = await self._applicable_watch(
            connection,
            user_id,
            row["occurred_at"],
            company_id=company_id,
        )
        watched_open_enabled = await self._type_allowed_at(
            connection,
            user_id,
            "WATCHED_COMPANY_OPPORTUNITY_OPENED",
            row["occurred_at"],
            company_override,
        )
        track_matches = (
            not preferences["earlyCareerTracks"]
            or (row["is_internship"] and "INTERNSHIP" in preferences["earlyCareerTracks"])
            or (row["is_new_grad"] and "NEW_GRAD" in preferences["earlyCareerTracks"])
        )
        if (
            "WATCHED_COMPANY_OPPORTUNITY_OPENED" in enabled
            and watched_company
            and watched_open_enabled
            and track_matches
            and score["eligibility"] != "NOT_ELIGIBLE"
        ):
            count += await self._insert_alert(
                connection,
                user_id=user_id,
                alert_type="WATCHED_COMPANY_OPPORTUNITY_OPENED",
                entity_key=open_key,
                title=f"New opportunity at {row['company_name']}",
                body=f"{row['normalized_title']} is now open.",
                reasons=["WATCHED_COMPANY", "CANONICAL_OPPORTUNITY_OPENED"],
                occurred_at=row["occurred_at"],
                expires_at=datetime.now(UTC) + timedelta(days=30),
                opportunity_id=opportunity_id,
                company_id=company_id,
                opportunity_change_event_id=row["event_id"],
                algorithm_version=ALGORITHM_VERSION,
            )
        recommended_enabled = await self._type_allowed_at(
            connection,
            user_id,
            "RECOMMENDED_OPPORTUNITY_OPENED",
            row["occurred_at"],
        )
        if (
            "RECOMMENDED_OPPORTUNITY_OPENED" in enabled
            and recommended_enabled
            and score["category"] == "HIGH_PRIORITY"
            and score["eligibility"] == "ELIGIBLE"
        ):
            count += await self._insert_alert(
                connection,
                user_id=user_id,
                alert_type="RECOMMENDED_OPPORTUNITY_OPENED",
                entity_key=open_key,
                title="High-priority opportunity opened",
                body=f"{row['company_name']} — {row['normalized_title']} matches your explicit preferences.",
                reasons=["HIGH_PRIORITY_RECOMMENDATION", *score["reasonCodes"]][:16],
                occurred_at=row["occurred_at"],
                expires_at=datetime.now(UTC) + timedelta(days=30),
                opportunity_id=opportunity_id,
                company_id=company_id,
                opportunity_change_event_id=row["event_id"],
                algorithm_version=ALGORITHM_VERSION,
            )
        count += await self._deadline_for_opportunity(
            connection, user_id, row, enabled, score["category"]
        )
        return count

    async def _deadline_for_opportunity(
        self,
        connection: psycopg.AsyncConnection[dict[str, Any]],
        user_id: UUID,
        row: dict[str, Any],
        enabled: set[str],
        recommendation_category: str | None = None,
    ) -> int:
        if (
            "APPLICATION_DEADLINE_APPROACHING" not in enabled
            or not row.get("deadline_at")
            or not row.get("source_authority_reviewed", False)
        ):
            return 0
        now = datetime.now(UTC)
        deadline = row["deadline_at"].astimezone(UTC)
        hours = (deadline - now).total_seconds() / 3600
        windows = [(168, "SEVEN_DAY"), (72, "THREE_DAY"), (24, "ONE_DAY")]
        match = next(
            (
                (hours_value, name)
                for hours_value, name in windows
                if abs(hours - hours_value) <= 1.5
            ),
            None,
        )
        if not match:
            return 0
        watched, watch_override = await self._applicable_watch(
            connection,
            user_id,
            now,
            opportunity_id=UUID(str(row["id"])),
            company_id=UUID(str(row["company_id"])),
        )
        if not watched and recommendation_category != "HIGH_PRIORITY":
            return 0
        if not await self._type_allowed_at(
            connection,
            user_id,
            "APPLICATION_DEADLINE_APPROACHING",
            now,
            watch_override,
        ):
            return 0
        _, window = match
        return await self._insert_alert(
            connection,
            user_id=user_id,
            alert_type="APPLICATION_DEADLINE_APPROACHING",
            entity_key=f"{row['id']}:{deadline.isoformat()}",
            reminder_window=window,
            title=f"Application deadline: {row['company_name']}",
            body=f"{row['normalized_title']} reaches its {window.lower().replace('_', '-')} reminder window.",
            reasons=["CONFIRMED_DEADLINE", f"{window}_REMINDER"],
            occurred_at=now,
            expires_at=deadline + timedelta(days=1),
            opportunity_id=row["id"],
            company_id=row["company_id"],
        )

    async def _recruiter_alert(
        self, connection: Connection, request: Request, enabled: EnabledTypes
    ) -> int:
        context = request.get("safe_context") or {}
        kind = context.get("eventKind", "RECRUITER_DISCOVERED")
        alert_type = (
            "WATCHED_RECRUITER_ACTIVITY"
            if kind == "RECRUITER_ACTIVITY"
            else "WATCHED_RECRUITER_DISCOVERED"
        )
        if alert_type not in enabled:
            return 0
        cursor = await connection.execute(
            """select recruiter.id, recruiter.company_id, recruiter.title, person.canonical_name,
                      company.canonical_name company_name, recruiter.last_seen_at,
                      coalesce(array_agg(distinct relationship.school_id)
                        filter (where relationship.school_id is not null), '{}') schools
                 from public.recruiter_profiles recruiter join public.people person on person.id = recruiter.person_id
                 join public.companies company on company.id = recruiter.company_id
                 left join public.recruiter_school_relationships relationship
                   on relationship.recruiter_profile_id = recruiter.id
                 where recruiter.id = %s
                 group by recruiter.id, recruiter.company_id, recruiter.title,
                   person.canonical_name, company.canonical_name, recruiter.last_seen_at""",
            (request["recruiter_profile_id"],),
        )
        row = await cursor.fetchone()
        if not row:
            return 0
        user_id = UUID(str(request["user_id"]))
        watched, watch_override = await self._applicable_watch(
            connection,
            user_id,
            row["last_seen_at"],
            recruiter_profile_id=UUID(str(row["id"])),
            company_id=UUID(str(row["company_id"])),
        )
        school_cursor = await connection.execute(
            """select exists (select 1 from public.user_target_schools
                 where user_id = %s and school_id = any(%s::uuid[])) target_school""",
            (user_id, row["schools"]),
        )
        school_match = await school_cursor.fetchone()
        if not watched and not (school_match and school_match["target_school"]):
            return 0
        if not await self._type_allowed_at(
            connection, user_id, alert_type, row["last_seen_at"], watch_override
        ):
            return 0
        day = row["last_seen_at"].date().isoformat()
        return await self._insert_alert(
            connection,
            user_id=user_id,
            alert_type=alert_type,
            entity_key=f"{row['id']}:{day}",
            title=f"Recruiter update at {row['company_name']}",
            body=f"{row['canonical_name']} — {row['title']} has new public recruiting intelligence.",
            reasons=[kind],
            occurred_at=row["last_seen_at"],
            expires_at=datetime.now(UTC) + timedelta(days=14),
            recruiter_profile_id=row["id"],
            company_id=row["company_id"],
        )

    async def _campus_alert(
        self, connection: Connection, request: Request, enabled: EnabledTypes
    ) -> int:
        if "CAMPUS_EVENT_DISCOVERED" not in enabled:
            return 0
        cursor = await connection.execute(
            """select event.*, company.canonical_name company_name from public.campus_recruiting_events event
                 join public.companies company on company.id = event.company_id where event.id = %s""",
            (request["campus_recruiting_event_id"],),
        )
        row = await cursor.fetchone()
        if not row:
            return 0
        occurred = row["starts_at"]
        if occurred is None and row["date_start"] is not None:
            occurred = datetime.combine(row["date_start"], datetime.min.time(), tzinfo=UTC)
        if occurred is None:
            occurred = row["first_seen_at"]
        user_id = UUID(str(request["user_id"]))
        company_watch, watch_override = await self._applicable_watch(
            connection,
            user_id,
            occurred,
            company_id=UUID(str(row["company_id"])),
        )
        school_cursor = await connection.execute(
            """select exists (select 1 from public.user_target_schools
                   where user_id = %s and school_id = %s) target_school,
                      exists (select 1 from public.watchlist_items
                   where user_id = %s and state = 'ACTIVE' and school_id = %s
                     and created_at <= %s) watched_school""",
            (user_id, row["school_id"], user_id, row["school_id"], occurred),
        )
        school_match = await school_cursor.fetchone()
        if (
            not company_watch
            or school_match is None
            or not (school_match["target_school"] or school_match["watched_school"])
            or not await self._type_allowed_at(
                connection,
                user_id,
                "CAMPUS_EVENT_DISCOVERED",
                occurred,
                watch_override,
            )
        ):
            return 0
        return await self._insert_alert(
            connection,
            user_id=user_id,
            alert_type="CAMPUS_EVENT_DISCOVERED",
            entity_key=f"{row['id']}:{row['content_hash']}",
            title=f"Campus event: {row['company_name']}",
            body=row["title"],
            reasons=["WATCHED_COMPANY", "TARGET_SCHOOL", "CAMPUS_EVENT_DISCOVERED"],
            occurred_at=occurred,
            expires_at=(row["ends_at"] or row["starts_at"] or datetime.now(UTC))
            + timedelta(days=1),
            company_id=row["company_id"],
            school_id=row["school_id"],
            campus_event_id=row["id"],
        )

    async def _interview_alert(
        self, connection: Connection, request: Request, enabled: EnabledTypes
    ) -> int:
        if "INTERVIEW_INTELLIGENCE_UPDATED" not in enabled:
            return 0
        cursor = await connection.execute(
            """select item.*, company.canonical_name company_name from public.company_interview_questions item
                 join public.companies company on company.id = item.company_id where item.id = %s""",
            (request["company_interview_question_id"],),
        )
        row = await cursor.fetchone()
        if not row:
            return 0
        user_id = UUID(str(request["user_id"]))
        watched, watch_override = await self._applicable_watch(
            connection,
            user_id,
            row["last_seen_at"],
            company_id=UUID(str(row["company_id"])),
        )
        if not watched or not await self._type_allowed_at(
            connection,
            user_id,
            "INTERVIEW_INTELLIGENCE_UPDATED",
            row["last_seen_at"],
            watch_override,
        ):
            return 0
        return await self._insert_alert(
            connection,
            user_id=user_id,
            alert_type="INTERVIEW_INTELLIGENCE_UPDATED",
            entity_key=f"{row['id']}:{row['last_seen_at'].isoformat()}",
            title=f"Interview intelligence updated: {row['company_name']}",
            body="RecruitIntel observed meaningful new interview-question evidence.",
            reasons=["WATCHED_COMPANY", "INTERVIEW_EVIDENCE_UPDATED"],
            occurred_at=row["last_seen_at"],
            expires_at=datetime.now(UTC) + timedelta(days=30),
            company_id=row["company_id"],
            interview_question_id=row["id"],
        )

    async def _recruiting_date_alert(
        self, connection: Connection, request: Request, enabled: EnabledTypes
    ) -> int:
        cursor = await connection.execute(
            "select * from public.recruiting_dates where id = %s", (request["recruiting_date_id"],)
        )
        row = await cursor.fetchone()
        if not row:
            return 0
        if row["type"] in {"APPLICATION_OPEN", "EXPECTED_OPENING_WINDOW"}:
            return await self._opening_window_alert(connection, request["user_id"], row, enabled)
        if row["type"] == "APPLICATION_DEADLINE":
            return await self._date_deadline_alert(connection, request["user_id"], row, enabled)
        return 0

    async def _opening_window_alert(
        self,
        connection: Connection,
        user_id: UUID,
        row: dict[str, Any],
        enabled: EnabledTypes,
    ) -> int:
        if "OPENING_WINDOW_STARTED" not in enabled:
            return 0
        now = datetime.now(UTC)
        if not (
            now - timedelta(hours=1, minutes=30) <= row["starts_at"] <= now + timedelta(minutes=30)
        ):
            return 0
        watched, watch_override = await self._applicable_watch(
            connection,
            user_id,
            row["starts_at"],
            company_id=row["company_id"],
            school_id=row["school_id"],
        )
        if not watched or not await self._type_allowed_at(
            connection,
            user_id,
            "OPENING_WINDOW_STARTED",
            row["starts_at"],
            watch_override,
        ):
            return 0
        return await self._insert_alert(
            connection,
            user_id=user_id,
            alert_type="OPENING_WINDOW_STARTED",
            entity_key=f"{row['id']}:{row['starts_at'].isoformat()}",
            title="Recruiting window started",
            body=row["title"],
            reasons=["OPENING_WINDOW_STARTED"],
            occurred_at=row["starts_at"],
            expires_at=(row["ends_at"] or row["starts_at"] + timedelta(days=1)),
            company_id=row["company_id"],
            school_id=row["school_id"],
            recruiting_date_id=row["id"],
        )

    async def _date_deadline_alert(
        self,
        connection: Connection,
        user_id: UUID,
        row: dict[str, Any],
        enabled: EnabledTypes,
    ) -> int:
        if "APPLICATION_DEADLINE_APPROACHING" not in enabled:
            return 0
        hours = (row["starts_at"] - datetime.now(UTC)).total_seconds() / 3600
        match = next(
            (
                (value, name)
                for value, name in [(168, "SEVEN_DAY"), (72, "THREE_DAY"), (24, "ONE_DAY")]
                if abs(hours - value) <= 1.5
            ),
            None,
        )
        if not match:
            return 0
        watched, watch_override = await self._applicable_watch(
            connection,
            user_id,
            datetime.now(UTC),
            company_id=row["company_id"],
            school_id=row["school_id"],
        )
        if not watched or not await self._type_allowed_at(
            connection,
            user_id,
            "APPLICATION_DEADLINE_APPROACHING",
            datetime.now(UTC),
            watch_override,
        ):
            return 0
        _, window = match
        return await self._insert_alert(
            connection,
            user_id=user_id,
            alert_type="APPLICATION_DEADLINE_APPROACHING",
            entity_key=f"date:{row['id']}:{row['starts_at'].isoformat()}",
            reminder_window=window,
            title="Application deadline approaching",
            body=row["title"],
            reasons=[f"{window}_REMINDER"],
            occurred_at=datetime.now(UTC),
            expires_at=row["starts_at"] + timedelta(days=1),
            company_id=row["company_id"],
            school_id=row["school_id"],
            recruiting_date_id=row["id"],
        )

    async def _recruiting_event_alert(
        self, connection: Connection, request: Request, enabled: EnabledTypes
    ) -> int:
        cursor = await connection.execute(
            """select event.*, company.canonical_name company_name from public.recruiting_events event
                 join public.companies company on company.id = event.company_id where event.id = %s""",
            (request["recruiting_event_id"],),
        )
        row = await cursor.fetchone()
        if not row:
            return 0
        alert_type = (
            "WATCHED_RECRUITER_ACTIVITY"
            if row["event_type"] == "RECRUITER_ACTIVITY"
            else "WATCHED_RECRUITER_DISCOVERED"
        )
        if alert_type not in enabled:
            return 0
        user_id = UUID(str(request["user_id"]))
        watched, watch_override = await self._applicable_watch(
            connection,
            user_id,
            row["occurred_at"],
            company_id=UUID(str(row["company_id"])),
        )
        if not watched or not await self._type_allowed_at(
            connection, user_id, alert_type, row["occurred_at"], watch_override
        ):
            return 0
        return await self._insert_alert(
            connection,
            user_id=user_id,
            alert_type=alert_type,
            entity_key=f"event:{row['id']}",
            title=f"Recruiting update at {row['company_name']}",
            body="RecruitIntel observed a meaningful public recruiter update.",
            reasons=[row["event_type"]],
            occurred_at=row["occurred_at"],
            expires_at=datetime.now(UTC) + timedelta(days=14),
            company_id=row["company_id"],
        )

    async def _calendar_alert(
        self, connection: Connection, request: Request, enabled: EnabledTypes
    ) -> int:
        if "CALENDAR_ACTION_DUE" not in enabled:
            return 0
        cursor = await connection.execute(
            "select * from public.calendar_items where id = %s and user_id = %s",
            (request["calendar_item_id"], request["user_id"]),
        )
        row = await cursor.fetchone()
        if not row or row["status"] != "TODO" or row["deleted_at"] is not None:
            return 0
        now = datetime.now(UTC)
        if not (
            now - timedelta(hours=1, minutes=30) <= row["starts_at"] <= now + timedelta(minutes=30)
        ):
            return 0
        if not await self._type_allowed_at(
            connection, UUID(str(request["user_id"])), "CALENDAR_ACTION_DUE", row["starts_at"]
        ):
            return 0
        return await self._insert_alert(
            connection,
            user_id=request["user_id"],
            alert_type="CALENDAR_ACTION_DUE",
            entity_key=f"{row['id']}:{row['starts_at'].isoformat()}",
            reminder_window="DUE",
            title="Calendar action due",
            body=row["title"],
            reasons=["CALENDAR_ITEM_DUE"],
            occurred_at=row["starts_at"],
            expires_at=row["starts_at"] + timedelta(days=1),
            company_id=row["company_id"],
            calendar_item_id=row["id"],
        )

    async def _scheduled_alerts(
        self, connection: Connection, request: Request, enabled: EnabledTypes
    ) -> int:
        user_id = request["user_id"]
        count = 0
        cursor = await connection.execute(
            """
            select opportunity.*, company.canonical_name company_name,
              coalesce(capability.reviewed, false) source_authority_reviewed
            from public.job_opportunities opportunity
            join public.companies company on company.id = opportunity.company_id
            left join public.jobs canonical on canonical.id = opportunity.canonical_source_posting_id
            left join public.source_job_capabilities capability on capability.source_id = canonical.source_id
            where opportunity.status = 'ACTIVE' and opportunity.lifecycle_status = 'OPEN'
              and opportunity.deadline_at between now() + interval '22 hours' and now() + interval '170 hours'
              and (exists (select 1 from public.watchlist_items watch
                    where watch.user_id = %s and watch.state = 'ACTIVE'
                      and (watch.opportunity_id = opportunity.id or watch.company_id = opportunity.company_id))
                or exists (select 1 from public.user_preferred_role_families role
                    where role.user_id = %s and role.role_family = opportunity.role_family))
            order by opportunity.deadline_at, opportunity.id limit 100
            """,
            (user_id, user_id),
        )
        for row in await cursor.fetchall():
            count += await self._deadline_for_opportunity(connection, user_id, row, enabled)
        date_cursor = await connection.execute(
            """
            select date.* from public.recruiting_dates date
            where date.starts_at between now() - interval '90 minutes' and now() + interval '170 hours'
              and date.type in ('APPLICATION_OPEN', 'EXPECTED_OPENING_WINDOW', 'APPLICATION_DEADLINE')
              and (exists (select 1 from public.watchlist_items watch where watch.user_id = %s
                    and watch.state = 'ACTIVE' and (watch.company_id = date.company_id or watch.school_id = date.school_id))
                or exists (select 1 from public.user_target_schools school where school.user_id = %s and school.school_id = date.school_id))
            order by date.starts_at, date.id limit 100
            """,
            (user_id, user_id),
        )
        for row in await date_cursor.fetchall():
            if row["type"] == "APPLICATION_DEADLINE":
                count += await self._date_deadline_alert(connection, user_id, row, enabled)
            else:
                count += await self._opening_window_alert(connection, user_id, row, enabled)
        calendar_cursor = await connection.execute(
            """select id from public.calendar_items where user_id = %s and status = 'TODO'
                 and deleted_at is null and starts_at between now() - interval '90 minutes' and now() + interval '30 minutes'
                 order by starts_at, id limit 100""",
            (user_id,),
        )
        for row in await calendar_cursor.fetchall():
            child = dict(request)
            child["calendar_item_id"] = row["id"]
            count += await self._calendar_alert(connection, child, enabled)
        return count
