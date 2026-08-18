from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import psycopg
from psycopg.errors import UniqueViolation
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from recruitintel_collectors.domain.enums import RecruitingEventType
from recruitintel_collectors.pipeline.memory import RunAlreadyActiveError
from recruitintel_collectors.public_web.enums import (
    PublicObservationType,
    RelevanceStatus,
    WebSourceClassification,
    WebWorkStatus,
    WebWorkType,
)
from recruitintel_collectors.public_web.fetcher import RobotsDeniedError
from recruitintel_collectors.public_web.fingerprints import (
    candidate_source_key,
    claim_fingerprint,
    observation_fingerprint,
    web_event_fingerprint,
)
from recruitintel_collectors.public_web.models import (
    CandidateConfig,
    CompanyWebConfig,
    ExtractedDocument,
    FetchedDocument,
    NormalizedWebObservation,
    PublicWebWorkRequest,
    RelevanceDecision,
    SearchQueryConfig,
    SearchResult,
    SourceAssessment,
    StoredDocument,
    WebRunStats,
)
from recruitintel_collectors.public_web.urls import UnsafeUrlError, canonicalize_url

_SOURCE_TYPE: dict[WebSourceClassification, str] = {
    WebSourceClassification.COMPANY_CAREERS: "COMPANY_CAREERS",
    WebSourceClassification.COMPANY_BLOG: "COMPANY_BLOG",
    WebSourceClassification.COMPANY_PUBLIC_PAGE: "PUBLIC_WEB",
    WebSourceClassification.UNIVERSITY: "UNIVERSITY",
    WebSourceClassification.FORUM: "FORUM",
    WebSourceClassification.GITHUB: "GITHUB",
    WebSourceClassification.PUBLIC_WEB: "PUBLIC_WEB",
    WebSourceClassification.RECRUITER_PUBLIC_PAGE: "RECRUITER_PUBLIC_PAGE",
    WebSourceClassification.OTHER: "OTHER",
}

_EVENT_TYPE: dict[PublicObservationType, RecruitingEventType] = {
    PublicObservationType.INTERNSHIP_OPENING_SIGNAL: RecruitingEventType.HIRING_SIGNAL,
    PublicObservationType.NEW_GRAD_OPENING_SIGNAL: RecruitingEventType.HIRING_SIGNAL,
    PublicObservationType.APPLICATION_DATE: RecruitingEventType.APPLICATION_DATE_SIGNAL,
    PublicObservationType.APPLICATION_DEADLINE: RecruitingEventType.APPLICATION_DATE_SIGNAL,
    PublicObservationType.CAREER_FAIR: RecruitingEventType.CAMPUS_EVENT_DISCOVERED,
    PublicObservationType.CAMPUS_VISIT: RecruitingEventType.CAMPUS_EVENT_DISCOVERED,
    PublicObservationType.SCHOOL_RECRUITING_SIGNAL: RecruitingEventType.CAMPUS_EVENT_DISCOVERED,
    PublicObservationType.INTERVIEW_EXPERIENCE: RecruitingEventType.INTERVIEW_REPORT_DISCOVERED,
    PublicObservationType.EARLY_CAREER_PROGRAM: RecruitingEventType.RECRUITING_ARTICLE_DISCOVERED,
    PublicObservationType.RECRUITING_ANNOUNCEMENT: RecruitingEventType.HIRING_SIGNAL,
    PublicObservationType.ROLE_FAMILY_SIGNAL: RecruitingEventType.HIRING_SIGNAL,
    PublicObservationType.GENERAL_RECRUITING_SIGNAL: (
        RecruitingEventType.RECRUITING_ARTICLE_DISCOVERED
    ),
}


class PostgresPublicWebRepository:
    def __init__(self, database_url: str) -> None:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        self.database_url = database_url

    async def _connect(self) -> psycopg.AsyncConnection[dict[str, Any]]:
        return await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)

    @staticmethod
    def _company(row: dict[str, Any]) -> CompanyWebConfig:
        return CompanyWebConfig(
            id=row["company_id"],
            canonical_name=row["canonical_name"],
            slug=row["slug"],
            website=row["website"],
            careers_url=row["careers_url"],
            domains=tuple(row["domains"] or ()),
        )

    async def claim_work_request(self, request_id: UUID) -> PublicWebWorkRequest:
        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = await connection.execute(
                    "select * from public.public_web_work_requests where id = %s for update",
                    (request_id,),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise KeyError(f"public web work request {request_id} was not found")
                if row["status"] != WebWorkStatus.PENDING.value:
                    raise ValueError(f"public web work request is {row['status']}, not PENDING")
                if row["next_attempt_at"] > datetime.now(UTC):
                    raise ValueError("public web work request is waiting for its retry window")
                cursor = await connection.execute(
                    """
                    update public.public_web_work_requests set
                      status = 'RUNNING', started_at = now(), attempt_count = attempt_count + 1,
                      error_message = null
                    where id = %s and status = 'PENDING'
                    returning *
                    """,
                    (request_id,),
                )
                claimed = await cursor.fetchone()
                if claimed is None:
                    raise RunAlreadyActiveError(
                        f"work request {request_id} was claimed concurrently"
                    )
        return PublicWebWorkRequest(
            id=claimed["id"],
            work_type=claimed["work_type"],
            status=claimed["status"],
            company_id=claimed["company_id"],
            search_query_id=claimed["search_query_id"],
            candidate_id=claimed["candidate_id"],
            attempt_count=claimed["attempt_count"],
            max_attempts=claimed["max_attempts"],
            metadata=claimed["metadata"],
        )

    async def get_search_query(self, query_id: UUID) -> SearchQueryConfig:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select q.*, c.canonical_name, c.slug, c.website, c.careers_url,
                       coalesce(
                         array_agg(cd.domain) filter (where cd.domain is not null), '{}'
                       ) domains
                from public.public_web_search_queries q
                join public.companies c on c.id = q.company_id
                left join public.company_domains cd on cd.company_id = c.id
                where q.id = %s
                group by q.id, c.id
                """,
                (query_id,),
            )
            row = await cursor.fetchone()
        if row is None:
            raise KeyError(f"public web search query {query_id} was not found")
        return SearchQueryConfig(
            id=row["id"],
            company=self._company(row),
            source_id=row["source_id"],
            provider=row["provider"],
            query=row["query"],
            minimum_interval_seconds=row["minimum_interval_seconds"],
            max_results=row["max_results"],
            max_fetches=row["max_fetches"],
            next_allowed_run_at=row["next_allowed_run_at"],
        )

    async def get_candidate(self, candidate_id: UUID) -> CandidateConfig:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select w.*, c.canonical_name, c.slug, c.website, c.careers_url,
                       coalesce(
                         array_agg(cd.domain) filter (where cd.domain is not null), '{}'
                       ) domains
                from public.public_web_candidates w
                join public.companies c on c.id = w.company_id
                left join public.company_domains cd on cd.company_id = c.id
                where w.id = %s
                group by w.id, c.id
                """,
                (candidate_id,),
            )
            row = await cursor.fetchone()
        if row is None:
            raise KeyError(f"public web candidate {candidate_id} was not found")
        return CandidateConfig(
            id=row["id"],
            company=self._company(row),
            source_id=row["source_id"],
            canonical_url=row["canonical_url"],
            original_url=row["original_url"],
            source_provider=row["source_provider"],
            content_hash=row["content_hash"],
            fetch_status=row["fetch_status"],
            last_fetched_at=row["last_fetched_at"],
        )

    async def start_run(self, request: PublicWebWorkRequest, source_id: UUID) -> UUID:
        try:
            async with await self._connect() as connection:
                async with connection.transaction():
                    cursor = await connection.execute(
                        """
                        insert into public.collector_runs (source_id, collector, metadata)
                        values (%s, 'public_web', %s)
                        returning id
                        """,
                        (
                            source_id,
                            Jsonb(
                                {
                                    "work_request_id": str(request.id),
                                    "work_type": request.work_type.value,
                                }
                            ),
                        ),
                    )
                    row = await cursor.fetchone()
                    if row is None:
                        raise RuntimeError("public web collector run insert returned no ID")
                    run_id = UUID(str(row["id"]))
                    await connection.execute(
                        """
                        insert into public.public_web_runs (
                          collector_run_id, work_request_id, company_id
                        ) values (%s, %s, %s)
                        """,
                        (run_id, request.id, request.company_id),
                    )
                    return run_id
        except UniqueViolation as exc:
            raise RunAlreadyActiveError(f"source {source_id} already has an active run") from exc

    async def persist_search_results(
        self,
        *,
        run_id: UUID,
        request: PublicWebWorkRequest,
        query: SearchQueryConfig,
        results: Sequence[SearchResult],
    ) -> tuple[int, tuple[UUID, ...]]:
        now = datetime.now(UTC)
        candidates: list[tuple[UUID, str]] = []
        seen: set[str] = set()
        async with await self._connect() as connection:
            async with connection.transaction():
                await connection.execute(
                    "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"web-query:{query.id}",),
                )
                for result in results[: query.max_results]:
                    try:
                        canonical = canonicalize_url(result.url)
                    except UnsafeUrlError:
                        continue
                    if canonical in seen:
                        continue
                    seen.add(canonical)
                    external_key = candidate_source_key(query.company.id, canonical)
                    hostname = urlsplit(canonical).hostname or canonical
                    cursor = await connection.execute(
                        """
                        insert into public.sources (
                          company_id, source_type, provider, external_key, name,
                          base_url, reliability, metadata
                        ) values (%s, 'PUBLIC_WEB', 'public_web', %s, %s, %s, 0.500, %s)
                        on conflict (provider, external_key) do update set
                          name = excluded.name, base_url = excluded.base_url, enabled = true
                        returning id
                        """,
                        (
                            query.company.id,
                            external_key,
                            (result.title or f"Public page on {hostname}")[:500],
                            canonical,
                            Jsonb({"discovered_by": query.provider}),
                        ),
                    )
                    source = await cursor.fetchone()
                    if source is None:
                        raise RuntimeError("public web candidate source upsert returned no row")
                    cursor = await connection.execute(
                        """
                        insert into public.public_web_candidates (
                          company_id, source_id, source_provider, original_url,
                          canonical_url, title, snippet
                        ) values (%s, %s, %s, %s, %s, %s, %s)
                        on conflict (company_id, canonical_url) do update set
                          last_seen_at = excluded.last_seen_at,
                          title = coalesce(
                            nullif(excluded.title, ''), public.public_web_candidates.title
                          ),
                          snippet = coalesce(
                            nullif(excluded.snippet, ''), public.public_web_candidates.snippet
                          )
                        returning id, fetch_status
                        """,
                        (
                            query.company.id,
                            source["id"],
                            query.provider,
                            result.url,
                            canonical,
                            result.title or None,
                            result.snippet or None,
                        ),
                    )
                    candidate = await cursor.fetchone()
                    if candidate is None:
                        raise RuntimeError("public web candidate upsert returned no row")
                    await connection.execute(
                        """
                        insert into public.public_web_candidate_discoveries (
                          candidate_id, search_query_id, result_rank, metadata
                        ) values (%s, %s, %s, %s)
                        on conflict (candidate_id, search_query_id) do nothing
                        """,
                        (candidate["id"], query.id, result.rank, Jsonb(result.metadata)),
                    )
                    candidates.append((candidate["id"], candidate["fetch_status"]))
                fetch_ids = tuple(
                    candidate_id
                    for candidate_id, status in candidates
                    if status in {"PENDING", "FAILED"}
                )[: query.max_fetches]
                for candidate_id in fetch_ids:
                    await connection.execute(
                        """
                        insert into public.public_web_work_requests (
                          work_type, company_id, candidate_id, requested_by,
                          metadata
                        ) values ('WEB_FETCH', %s, %s, 'web-search', %s)
                        on conflict (work_type, candidate_id)
                          where status in ('PENDING', 'RUNNING')
                            and work_type in ('WEB_FETCH', 'WEB_PROCESS')
                        do nothing
                        """,
                        (
                            query.company.id,
                            candidate_id,
                            Jsonb({"parent_request_id": str(request.id)}),
                        ),
                    )
                await connection.execute(
                    """
                    update public.public_web_search_queries set
                      status = 'SUCCEEDED', last_run_at = %s, last_success_at = %s,
                      last_result_count = %s,
                      next_allowed_run_at = %s + make_interval(secs => minimum_interval_seconds)
                    where id = %s
                    """,
                    (now, now, len(candidates), now, query.id),
                )
                await connection.execute(
                    """
                    update public.public_web_runs set provider = %s, query = %s,
                      candidate_count = %s
                    where collector_run_id = %s
                    """,
                    (query.provider, query.query, len(candidates), run_id),
                )
        return len(candidates), fetch_ids

    async def persist_fetched_document(
        self,
        *,
        run_id: UUID,
        request: PublicWebWorkRequest,
        candidate: CandidateConfig,
        fetched: FetchedDocument,
        extracted: ExtractedDocument,
        content_hash: str,
    ) -> tuple[StoredDocument | None, bool]:
        async with await self._connect() as connection:
            async with connection.transaction():
                await connection.execute(
                    "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"web-candidate:{candidate.id}",),
                )
                cursor = await connection.execute(
                    """
                    select content_hash from public.public_web_candidates
                    where id = %s for update
                    """,
                    (candidate.id,),
                )
                current = await cursor.fetchone()
                if current is None:
                    raise KeyError(f"public web candidate {candidate.id} was not found")
                if current["content_hash"] == content_hash:
                    await connection.execute(
                        """
                        update public.public_web_candidates set
                          last_fetched_at = %s, fetch_status = 'UNCHANGED',
                          http_status = %s, content_type = %s
                        where id = %s
                        """,
                        (
                            fetched.fetched_at,
                            fetched.status_code,
                            fetched.content_type,
                            candidate.id,
                        ),
                    )
                    return None, True
                cursor = await connection.execute(
                    """
                    insert into public.public_web_documents (
                      candidate_id, content_hash, fetched_at, final_url, http_status,
                      content_type, title, meta_description, canonical_url,
                      published_at, headings, extracted_text, structured_metadata
                    ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    on conflict (candidate_id, content_hash) do update set
                      fetched_at = excluded.fetched_at
                    returning id
                    """,
                    (
                        candidate.id,
                        content_hash,
                        fetched.fetched_at,
                        fetched.final_url,
                        fetched.status_code,
                        fetched.content_type,
                        extracted.title,
                        extracted.meta_description,
                        extracted.canonical_url,
                        extracted.published_at,
                        list(extracted.headings),
                        extracted.text,
                        Jsonb(extracted.structured_metadata),
                    ),
                )
                document = await cursor.fetchone()
                if document is None:
                    raise RuntimeError("public web document upsert returned no row")
                await connection.execute(
                    """
                    update public.public_web_candidates set
                      last_fetched_at = %s, fetch_status = 'FETCHED', http_status = %s,
                      content_type = %s, content_hash = %s
                    where id = %s
                    """,
                    (
                        fetched.fetched_at,
                        fetched.status_code,
                        fetched.content_type,
                        content_hash,
                        candidate.id,
                    ),
                )
                await connection.execute(
                    """
                    insert into public.public_web_work_requests (
                      work_type, company_id, candidate_id, requested_by, metadata
                    ) values ('WEB_PROCESS', %s, %s, 'web-fetch', %s)
                    on conflict (work_type, candidate_id)
                      where status in ('PENDING', 'RUNNING')
                        and work_type in ('WEB_FETCH', 'WEB_PROCESS')
                    do nothing
                    """,
                    (
                        candidate.company.id,
                        candidate.id,
                        Jsonb(
                            {
                                "parent_request_id": str(request.id),
                                "content_hash": content_hash,
                            }
                        ),
                    ),
                )
                await connection.execute(
                    """
                    update public.public_web_runs set fetched_count = 1
                    where collector_run_id = %s
                    """,
                    (run_id,),
                )
        return (
            StoredDocument(
                id=document["id"],
                candidate_id=candidate.id,
                content_hash=content_hash,
                extracted=extracted,
                fetched_at=fetched.fetched_at,
            ),
            False,
        )

    async def get_current_document(self, candidate: CandidateConfig) -> StoredDocument:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select * from public.public_web_documents
                where candidate_id = %s and content_hash = (
                  select content_hash from public.public_web_candidates where id = %s
                )
                order by fetched_at desc limit 1
                """,
                (candidate.id, candidate.id),
            )
            row = await cursor.fetchone()
        if row is None:
            raise KeyError(f"candidate {candidate.id} has no current extracted document")
        extracted = ExtractedDocument(
            final_url=row["final_url"],
            title=row["title"],
            meta_description=row["meta_description"],
            canonical_url=row["canonical_url"],
            published_at=row["published_at"],
            headings=tuple(row["headings"]),
            text=row["extracted_text"],
            structured_metadata=row["structured_metadata"],
        )
        return StoredDocument(
            id=row["id"],
            candidate_id=candidate.id,
            content_hash=row["content_hash"],
            extracted=extracted,
            fetched_at=row["fetched_at"],
        )

    @staticmethod
    async def _find_school(
        cursor: psycopg.AsyncCursor[dict[str, Any]], hostname: str
    ) -> UUID | None:
        await cursor.execute("select id, domains from public.schools")
        for row in await cursor.fetchall():
            if any(
                hostname == domain or hostname.endswith(f".{domain}") for domain in row["domains"]
            ):
                return UUID(str(row["id"]))
        return None

    @staticmethod
    async def _find_job(
        cursor: psycopg.AsyncCursor[dict[str, Any]], company_id: UUID, urls: tuple[str, ...]
    ) -> UUID | None:
        await cursor.execute(
            """
            select id from public.jobs
            where company_id = %s and (application_url = any(%s) or source_url = any(%s))
            limit 2
            """,
            (company_id, list(urls), list(urls)),
        )
        rows = await cursor.fetchall()
        return UUID(str(rows[0]["id"])) if len(rows) == 1 else None

    @staticmethod
    async def _recompute_claim(cursor: psycopg.AsyncCursor[dict[str, Any]], claim_id: UUID) -> None:
        await cursor.execute(
            """
            select count(distinct o.source_id)::int source_count,
                   count(distinct concat(o.date_start::text, ':', coalesce(o.date_end::text, '')))
                     filter (where o.date_start is not null)::int date_count,
                   max(o.last_verified_at) last_verified_at
            from public.public_recruiting_claim_observations co
            join public.public_recruiting_observations o on o.id = co.observation_id
            where co.claim_id = %s
            """,
            (claim_id,),
        )
        counts = await cursor.fetchone()
        if counts is None:
            return
        status = (
            "CONFLICTING"
            if counts["date_count"] > 1
            else "SUPPORTED"
            if counts["source_count"] > 1
            else "SINGLE_SOURCE"
        )
        await cursor.execute(
            """
            select o.id, o.confidence
            from public.public_recruiting_claim_observations co
            join public.public_recruiting_observations o on o.id = co.observation_id
            where co.claim_id = %s
            order by
              case o.reliability_level
                when 'OFFICIAL' then 5 when 'HIGH' then 4 when 'MEDIUM' then 3
                when 'LOW' then 2 else 1 end desc,
              o.last_verified_at desc, o.id
            limit 1
            """,
            (claim_id,),
        )
        preferred = await cursor.fetchone()
        if preferred is None:
            return
        await cursor.execute(
            """
            update public.public_recruiting_claims set
              status = %s, preferred_observation_id = %s,
              last_verified_at = %s, confidence = %s,
              metadata = metadata || %s
            where id = %s
            """,
            (
                status,
                preferred["id"],
                counts["last_verified_at"],
                preferred["confidence"],
                Jsonb(
                    {
                        "source_count": counts["source_count"],
                        "distinct_date_count": counts["date_count"],
                    }
                ),
                claim_id,
            ),
        )

    async def persist_processed_document(
        self,
        *,
        run_id: UUID,
        request: PublicWebWorkRequest,
        candidate: CandidateConfig,
        document: StoredDocument,
        assessment: SourceAssessment,
        relevance: RelevanceDecision,
        observations: Sequence[NormalizedWebObservation],
    ) -> tuple[int, int]:
        now = datetime.now(UTC)
        created = 0
        events = 0
        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = connection.cursor()
                await cursor.execute(
                    "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"web-process:{candidate.id}",),
                )
                await cursor.execute(
                    """
                    update public.public_web_candidates set
                      relevance_status = %s, source_classification = %s,
                      reliability_level = %s, metadata = metadata || %s
                    where id = %s
                    """,
                    (
                        relevance.status.value,
                        assessment.classification.value,
                        assessment.reliability_level.value,
                        Jsonb(
                            {
                                "relevance_signals": list(relevance.signals),
                                "relevance_reasons": list(relevance.reasons),
                                "source_reasons": list(assessment.reasons),
                            }
                        ),
                        candidate.id,
                    ),
                )
                await cursor.execute(
                    """
                    update public.sources set source_type = %s, reliability = %s,
                      metadata = metadata || %s
                    where id = %s
                    """,
                    (
                        _SOURCE_TYPE[assessment.classification],
                        assessment.confidence,
                        Jsonb(
                            {
                                "classification": assessment.classification.value,
                                "reliability_level": assessment.reliability_level.value,
                            }
                        ),
                        candidate.source_id,
                    ),
                )
                hostname = (urlsplit(document.extracted.final_url).hostname or "").casefold()
                school_id = await self._find_school(cursor, hostname)
                urls = tuple(
                    dict.fromkeys(
                        value
                        for value in (
                            candidate.canonical_url,
                            document.extracted.final_url,
                            document.extracted.canonical_url,
                        )
                        if value
                    )
                )
                job_id = await self._find_job(cursor, candidate.company.id, urls)
                first_observation_id: UUID | None = None
                for observation in observations:
                    fingerprint = observation_fingerprint(
                        company_id=candidate.company.id,
                        candidate_id=candidate.id,
                        observation=observation,
                    )
                    await cursor.execute(
                        """
                        insert into public.public_recruiting_observations (
                          company_id, source_id, candidate_id, document_id, job_id,
                          school_id, observation_type, title, summary, evidence_text,
                          source_url, source_classification, reliability_level,
                          occurred_at, date_start, date_end, date_precision,
                          date_certainty, discovered_at, last_verified_at,
                          confidence, content_hash, metadata, fingerprint
                        ) values (
                          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        )
                        on conflict (fingerprint) do nothing
                        returning id
                        """,
                        (
                            candidate.company.id,
                            candidate.source_id,
                            candidate.id,
                            document.id,
                            job_id,
                            school_id,
                            observation.observation_type.value,
                            observation.title,
                            observation.summary,
                            observation.evidence_text,
                            observation.source_url,
                            assessment.classification.value,
                            assessment.reliability_level.value,
                            observation.occurred_at,
                            observation.date_start,
                            observation.date_end,
                            observation.date_precision.value,
                            observation.date_certainty.value,
                            now,
                            now,
                            assessment.confidence,
                            document.content_hash,
                            Jsonb(
                                {
                                    **observation.metadata,
                                    "relevance_signals": list(relevance.signals),
                                    "linked_job": job_id is not None,
                                }
                            ),
                            fingerprint,
                        ),
                    )
                    inserted = await cursor.fetchone()
                    is_new = inserted is not None
                    if inserted is None:
                        await cursor.execute(
                            """
                            update public.public_recruiting_observations set
                              last_verified_at = %s,
                              metadata = metadata || %s
                            where fingerprint = %s
                            returning id
                            """,
                            (
                                now,
                                Jsonb({"last_verified_content_hash": document.content_hash}),
                                fingerprint,
                            ),
                        )
                        inserted = await cursor.fetchone()
                    if inserted is None:
                        raise RuntimeError("public recruiting observation resolution failed")
                    observation_id = UUID(str(inserted["id"]))
                    first_observation_id = first_observation_id or observation_id
                    claim_key = observation.claim_subject.casefold()
                    claim_hash = claim_fingerprint(
                        company_id=candidate.company.id,
                        observation_type=observation.observation_type.value,
                        normalized_subject=claim_key,
                    )
                    await cursor.execute(
                        """
                        insert into public.public_recruiting_claims (
                          company_id, claim_type, title, normalized_subject,
                          last_verified_at, confidence, fingerprint
                        ) values (%s, %s, %s, %s, %s, %s, %s)
                        on conflict (company_id, claim_type, normalized_subject) do update set
                          last_verified_at = greatest(
                            public.public_recruiting_claims.last_verified_at,
                            excluded.last_verified_at
                          )
                        returning id
                        """,
                        (
                            candidate.company.id,
                            observation.observation_type.value,
                            observation.title,
                            claim_key,
                            now,
                            assessment.confidence,
                            claim_hash,
                        ),
                    )
                    claim = await cursor.fetchone()
                    if claim is None:
                        raise RuntimeError("public recruiting claim upsert returned no row")
                    await cursor.execute(
                        """
                        insert into public.public_recruiting_claim_observations (
                          claim_id, observation_id
                        ) values (%s, %s)
                        on conflict do nothing
                        """,
                        (claim["id"], observation_id),
                    )
                    await self._recompute_claim(cursor, UUID(str(claim["id"])))
                    if not is_new:
                        continue
                    created += 1
                    event_type = _EVENT_TYPE[observation.observation_type]
                    event_hash = web_event_fingerprint(
                        company_id=candidate.company.id,
                        source_id=candidate.source_id,
                        event_type=event_type,
                        causal_key=f"observation:{fingerprint}",
                    )
                    await cursor.execute(
                        """
                        insert into public.recruiting_events (
                          company_id, source_id, job_id, event_type, occurred_at,
                          discovered_at, source_url, confidence, fingerprint, payload,
                          public_recruiting_observation_id, public_web_candidate_id
                        ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (fingerprint) do nothing
                        returning id
                        """,
                        (
                            candidate.company.id,
                            candidate.source_id,
                            job_id,
                            event_type.value,
                            observation.occurred_at or now,
                            now,
                            observation.source_url,
                            assessment.confidence,
                            event_hash,
                            Jsonb(
                                {
                                    "observation_type": observation.observation_type.value,
                                    "content_hash": document.content_hash,
                                    "reliability_level": assessment.reliability_level.value,
                                }
                            ),
                            observation_id,
                            candidate.id,
                        ),
                    )
                    events += int(await cursor.fetchone() is not None)
                if (
                    relevance.status is RelevanceStatus.RELEVANT
                    and assessment.classification is WebSourceClassification.COMPANY_CAREERS
                ):
                    await cursor.execute(
                        """
                        select count(*)::int count from public.public_web_documents
                        where candidate_id = %s
                        """,
                        (candidate.id,),
                    )
                    document_count = await cursor.fetchone()
                    if document_count and document_count["count"] > 1:
                        event_type = RecruitingEventType.CAREER_PAGE_CHANGED
                        event_hash = web_event_fingerprint(
                            company_id=candidate.company.id,
                            source_id=candidate.source_id,
                            event_type=event_type,
                            causal_key=f"document:{document.content_hash}",
                        )
                        await cursor.execute(
                            """
                            insert into public.recruiting_events (
                              company_id, source_id, event_type, occurred_at, discovered_at,
                              source_url, confidence, fingerprint, payload,
                              public_recruiting_observation_id, public_web_candidate_id
                            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            on conflict (fingerprint) do nothing returning id
                            """,
                            (
                                candidate.company.id,
                                candidate.source_id,
                                event_type.value,
                                now,
                                now,
                                document.extracted.final_url,
                                assessment.confidence,
                                event_hash,
                                Jsonb({"content_hash": document.content_hash}),
                                first_observation_id,
                                candidate.id,
                            ),
                        )
                        events += int(await cursor.fetchone() is not None)
                await cursor.execute(
                    """
                    update public.public_web_runs set
                      relevant_count = %s, observations_created = %s,
                      events_created = %s
                    where collector_run_id = %s
                    """,
                    (
                        int(relevance.status is RelevanceStatus.RELEVANT),
                        created,
                        events,
                        run_id,
                    ),
                )
        return created, events

    async def complete_run(self, run_id: UUID, stats: WebRunStats) -> None:
        now = datetime.now(UTC)
        async with await self._connect() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    update public.public_web_runs set
                      candidate_count = greatest(candidate_count, %s),
                      fetched_count = greatest(fetched_count, %s),
                      relevant_count = greatest(relevant_count, %s),
                      observations_created = greatest(observations_created, %s),
                      events_created = greatest(events_created, %s), duration_ms = %s
                    where collector_run_id = %s
                    """,
                    (
                        stats.candidates,
                        stats.fetched,
                        stats.relevant,
                        stats.observations_created,
                        stats.events_created,
                        stats.duration_ms,
                        run_id,
                    ),
                )
                await connection.execute(
                    """
                    update public.collector_runs set
                      status = 'SUCCEEDED', finished_at = %s,
                      items_discovered = %s, items_new = %s,
                      items_unchanged = %s
                    where id = %s and status = 'RUNNING'
                    """,
                    (
                        now,
                        stats.candidates,
                        stats.observations_created,
                        int(stats.unchanged),
                        run_id,
                    ),
                )
                await connection.execute(
                    """
                    update public.public_web_work_requests set
                      status = 'SUCCEEDED', finished_at = %s
                    where id = %s and status = 'RUNNING'
                    """,
                    (now, stats.request_id),
                )

    async def fail_run(
        self, run_id: UUID | None, request: PublicWebWorkRequest, error: Exception
    ) -> None:
        now = datetime.now(UTC)
        blocked = isinstance(error, (UnsafeUrlError, RobotsDeniedError))
        retry = not blocked and request.attempt_count < request.max_attempts
        stage = {
            WebWorkType.SEARCH: "DISCOVER",
            WebWorkType.FETCH: "FETCH",
            WebWorkType.PROCESS: "NORMALIZE",
        }[request.work_type]
        async with await self._connect() as connection:
            async with connection.transaction():
                if run_id is not None:
                    await connection.execute(
                        """
                        insert into public.collector_errors (
                          collector_run_id, stage, error_type, message, retryable, context
                        ) values (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            run_id,
                            stage,
                            type(error).__name__,
                            str(error)[:2000],
                            retry,
                            Jsonb({"work_request_id": str(request.id)}),
                        ),
                    )
                    await connection.execute(
                        """
                        update public.collector_runs set
                          status = 'FAILED', finished_at = %s, errors = errors + 1
                        where id = %s and status = 'RUNNING'
                        """,
                        (now, run_id),
                    )
                    await connection.execute(
                        """
                        update public.public_web_runs set errors = errors + 1
                        where collector_run_id = %s
                        """,
                        (run_id,),
                    )
                if retry:
                    await connection.execute(
                        """
                        update public.public_web_work_requests set
                          status = 'PENDING', started_at = null, finished_at = null,
                          next_attempt_at = %s, error_message = %s
                        where id = %s
                        """,
                        (
                            now + timedelta(seconds=min(2**request.attempt_count * 30, 3600)),
                            str(error)[:2000],
                            request.id,
                        ),
                    )
                else:
                    await connection.execute(
                        """
                        update public.public_web_work_requests set
                          status = 'FAILED', finished_at = %s, error_message = %s
                        where id = %s
                        """,
                        (now, str(error)[:2000], request.id),
                    )
                if request.candidate_id is not None:
                    await connection.execute(
                        """
                        update public.public_web_candidates set fetch_status = %s,
                          metadata = metadata || %s
                        where id = %s
                        """,
                        (
                            "BLOCKED" if blocked else "FAILED",
                            Jsonb({"last_error": type(error).__name__}),
                            request.candidate_id,
                        ),
                    )
                if request.search_query_id is not None:
                    await connection.execute(
                        """
                        update public.public_web_search_queries set
                          status = 'FAILED', last_run_at = %s,
                          next_allowed_run_at = %s
                        where id = %s
                        """,
                        (now, now + timedelta(minutes=5), request.search_query_id),
                    )
