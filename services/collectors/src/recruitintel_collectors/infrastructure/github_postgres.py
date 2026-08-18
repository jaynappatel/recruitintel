from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.errors import UniqueViolation
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from recruitintel_collectors.domain.enums import RecruitingEventType
from recruitintel_collectors.github.enums import GitHubRecordType
from recruitintel_collectors.github.fingerprints import (
    github_event_fingerprint,
    github_job_content_fingerprint,
    observation_fingerprint,
)
from recruitintel_collectors.github.models import (
    GitHubParsedBatch,
    GitHubRateLimit,
    GitHubRepositoryConfig,
    GitHubRepositoryLink,
    GitHubSyncStats,
    ResolvedGitHubJob,
    ResolvedInterviewQuestion,
    UnresolvedGitHubRecord,
)
from recruitintel_collectors.github.resolution import GitHubCompanyResolver
from recruitintel_collectors.pipeline.memory import RunAlreadyActiveError


class PostgresGitHubSyncRepository:
    def __init__(self, database_url: str) -> None:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        self.database_url = database_url

    async def _connect(self) -> psycopg.AsyncConnection[dict[str, Any]]:
        return await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)

    async def get_repository(self, repository_id: UUID) -> GitHubRepositoryConfig:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select gr.*, s.reliability
                from public.github_repositories gr
                join public.sources s on s.id = gr.source_id
                where gr.id = %s and gr.enabled and s.enabled
                """,
                (repository_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                raise KeyError(f"enabled GitHub repository {repository_id} was not found")
            cursor = await connection.execute(
                """
                select l.company_id, c.canonical_name as company_name, l.watched_paths,
                       l.company_mapping_rules, l.enabled
                from public.github_repository_company_links l
                join public.companies c on c.id = l.company_id
                where l.github_repository_id = %s
                order by c.canonical_name, l.company_id
                """,
                (repository_id,),
            )
            link_rows = await cursor.fetchall()
        links = tuple(
            GitHubRepositoryLink(
                company_id=link["company_id"],
                company_name=link["company_name"],
                watched_paths=tuple(link["watched_paths"]),
                company_mapping_rules=link["company_mapping_rules"],
                enabled=link["enabled"],
            )
            for link in link_rows
        )
        if not any(link.enabled for link in links):
            raise ValueError(f"GitHub repository {repository_id} has no enabled company links")
        return GitHubRepositoryConfig(
            id=row["id"],
            source_id=row["source_id"],
            owner=row["owner"],
            repository_name=row["repository_name"],
            repository_url=row["repository_url"],
            default_branch=row["default_branch"],
            repository_type=row["repository_type"],
            parser_type=row["parser_type"],
            enabled=row["enabled"],
            last_seen_commit_sha=row["last_seen_commit_sha"],
            last_processed_commit_sha=row["last_processed_commit_sha"],
            reliability=float(row["reliability"]),
            links=links,
            metadata=row["metadata"],
        )

    async def get_company_resolver(
        self, repository: GitHubRepositoryConfig
    ) -> GitHubCompanyResolver:
        async with await self._connect() as connection:
            alias_cursor = await connection.execute(
                """
                select canonical_name as alias, id as company_id from public.companies
                union all
                select alias, company_id from public.company_aliases
                """
            )
            aliases = {
                row["alias"]: UUID(str(row["company_id"])) for row in await alias_cursor.fetchall()
            }
            domain_cursor = await connection.execute(
                "select domain, company_id from public.company_domains"
            )
            domains = {
                row["domain"]: UUID(str(row["company_id"]))
                for row in await domain_cursor.fetchall()
            }
        return GitHubCompanyResolver(aliases=aliases, domains=domains, links=repository.links)

    async def create_sync_run(
        self, repository: GitHubRepositoryConfig, *, request_id: UUID | None = None
    ) -> UUID:
        try:
            async with await self._connect() as connection:
                async with connection.transaction():
                    if request_id:
                        cursor = await connection.execute(
                            """
                            update public.github_sync_requests
                            set status = 'RUNNING', started_at = now()
                            where id = %s and github_repository_id = %s and status = 'PENDING'
                            returning id
                            """,
                            (request_id, repository.id),
                        )
                        if await cursor.fetchone() is None:
                            raise ValueError("sync request is not pending for this repository")
                    cursor = await connection.execute(
                        """
                        insert into public.collector_runs (source_id, collector, metadata)
                        values (%s, 'github', %s)
                        returning id
                        """,
                        (repository.source_id, Jsonb({"repository_id": str(repository.id)})),
                    )
                    row = await cursor.fetchone()
                    if row is None:
                        raise RuntimeError("GitHub collector run insert returned no ID")
                    run_id = UUID(str(row["id"]))
                    await connection.execute(
                        """
                        insert into public.github_sync_runs (
                          collector_run_id, github_repository_id, sync_request_id,
                          previous_commit_sha
                        ) values (%s, %s, %s, %s)
                        """,
                        (run_id, repository.id, request_id, repository.last_processed_commit_sha),
                    )
                    return run_id
        except UniqueViolation as exc:
            raise RunAlreadyActiveError(
                f"GitHub source {repository.source_id} already has an active run"
            ) from exc

    @staticmethod
    def _rate_parameters(rate_limit: GitHubRateLimit) -> tuple[int | None, datetime | None]:
        return rate_limit.remaining, rate_limit.reset_at

    async def complete_unchanged(
        self,
        *,
        run_id: UUID,
        repository: GitHubRepositoryConfig,
        current_sha: str,
        rate_limit: GitHubRateLimit,
        duration_ms: int,
        request_id: UUID | None = None,
    ) -> GitHubSyncStats:
        now = datetime.now(UTC)
        remaining, reset_at = self._rate_parameters(rate_limit)
        async with await self._connect() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    update public.github_repositories set
                      default_branch = %s, last_seen_commit_sha = %s, last_checked_at = %s,
                      rate_limit_remaining = %s, rate_limit_reset_at = %s
                    where id = %s
                    """,
                    (
                        repository.default_branch,
                        current_sha,
                        now,
                        remaining,
                        reset_at,
                        repository.id,
                    ),
                )
                await connection.execute(
                    """
                    update public.github_sync_runs set
                      current_commit_sha = %s, skipped_unchanged_sha = true,
                      duration_ms = %s, rate_limit_remaining = %s,
                      rate_limit_reset_at = %s
                    where collector_run_id = %s
                    """,
                    (current_sha, duration_ms, remaining, reset_at, run_id),
                )
                await connection.execute(
                    """
                    update public.collector_runs set
                      status = 'SUCCEEDED', finished_at = %s
                    where id = %s and status = 'RUNNING'
                    """,
                    (now, run_id),
                )
                if request_id:
                    await connection.execute(
                        """
                        update public.github_sync_requests
                        set status = 'SUCCEEDED', finished_at = %s
                        where id = %s and status = 'RUNNING'
                        """,
                        (now, request_id),
                    )
        return GitHubSyncStats(
            repository_id=repository.id,
            previous_sha=repository.last_processed_commit_sha,
            current_sha=current_sha,
            files_inspected=0,
            records_parsed=0,
            new=0,
            updated=0,
            unchanged=0,
            unresolved=0,
            errors=0,
            skipped_unchanged_sha=True,
            duration_ms=duration_ms,
        )

    @staticmethod
    async def _insert_event(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        repository: GitHubRepositoryConfig,
        company_id: UUID,
        event_type: RecruitingEventType,
        source_url: str,
        occurred_at: datetime,
        subject_key: str,
        current_sha: str,
        payload: dict[str, Any],
        job_id: UUID | None = None,
        interview_question_id: UUID | None = None,
    ) -> bool:
        fingerprint = github_event_fingerprint(
            event_type=event_type,
            company_id=company_id,
            source_id=repository.source_id,
            repository_id=repository.id,
            subject_key=subject_key,
            causal_sha=current_sha,
        )
        await cursor.execute(
            """
            insert into public.recruiting_events (
              company_id, source_id, job_id, github_repository_id,
              interview_question_id, event_type, occurred_at, discovered_at,
              source_url, confidence, fingerprint, payload
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (fingerprint) do nothing
            returning id
            """,
            (
                company_id,
                repository.source_id,
                job_id,
                repository.id,
                interview_question_id,
                event_type.value,
                occurred_at,
                occurred_at,
                source_url,
                repository.reliability,
                fingerprint,
                Jsonb(payload),
            ),
        )
        return await cursor.fetchone() is not None

    @staticmethod
    async def _resolve_question(
        cursor: psycopg.AsyncCursor[dict[str, Any]], question: ResolvedInterviewQuestion
    ) -> tuple[dict[str, Any] | None, bool, str | None]:
        value = question.question
        await cursor.execute(
            "select pg_advisory_xact_lock(hashtextextended('interview-question-resolution', 0))"
        )
        await cursor.execute(
            """
            select * from public.interview_questions
            where normalized_title = %s
               or (%s::text is not null and leetcode_slug = %s)
               or (%s::integer is not null and leetcode_number = %s)
            for update
            """,
            (
                value.normalized_title,
                value.leetcode_slug,
                value.leetcode_slug,
                value.leetcode_number,
                value.leetcode_number,
            ),
        )
        matches = await cursor.fetchall()
        distinct = {row["id"]: row for row in matches}
        if len(distinct) > 1:
            return None, False, "question_identity_matches_multiple_canonical_records"
        if distinct:
            existing = next(iter(distinct.values()))
            if (
                value.leetcode_slug
                and existing["leetcode_slug"]
                and value.leetcode_slug != existing["leetcode_slug"]
            ) or (
                value.leetcode_number
                and existing["leetcode_number"]
                and value.leetcode_number != existing["leetcode_number"]
            ):
                return None, False, "question_identity_conflicts_with_canonical_record"
            merged_topics = sorted(set(existing["topics"]) | set(value.topics))
            changed = (
                (existing["leetcode_slug"] is None and value.leetcode_slug is not None)
                or (existing["leetcode_number"] is None and value.leetcode_number is not None)
                or (existing["difficulty"] is None and value.difficulty is not None)
                or merged_topics != list(existing["topics"])
            )
            await cursor.execute(
                """
                update public.interview_questions set
                  leetcode_slug = coalesce(leetcode_slug, %s),
                  leetcode_number = coalesce(leetcode_number, %s),
                  difficulty = coalesce(difficulty, %s), topics = %s
                where id = %s
                returning *
                """,
                (
                    value.leetcode_slug,
                    value.leetcode_number,
                    value.difficulty.value if value.difficulty else None,
                    merged_topics,
                    existing["id"],
                ),
            )
            row = await cursor.fetchone()
            return row, changed, None

        await cursor.execute(
            """
            insert into public.interview_questions (
              canonical_title, normalized_title, leetcode_slug, leetcode_number,
              difficulty, topics
            ) values (%s, %s, %s, %s, %s, %s)
            returning *
            """,
            (
                value.canonical_title,
                value.normalized_title,
                value.leetcode_slug,
                value.leetcode_number,
                value.difficulty.value if value.difficulty else None,
                list(value.topics),
            ),
        )
        row = await cursor.fetchone()
        return row, False, None

    @staticmethod
    async def _insert_unresolved(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        repository: GitHubRepositoryConfig,
        unresolved: UnresolvedGitHubRecord,
    ) -> bool:
        item_key = f"{unresolved.raw_title or ''}\x1f{unresolved.reason}"
        fingerprint = observation_fingerprint(
            repository_id=repository.id,
            source_path=unresolved.source_path,
            commit_sha=unresolved.commit_sha,
            record_type=unresolved.record_type.value,
            company_key=unresolved.raw_company_name or "",
            item_key=item_key,
            row_number=None,
        )
        await cursor.execute(
            """
            insert into public.unresolved_github_observations (
              source_id, github_repository_id, source_url, source_path, commit_sha,
              record_type, raw_company_name, raw_title, reason, metadata, fingerprint
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (fingerprint) do nothing
            returning id
            """,
            (
                repository.source_id,
                repository.id,
                unresolved.source_url,
                unresolved.source_path,
                unresolved.commit_sha,
                unresolved.record_type.value,
                unresolved.raw_company_name,
                unresolved.raw_title,
                unresolved.reason,
                Jsonb(unresolved.metadata),
                fingerprint,
            ),
        )
        return await cursor.fetchone() is not None

    async def _persist_question(
        self,
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        repository: GitHubRepositoryConfig,
        question: ResolvedInterviewQuestion,
        observed_at: datetime,
    ) -> tuple[str, int]:
        canonical, canonical_changed, reason = await self._resolve_question(cursor, question)
        if canonical is None:
            unresolved = UnresolvedGitHubRecord(
                record_type=GitHubRecordType.INTERVIEW_QUESTION,
                source_path=question.source_path,
                source_url=question.source_url,
                commit_sha=question.commit_sha,
                reason=reason or "question_identity_unresolved",
                raw_title=question.raw_title,
                metadata={**question.metadata, "company_id": str(question.company_id)},
            )
            inserted = await self._insert_unresolved(
                cursor, repository=repository, unresolved=unresolved
            )
            return ("new" if inserted else "unchanged"), 1

        await cursor.execute(
            """
            insert into public.company_interview_questions (
              company_id, interview_question_id, first_seen_at, last_seen_at,
              observation_count, confidence, role_family, interview_stage
            ) values (%s, %s, %s, %s, 1, %s, %s, %s)
            on conflict (company_id, interview_question_id) do nothing
            returning id
            """,
            (
                question.company_id,
                canonical["id"],
                observed_at,
                observed_at,
                repository.reliability,
                question.role_family.value if question.role_family else None,
                question.interview_stage,
            ),
        )
        association_row = await cursor.fetchone()
        association_is_new = association_row is not None
        if association_row is None:
            await cursor.execute(
                """
                select id from public.company_interview_questions
                where company_id = %s and interview_question_id = %s
                for update
                """,
                (question.company_id, canonical["id"]),
            )
            association_row = await cursor.fetchone()
        if association_row is None:
            raise RuntimeError("question association resolution returned no row")

        item_key = str(canonical["normalized_title"])
        fingerprint = observation_fingerprint(
            repository_id=repository.id,
            source_path=question.source_path,
            commit_sha=question.commit_sha,
            record_type=GitHubRecordType.INTERVIEW_QUESTION.value,
            company_key=str(question.company_id),
            item_key=item_key,
            row_number=None,
        )
        await cursor.execute(
            """
            insert into public.interview_question_observations (
              company_interview_question_id, source_id, github_repository_id,
              source_url, source_path, commit_sha, observed_at, raw_title,
              metadata, fingerprint
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (fingerprint) do nothing
            returning id
            """,
            (
                association_row["id"],
                repository.source_id,
                repository.id,
                question.source_url,
                question.source_path,
                question.commit_sha,
                observed_at,
                question.raw_title,
                Jsonb(question.metadata),
                fingerprint,
            ),
        )
        observation_is_new = await cursor.fetchone() is not None
        if not observation_is_new:
            return "unchanged", 0
        if not association_is_new:
            await cursor.execute(
                """
                update public.company_interview_questions set
                  last_seen_at = greatest(last_seen_at, %s),
                  observation_count = observation_count + 1,
                  confidence = greatest(confidence, %s),
                  role_family = coalesce(role_family, %s),
                  interview_stage = coalesce(interview_stage, %s)
                where id = %s
                """,
                (
                    observed_at,
                    repository.reliability,
                    question.role_family.value if question.role_family else None,
                    question.interview_stage,
                    association_row["id"],
                ),
            )

        if association_is_new:
            await self._insert_event(
                cursor,
                repository=repository,
                company_id=question.company_id,
                event_type=RecruitingEventType.INTERVIEW_QUESTION_ADDED,
                source_url=question.source_url,
                occurred_at=observed_at,
                subject_key=f"question:{canonical['id']}",
                current_sha=question.commit_sha,
                interview_question_id=canonical["id"],
                payload={
                    "canonical_title": canonical["canonical_title"],
                    "source_path": question.source_path,
                    "commit_sha": question.commit_sha,
                },
            )
            return "new", 0
        if canonical_changed:
            await self._insert_event(
                cursor,
                repository=repository,
                company_id=question.company_id,
                event_type=RecruitingEventType.INTERVIEW_QUESTION_UPDATED,
                source_url=question.source_url,
                occurred_at=observed_at,
                subject_key=f"question:{canonical['id']}",
                current_sha=question.commit_sha,
                interview_question_id=canonical["id"],
                payload={
                    "canonical_title": canonical["canonical_title"],
                    "source_path": question.source_path,
                    "commit_sha": question.commit_sha,
                },
            )
        return "updated", 0

    async def _persist_job(
        self,
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        run_id: UUID,
        repository: GitHubRepositoryConfig,
        resolved: ResolvedGitHubJob,
        observed_at: datetime,
    ) -> str:
        job = resolved.job
        content_hash = github_job_content_fingerprint(job)
        await cursor.execute(
            """
            select id, content_hash from public.jobs
            where source_id = %s and external_id = %s
            for update
            """,
            (repository.source_id, job.external_id),
        )
        existing = await cursor.fetchone()
        if existing is None:
            await cursor.execute(
                """
                insert into public.jobs (
                  company_id, source_id, external_id, title, description, location,
                  employment_type, role_family, experience_level, is_internship,
                  is_new_grad, season, graduation_years, application_url, source_url,
                  first_seen_at, last_seen_at, changed_at, published_at, content_hash,
                  fingerprint_version, classification_version, last_seen_run_id, raw_payload
                ) values (
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                ) returning id
                """,
                (
                    resolved.company_id,
                    repository.source_id,
                    job.external_id,
                    job.title,
                    job.description,
                    job.location,
                    job.employment_type.value,
                    job.role_family.value,
                    job.experience_level.value,
                    job.is_internship,
                    job.is_new_grad,
                    job.season,
                    list(job.graduation_years),
                    job.application_url,
                    job.source_url,
                    observed_at,
                    observed_at,
                    observed_at,
                    job.published_at,
                    content_hash,
                    job.fingerprint_version,
                    job.classification_version,
                    run_id,
                    Jsonb(job.raw_payload),
                ),
            )
            inserted = await cursor.fetchone()
            if inserted is None:
                raise RuntimeError("GitHub job insert returned no ID")
            job_id = inserted["id"]
            transition = "new"
        else:
            job_id = existing["id"]
            transition = "unchanged" if existing["content_hash"] == content_hash else "updated"
            await cursor.execute(
                """
                update public.jobs set
                  company_id = %s, title = %s, description = %s, location = %s,
                  employment_type = %s, role_family = %s, experience_level = %s,
                  is_internship = %s, is_new_grad = %s, season = %s,
                  graduation_years = %s, application_url = %s, source_url = %s,
                  last_seen_at = %s,
                  changed_at = case when content_hash <> %s then %s else changed_at end,
                  closed_at = null, content_hash = %s, fingerprint_version = %s,
                  classification_version = %s, last_seen_run_id = %s, raw_payload = %s
                where id = %s
                """,
                (
                    resolved.company_id,
                    job.title,
                    job.description,
                    job.location,
                    job.employment_type.value,
                    job.role_family.value,
                    job.experience_level.value,
                    job.is_internship,
                    job.is_new_grad,
                    job.season,
                    list(job.graduation_years),
                    job.application_url,
                    job.source_url,
                    observed_at,
                    content_hash,
                    observed_at,
                    content_hash,
                    job.fingerprint_version,
                    job.classification_version,
                    run_id,
                    Jsonb(job.raw_payload),
                    job_id,
                ),
            )

        normalized = job.model_dump(mode="json", exclude={"raw_payload"})
        await cursor.execute(
            """
            insert into public.job_snapshots (
              job_id, collector_run_id, content_hash, fingerprint_version,
              normalized_payload, raw_payload, observed_at
            ) values (%s, %s, %s, %s, %s, %s, %s)
            on conflict (job_id, content_hash) do nothing
            """,
            (
                job_id,
                run_id,
                content_hash,
                job.fingerprint_version,
                Jsonb(normalized),
                Jsonb(job.raw_payload),
                observed_at,
            ),
        )
        await cursor.execute(
            """
            insert into public.observations (
              source_id, collector_run_id, entity_type, job_id, source_url,
              collected_at, published_at, raw_text, normalized_text,
              content_hash, confidence, metadata
            ) values (%s, %s, 'JOB', %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                repository.source_id,
                run_id,
                job_id,
                resolved.source_url,
                observed_at,
                job.published_at,
                job.description,
                "\n".join((job.title, job.description, job.location)),
                content_hash,
                repository.reliability,
                Jsonb(
                    {
                        "provider": "github",
                        "github_repository_id": str(repository.id),
                        "repository_url": repository.repository_url,
                        "source_path": resolved.source_path,
                        "commit_sha": resolved.commit_sha,
                        "source_url": resolved.source_url,
                    }
                ),
            ),
        )
        if transition in {"new", "updated"}:
            event_type = (
                RecruitingEventType.JOB_OPENED
                if transition == "new"
                else RecruitingEventType.JOB_CHANGED
            )
            await self._insert_event(
                cursor,
                repository=repository,
                company_id=resolved.company_id,
                event_type=event_type,
                source_url=resolved.source_url,
                occurred_at=observed_at,
                subject_key=f"job:{job_id}",
                current_sha=resolved.commit_sha,
                job_id=job_id,
                payload={
                    "content_hash": content_hash,
                    "source_path": resolved.source_path,
                    "commit_sha": resolved.commit_sha,
                },
            )
        return transition

    async def persist_sync(
        self,
        *,
        run_id: UUID,
        repository: GitHubRepositoryConfig,
        current_sha: str,
        files_inspected: tuple[str, ...],
        batch: GitHubParsedBatch,
        rate_limit: GitHubRateLimit,
        duration_ms: int,
        request_id: UUID | None = None,
    ) -> GitHubSyncStats:
        now = datetime.now(UTC)
        counts = {"new": 0, "updated": 0, "unchanged": 0}
        unresolved_count = 0
        remaining, reset_at = self._rate_parameters(rate_limit)
        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = connection.cursor()
                await cursor.execute(
                    "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"github:{repository.id}",),
                )
                await cursor.execute(
                    """
                    select id from public.collector_runs
                    where id = %s and source_id = %s and status = 'RUNNING'
                    for update
                    """,
                    (run_id, repository.source_id),
                )
                if await cursor.fetchone() is None:
                    raise ValueError("GitHub collector run is not active")

                for unresolved in batch.unresolved:
                    inserted = await self._insert_unresolved(
                        cursor, repository=repository, unresolved=unresolved
                    )
                    counts["new" if inserted else "unchanged"] += 1
                    unresolved_count += 1
                for question in batch.questions:
                    transition, new_unresolved = await self._persist_question(
                        cursor,
                        repository=repository,
                        question=question,
                        observed_at=now,
                    )
                    counts[transition] += 1
                    unresolved_count += new_unresolved
                for job in batch.jobs:
                    transition = await self._persist_job(
                        cursor,
                        run_id=run_id,
                        repository=repository,
                        resolved=job,
                        observed_at=now,
                    )
                    counts[transition] += 1

                for link in repository.links:
                    if link.enabled and files_inspected:
                        await self._insert_event(
                            cursor,
                            repository=repository,
                            company_id=link.company_id,
                            event_type=RecruitingEventType.GITHUB_REPOSITORY_UPDATED,
                            source_url=repository.repository_url,
                            occurred_at=now,
                            subject_key=f"repository:{repository.id}",
                            current_sha=current_sha,
                            payload={
                                "previous_commit_sha": repository.last_processed_commit_sha,
                                "current_commit_sha": current_sha,
                                "files_inspected": list(files_inspected),
                            },
                        )

                await cursor.execute(
                    """
                    update public.github_repositories set
                      default_branch = %s,
                      last_seen_commit_sha = %s, last_processed_commit_sha = %s,
                      last_checked_at = %s, rate_limit_remaining = %s,
                      rate_limit_reset_at = %s
                    where id = %s
                    """,
                    (
                        repository.default_branch,
                        current_sha,
                        current_sha,
                        now,
                        remaining,
                        reset_at,
                        repository.id,
                    ),
                )
                await cursor.execute(
                    """
                    update public.github_sync_runs set
                      current_commit_sha = %s, files_inspected = %s,
                      records_parsed = %s, records_new = %s, records_updated = %s,
                      records_unchanged = %s, unresolved_records = %s,
                      duration_ms = %s, rate_limit_remaining = %s,
                      rate_limit_reset_at = %s, metadata = %s
                    where collector_run_id = %s
                    """,
                    (
                        current_sha,
                        len(files_inspected),
                        batch.count,
                        counts["new"],
                        counts["updated"],
                        counts["unchanged"],
                        unresolved_count,
                        duration_ms,
                        remaining,
                        reset_at,
                        Jsonb({"files_inspected": list(files_inspected)}),
                        run_id,
                    ),
                )
                await cursor.execute(
                    """
                    update public.collector_runs set
                      status = 'SUCCEEDED', finished_at = %s, items_discovered = %s,
                      items_new = %s, items_changed = %s, items_unchanged = %s,
                      metadata = metadata || %s
                    where id = %s
                    """,
                    (
                        now,
                        batch.count,
                        counts["new"],
                        counts["updated"],
                        counts["unchanged"],
                        Jsonb(
                            {
                                "previous_sha": repository.last_processed_commit_sha,
                                "current_sha": current_sha,
                                "unresolved": unresolved_count,
                            }
                        ),
                        run_id,
                    ),
                )
                if request_id:
                    await cursor.execute(
                        """
                        update public.github_sync_requests
                        set status = 'SUCCEEDED', finished_at = %s
                        where id = %s and status = 'RUNNING'
                        """,
                        (now, request_id),
                    )

        return GitHubSyncStats(
            repository_id=repository.id,
            previous_sha=repository.last_processed_commit_sha,
            current_sha=current_sha,
            files_inspected=len(files_inspected),
            records_parsed=batch.count,
            new=counts["new"],
            updated=counts["updated"],
            unchanged=counts["unchanged"],
            unresolved=unresolved_count,
            errors=0,
            duration_ms=duration_ms,
        )

    async def fail_sync(
        self,
        *,
        run_id: UUID,
        repository: GitHubRepositoryConfig,
        error: Exception,
        retryable: bool,
        rate_limit: GitHubRateLimit,
        duration_ms: int,
        request_id: UUID | None = None,
    ) -> None:
        now = datetime.now(UTC)
        remaining, reset_at = self._rate_parameters(rate_limit)
        async with await self._connect() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    insert into public.collector_errors (
                      collector_run_id, stage, error_type, message, retryable, context
                    ) values (%s, 'FETCH', %s, %s, %s, %s)
                    """,
                    (
                        run_id,
                        type(error).__name__,
                        str(error)[:10_000],
                        retryable,
                        Jsonb({"repository_id": str(repository.id)}),
                    ),
                )
                await connection.execute(
                    """
                    update public.collector_runs set
                      status = 'FAILED', finished_at = %s, errors = 1
                    where id = %s and status = 'RUNNING'
                    """,
                    (now, run_id),
                )
                await connection.execute(
                    """
                    update public.github_sync_runs set
                      duration_ms = %s, rate_limit_remaining = %s,
                      rate_limit_reset_at = %s
                    where collector_run_id = %s
                    """,
                    (duration_ms, remaining, reset_at, run_id),
                )
                await connection.execute(
                    """
                    update public.github_repositories set
                      last_checked_at = %s, rate_limit_remaining = %s,
                      rate_limit_reset_at = %s
                    where id = %s
                    """,
                    (now, remaining, reset_at, repository.id),
                )
                if request_id:
                    await connection.execute(
                        """
                        update public.github_sync_requests set
                          status = 'FAILED', finished_at = %s, error_message = %s
                        where id = %s and status = 'RUNNING'
                        """,
                        (now, str(error)[:10_000], request_id),
                    )
