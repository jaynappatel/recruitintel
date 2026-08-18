import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from recruitintel_collectors.domain.enums import (
    CollectorStage,
    JobTransition,
    RecruitingEventType,
)
from recruitintel_collectors.domain.fingerprints import fingerprint_event, job_fingerprint_document
from recruitintel_collectors.domain.models import (
    CollectorResult,
    RecruitingEvent,
    SourceConfig,
    StoredJob,
    SyncStats,
)

from .transitions import decide_job_transition, ensure_unique_external_ids


class RunAlreadyActiveError(RuntimeError):
    pass


class InMemoryRepository:
    """Deterministic repository test double exercising the same lifecycle decisions."""

    def __init__(
        self,
        sources: tuple[SourceConfig, ...],
        *,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.sources = {source.id: source for source in sources}
        self.jobs: dict[tuple[UUID, str], StoredJob] = {}
        self.events: list[RecruitingEvent] = []
        self.event_fingerprints: set[str] = set()
        self.snapshots: list[dict[str, Any]] = []
        self.observations: list[dict[str, Any]] = []
        self.runs: dict[UUID, dict[str, Any]] = {}
        self.errors: list[dict[str, Any]] = []
        self._active_sources: set[UUID] = set()
        self._now = now or (lambda: datetime.now(UTC))
        self._lock = asyncio.Lock()

    async def get_source(self, source_id: UUID) -> SourceConfig:
        source = self.sources.get(source_id)
        if source is None:
            raise KeyError(f"source {source_id} was not found")
        if not source.enabled:
            raise ValueError(f"source {source_id} is disabled")
        return source

    async def list_sources(self) -> tuple[SourceConfig, ...]:
        return tuple(
            sorted(self.sources.values(), key=lambda item: (item.company_name, item.provider))
        )

    async def create_run(self, source: SourceConfig, collector: str) -> UUID:
        async with self._lock:
            if source.id in self._active_sources:
                raise RunAlreadyActiveError(f"source {source.id} already has an active run")
            run_id = uuid4()
            self._active_sources.add(source.id)
            self.runs[run_id] = {
                "source_id": source.id,
                "collector": collector,
                "status": "RUNNING",
                "started_at": self._now(),
            }
            return run_id

    def _append_snapshot_and_observation(
        self,
        *,
        run_id: UUID,
        source: SourceConfig,
        stored: StoredJob,
        observed_at: datetime,
    ) -> None:
        if not any(
            item["job_id"] == stored.id and item["content_hash"] == stored.value.content_hash
            for item in self.snapshots
        ):
            self.snapshots.append(
                {
                    "job_id": stored.id,
                    "run_id": run_id,
                    "content_hash": stored.value.content_hash,
                    "normalized_payload": job_fingerprint_document(stored.value.job),
                    "raw_payload": stored.value.job.raw_payload,
                    "observed_at": observed_at,
                }
            )
        self.observations.append(
            {
                "job_id": stored.id,
                "run_id": run_id,
                "source_id": source.id,
                "content_hash": stored.value.content_hash,
                "observed_at": observed_at,
            }
        )

    def _append_event(
        self,
        *,
        source: SourceConfig,
        stored: StoredJob,
        event_type: RecruitingEventType,
        occurred_at: datetime,
        discovered_at: datetime,
        sequence: str,
        payload: dict[str, Any],
    ) -> None:
        fingerprint = fingerprint_event(
            event_type=event_type,
            company_id=source.company_id,
            source_id=source.id,
            job_id=stored.id,
            causal_hash=stored.value.content_hash,
            sequence=sequence,
        )
        if fingerprint in self.event_fingerprints:
            return
        self.event_fingerprints.add(fingerprint)
        self.events.append(
            RecruitingEvent(
                id=uuid4(),
                company_id=source.company_id,
                source_id=source.id,
                job_id=stored.id,
                event_type=event_type,
                occurred_at=occurred_at,
                discovered_at=discovered_at,
                source_url=stored.value.job.source_url,
                confidence=source.reliability,
                fingerprint=fingerprint,
                payload=payload,
            )
        )

    async def persist_complete_batch(
        self,
        *,
        run_id: UUID,
        source: SourceConfig,
        result: CollectorResult,
    ) -> SyncStats:
        if not result.complete:
            raise ValueError("an incomplete result cannot be persisted")
        ensure_unique_external_ids([item.job.external_id for item in result.jobs])
        now = self._now()
        counts = {"new": 0, "changed": 0, "unchanged": 0, "closed": 0}

        async with self._lock:
            run = self.runs.get(run_id)
            if not run or run["status"] != "RUNNING" or run["source_id"] != source.id:
                raise ValueError("run is not active for this source")

            for incoming in result.jobs:
                key = (source.id, incoming.job.external_id)
                existing = self.jobs.get(key)
                transition = decide_job_transition(
                    existing_hash=existing.value.content_hash if existing else None,
                    existing_closed_at=existing.closed_at if existing else None,
                    incoming_hash=incoming.content_hash,
                )

                if existing is None:
                    stored = StoredJob(
                        id=uuid4(),
                        company_id=source.company_id,
                        source_id=source.id,
                        value=incoming,
                        first_seen_at=now,
                        last_seen_at=now,
                        changed_at=now,
                        closed_at=None,
                        last_seen_run_id=run_id,
                    )
                    self.jobs[key] = stored
                    counts["new"] += 1
                    self._append_snapshot_and_observation(
                        run_id=run_id, source=source, stored=stored, observed_at=now
                    )
                    self._append_event(
                        source=source,
                        stored=stored,
                        event_type=RecruitingEventType.JOB_OPENED,
                        occurred_at=incoming.job.published_at or now,
                        discovered_at=now,
                        sequence="initial",
                        payload={"content_hash": incoming.content_hash, "reopened": False},
                    )
                    continue

                previous_hash = existing.value.content_hash
                previous_closed_at = existing.closed_at
                existing.value = incoming
                existing.last_seen_at = now
                existing.last_seen_run_id = run_id
                existing.closed_at = None

                if transition is JobTransition.UNCHANGED:
                    counts["unchanged"] += 1
                    continue

                existing.changed_at = now
                self._append_snapshot_and_observation(
                    run_id=run_id, source=source, stored=existing, observed_at=now
                )
                if transition is JobTransition.REOPENED:
                    counts["new"] += 1
                    assert previous_closed_at is not None
                    sequence = f"reopen:{previous_closed_at.isoformat()}"
                    self._append_event(
                        source=source,
                        stored=existing,
                        event_type=RecruitingEventType.JOB_OPENED,
                        occurred_at=now,
                        discovered_at=now,
                        sequence=sequence,
                        payload={
                            "content_hash": incoming.content_hash,
                            "previous_content_hash": previous_hash,
                            "reopened": True,
                        },
                    )
                else:
                    counts["changed"] += 1
                    self._append_event(
                        source=source,
                        stored=existing,
                        event_type=RecruitingEventType.JOB_CHANGED,
                        occurred_at=now,
                        discovered_at=now,
                        sequence=incoming.content_hash,
                        payload={
                            "content_hash": incoming.content_hash,
                            "previous_content_hash": previous_hash,
                        },
                    )

            for (job_source_id, _), stored in self.jobs.items():
                if (
                    job_source_id == source.id
                    and stored.closed_at is None
                    and stored.last_seen_run_id != run_id
                ):
                    stored.closed_at = now
                    stored.changed_at = now
                    counts["closed"] += 1
                    self._append_event(
                        source=source,
                        stored=stored,
                        event_type=RecruitingEventType.JOB_CLOSED,
                        occurred_at=now,
                        discovered_at=now,
                        sequence=f"absent:{run_id}",
                        payload={
                            "content_hash": stored.value.content_hash,
                            "reason": "source_absent",
                        },
                    )

            stats = SyncStats(discovered=result.discovered, **counts)
            run.update(
                status="SUCCEEDED",
                finished_at=now,
                stats=stats,
            )
            self._active_sources.discard(source.id)
            return stats

    async def record_error(
        self,
        *,
        run_id: UUID,
        stage: CollectorStage,
        error_type: str,
        message: str,
        retryable: bool,
        context: dict[str, Any],
    ) -> None:
        self.errors.append(
            {
                "run_id": run_id,
                "stage": stage.value,
                "error_type": error_type,
                "message": message,
                "retryable": retryable,
                "context": context,
                "occurred_at": self._now(),
            }
        )

    async def fail_run(self, run_id: UUID, *, discovered: int, errors: int = 1) -> None:
        async with self._lock:
            run = self.runs[run_id]
            run.update(
                status="FAILED",
                finished_at=self._now(),
                discovered=discovered,
                errors=errors,
            )
            self._active_sources.discard(run["source_id"])
