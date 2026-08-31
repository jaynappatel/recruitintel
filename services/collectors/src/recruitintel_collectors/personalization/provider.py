from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol
from uuid import UUID

import psycopg

DeliveryStatus = Literal["CREATED", "ALREADY_EXISTS"]
Connection = psycopg.AsyncConnection[dict[str, Any]]


@dataclass(frozen=True)
class NotificationCandidate:
    """A decided notification. Providers deliver; they never rank or infer eligibility."""

    user_id: UUID
    alert_type: str
    entity_key: str
    title: str
    body: str
    reason_codes: tuple[str, ...]
    occurred_at: datetime
    dedupe_fingerprint: str
    rule_version: str
    reminder_window: str = "NONE"
    expires_at: datetime | None = None
    opportunity_id: UUID | None = None
    company_id: UUID | None = None
    recruiter_profile_id: UUID | None = None
    school_id: UUID | None = None
    campus_event_id: UUID | None = None
    recruiting_date_id: UUID | None = None
    interview_question_id: UUID | None = None
    calendar_item_id: UUID | None = None
    opportunity_change_event_id: UUID | None = None
    algorithm_version: str | None = None


class NotificationProvider(Protocol):
    """Seam for delivery channels. M9 registers only transactional IN_APP."""

    channel: str

    async def deliver(
        self, connection: Connection, candidate: NotificationCandidate
    ) -> DeliveryStatus: ...


class InAppNotificationProvider:
    """Creates the durable mailbox row inside the evaluator's transaction."""

    channel = "IN_APP"

    async def deliver(
        self, connection: Connection, candidate: NotificationCandidate
    ) -> DeliveryStatus:
        cursor = await connection.execute(
            """
            insert into public.alerts (
              user_id, alert_type, opportunity_id, company_id, recruiter_profile_id,
              school_id, campus_recruiting_event_id, recruiting_date_id,
              company_interview_question_id, calendar_item_id,
              opportunity_change_event_id, reminder_window, rule_version,
              algorithm_version, reason_codes, title, body, dedupe_fingerprint,
              occurred_at, expires_at
            ) values (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s, %s, %s, %s
            ) on conflict (user_id, dedupe_fingerprint) do nothing returning id
            """,
            (
                candidate.user_id,
                candidate.alert_type,
                candidate.opportunity_id,
                candidate.company_id,
                candidate.recruiter_profile_id,
                candidate.school_id,
                candidate.campus_event_id,
                candidate.recruiting_date_id,
                candidate.interview_question_id,
                candidate.calendar_item_id,
                candidate.opportunity_change_event_id,
                candidate.reminder_window,
                candidate.rule_version,
                candidate.algorithm_version,
                list(candidate.reason_codes[:16]),
                candidate.title[:240],
                candidate.body[:1000],
                candidate.dedupe_fingerprint,
                candidate.occurred_at,
                candidate.expires_at,
            ),
        )
        return "CREATED" if await cursor.fetchone() else "ALREADY_EXISTS"
