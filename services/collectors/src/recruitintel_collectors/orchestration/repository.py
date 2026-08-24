import hashlib
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from recruitintel_collectors.redaction import redact_value

from .enums import CoverageStatus, WorkClass, WorkStatus
from .models import ClaimedWork, WorkExecutionResult, WorkFailure


class SourcePolicyBlockedError(PermissionError):
    pass


class PostgresOrchestrationRepository:
    def __init__(self, database_url: str) -> None:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        self.database_url = database_url

    async def _connect(self) -> psycopg.AsyncConnection[dict[str, Any]]:
        return await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)

    @staticmethod
    def _claimed(row: dict[str, Any]) -> ClaimedWork:
        return ClaimedWork(
            id=row["id"],
            attempt_id=row["attempt_id"],
            work_type=row["work_type"],
            work_class=row["work_class"],
            source_id=row["source_id"],
            github_sync_request_id=row["github_sync_request_id"],
            public_web_work_request_id=row["public_web_work_request_id"],
            calendar_sync_request_id=row["calendar_sync_request_id"],
            recruiting_observation_id=row["recruiting_observation_id"],
            user_id=row["user_id"],
            lease_token=row["lease_token"],
            lease_generation=row["lease_generation"],
            lease_expires_at=row["lease_expires_at"],
            attempt_count=row["attempt_count"],
            max_attempts=row["max_attempts"],
            correlation_id=row["correlation_id"],
        )

    async def claim(
        self,
        *,
        worker: str,
        classes: tuple[WorkClass, ...],
        limit: int,
        lease_seconds: int,
    ) -> tuple[ClaimedWork, ...]:
        if not classes:
            return ()
        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = await connection.execute(
                    """
                    select * from public.claim_work_items(
                      %s, %s::public.work_class[], %s, %s
                    ) order by priority desc, available_at, id
                    """,
                    (worker, [item.value for item in classes], limit, lease_seconds),
                )
                rows = await cursor.fetchall()
                if rows:
                    cursor = await connection.execute(
                        """
                        select id, work_item_id, lease_token from public.work_attempts
                        where work_item_id = any(%s::uuid[]) and lease_token = any(%s::uuid[])
                        """,
                        (
                            [row["id"] for row in rows],
                            [row["lease_token"] for row in rows],
                        ),
                    )
                    attempts = {
                        (row["work_item_id"], row["lease_token"]): row["id"]
                        for row in await cursor.fetchall()
                    }
                    for row in rows:
                        row["attempt_id"] = attempts[(row["id"], row["lease_token"])]
        return tuple(self._claimed(row) for row in rows)

    async def start(self, work: ClaimedWork) -> None:
        async with await self._connect() as connection:
            await connection.execute(
                "select public.start_work_attempt(%s, %s)", (work.id, work.lease_token)
            )

    async def heartbeat(self, work: ClaimedWork, lease_seconds: int) -> datetime:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                "select public.heartbeat_work_attempt(%s, %s, %s) as expires_at",
                (work.id, work.lease_token, lease_seconds),
            )
            row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("heartbeat returned no lease expiration")
        value = row["expires_at"]
        if not isinstance(value, datetime):
            raise RuntimeError("heartbeat returned an invalid lease expiration")
        return value

    async def finish_success(self, work: ClaimedWork, result: WorkExecutionResult) -> WorkStatus:
        return await self._finish(work, succeeded=True, result=result, failure=None)

    async def finish_failure(self, work: ClaimedWork, failure: WorkFailure) -> WorkStatus:
        return await self._finish(
            work,
            succeeded=False,
            result=WorkExecutionResult(
                coverage=(
                    CoverageStatus.BLOCKED
                    if failure.classification.value == "POLICY_BLOCKED"
                    else CoverageStatus.UNKNOWN
                ),
                diagnostics=redact_value(failure.diagnostics),
            ),
            failure=failure,
        )

    async def _finish(
        self,
        work: ClaimedWork,
        *,
        succeeded: bool,
        result: WorkExecutionResult,
        failure: WorkFailure | None,
    ) -> WorkStatus:
        diagnostics = redact_value(result.diagnostics)
        if not isinstance(diagnostics, dict):
            diagnostics = {"detail": "diagnostics_redacted"}
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select public.finish_work_attempt(
                  %s, %s, %s, %s::public.work_failure_classification, %s, %s,
                  %s::public.coverage_status, %s, %s, %s, %s
                )::text as status
                """,
                (
                    work.id,
                    work.lease_token,
                    succeeded,
                    failure.classification.value if failure else None,
                    failure.code if failure else None,
                    Jsonb(diagnostics),
                    result.coverage.value,
                    result.discovered,
                    result.processed,
                    result.failed,
                    failure.retry_after_seconds if failure else None,
                ),
            )
            row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("work completion returned no status")
        return WorkStatus(row["status"])

    async def assert_source_policy(self, source_id: UUID | None) -> None:
        if source_id is None:
            return
        async with await self._connect() as connection:
            cursor = await connection.execute(
                "select public.source_policy_is_executable(%s) as executable", (source_id,)
            )
            row = await cursor.fetchone()
        if row is None or not row["executable"]:
            raise SourcePolicyBlockedError("source policy is not executable")

    async def assert_source_host_policy(
        self, source_id: UUID, hostname: str, scheme: str, port: int
    ) -> None:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                "select public.source_policy_allows_destination(%s, %s, %s, %s) as executable",
                (source_id, hostname, scheme, port),
            )
            row = await cursor.fetchone()
        if row is None or not row["executable"]:
            raise SourcePolicyBlockedError("source hostname is not approved for collection")

    async def resolve_github_repository_id(self, request_id: UUID) -> UUID:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                "select github_repository_id from public.github_sync_requests where id = %s",
                (request_id,),
            )
            row = await cursor.fetchone()
        if row is None:
            raise KeyError(f"GitHub sync request {request_id} was not found")
        return UUID(str(row["github_repository_id"]))

    async def reap(self, limit: int = 100) -> int:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                "select public.reap_expired_work_items(%s) as count", (limit,)
            )
            row = await cursor.fetchone()
        return int(row["count"] if row else 0)

    async def tick_schedules(self, limit: int = 100) -> int:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                "select public.enqueue_due_schedules(%s) as count", (limit,)
            )
            row = await cursor.fetchone()
        return int(row["count"] if row else 0)

    async def enqueue_recruiter_projection(
        self, observation_id: UUID, *, parent: ClaimedWork
    ) -> UUID | None:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                "select public.enqueue_recruiter_projection(%s, %s, %s) as id",
                (observation_id, parent.id, parent.correlation_id),
            )
            row = await cursor.fetchone()
        return UUID(str(row["id"])) if row and row["id"] else None

    async def enqueue_ats(self, source_id: UUID) -> UUID:
        await self.assert_source_policy(source_id)
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                insert into public.work_items (
                  work_type, work_class, source_id, requesting_actor_kind,
                  priority, scheduled_at, available_at, idempotency_fingerprint,
                  exclusive_key, correlation_id
                ) values (
                  'ATS_COLLECT', 'ATS', %s, 'SYSTEM', 60, now(), now(),
                  encode(digest('manual-ats:' || %s::text || ':' || gen_random_uuid()::text,
                                'sha256'), 'hex'),
                  'ats-source:' || %s::text, gen_random_uuid()
                )
                on conflict (exclusive_key)
                  where exclusive_key is not null
                    and status in ('READY', 'LEASED', 'RUNNING', 'RETRY_WAIT')
                do update set priority = greatest(public.work_items.priority, excluded.priority)
                returning id
                """,
                (source_id, source_id, source_id),
            )
            row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("ATS enqueue returned no work item")
        return UUID(str(row["id"]))

    async def enqueue_github(self, repository_id: UUID) -> UUID:
        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = await connection.execute(
                    """
                    insert into public.github_sync_requests (github_repository_id, requested_by)
                    values (%s, 'diagnostic-cli')
                    on conflict (github_repository_id)
                      where status in ('PENDING', 'RUNNING') do nothing
                    returning id
                    """,
                    (repository_id,),
                )
                row = await cursor.fetchone()
                if row is None:
                    cursor = await connection.execute(
                        """
                        select id from public.github_sync_requests
                        where github_repository_id = %s and status in ('PENDING', 'RUNNING')
                        order by requested_at limit 1
                        """,
                        (repository_id,),
                    )
                    row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("GitHub enqueue returned no request")
        return UUID(str(row["id"]))

    async def enqueue_projection(self, observation_id: UUID) -> UUID:
        correlation = UUID(int=observation_id.int ^ 0x5A5A)
        async with await self._connect() as connection:
            cursor = await connection.execute(
                "select public.enqueue_recruiter_projection(%s, null, %s) as id",
                (observation_id, correlation),
            )
            row = await cursor.fetchone()
            if row and row["id"]:
                return UUID(str(row["id"]))
            cursor = await connection.execute(
                """
                select id from public.work_items
                where work_type = 'RECRUITER_CAMPUS_PROJECT'
                  and recruiting_observation_id = %s
                order by created_at desc limit 1
                """,
                (observation_id,),
            )
            existing = await cursor.fetchone()
        if existing is None:
            raise RuntimeError("recruiter projection enqueue returned no work item")
        return UUID(str(existing["id"]))

    async def privacy_retention_cleanup(self) -> int:
        async with await self._connect() as connection:
            async with connection.transaction():
                counts = []
                for statement in (
                    "delete from public.user_sessions where expires_at <= now()",
                    "delete from public.auth_verifications where expires_at <= now()",
                    "delete from public.calendar_oauth_states where expires_at <= now() "
                    "or consumed_at is not null and consumed_at < now() - interval '1 day'",
                    "delete from public.extension_grants where revoked_at is not null "
                    "and revoked_at < now() - interval '30 days'",
                    "delete from public.rate_limit_states "
                    "where updated_at < now() - interval '7 days'",
                ):
                    cursor = await connection.execute(statement)
                    counts.append(cursor.rowcount)
        return sum(counts)

    async def rollup_source_health(self) -> int:
        async with await self._connect() as connection:
            cursor = await connection.execute("select public.rollup_source_health(20) as count")
            row = await cursor.fetchone()
        return int(row["count"] if row else 0)

    async def acquire_rate_limit(
        self, scope_type: str, scope_key: str, minimum_interval_seconds: float
    ) -> float:
        digest = hashlib.sha256(scope_key.encode()).hexdigest()
        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = await connection.execute(
                    """
                    select next_allowed_at from public.rate_limit_states
                    where scope_type = %s and scope_key_hash = %s for update
                    """,
                    (scope_type, digest),
                )
                row = await cursor.fetchone()
                cursor = await connection.execute(
                    "select greatest(0, extract(epoch from (%s::timestamptz - now()))) as wait",
                    (row["next_allowed_at"] if row else None,),
                )
                wait_row = await cursor.fetchone()
                wait = float(wait_row["wait"] or 0) if wait_row else 0.0
                await connection.execute(
                    """
                    insert into public.rate_limit_states (
                      scope_type, scope_key_hash, next_allowed_at
                    ) values (%s, %s, now() + make_interval(secs => %s))
                    on conflict (scope_type, scope_key_hash) do update set
                      next_allowed_at = greatest(
                        coalesce(public.rate_limit_states.next_allowed_at, now()), now()
                      ) + make_interval(secs => %s), updated_at = now()
                    """,
                    (scope_type, digest, minimum_interval_seconds, minimum_interval_seconds),
                )
        return wait
