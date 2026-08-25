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
from recruitintel_collectors.domain.fingerprints import (
    fingerprint_event,
    fingerprint_job_derivation,
)
from recruitintel_collectors.domain.normalization import normalize_company_name
from recruitintel_collectors.opportunities.jsonld import normalize_json_ld_job_posting
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
    DirectSourceEndpoint,
    ExtractedDocument,
    FetchedDocument,
    NormalizedWebObservation,
    PublicWebWorkRequest,
    RelevanceDecision,
    SearchBatch,
    SearchQueryConfig,
    SourceAssessment,
    StoredDocument,
    WebRunStats,
)
from recruitintel_collectors.public_web.search import (
    SearchProviderAuthRequiredError,
    SearchProviderCostBlockedError,
    SearchProviderPermanentError,
    SearchProviderRateLimitedError,
)
from recruitintel_collectors.public_web.urls import UnsafeUrlError, canonicalize_url
from recruitintel_collectors.redaction import redact_text

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
    def __init__(self, database_url: str, *, work_attempt_id: UUID | None = None) -> None:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        self.database_url = database_url
        self.work_attempt_id = work_attempt_id

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
                    """
                    select request.*, request.next_attempt_at <= now() as is_eligible
                    from public.public_web_work_requests request
                    where request.id = %s for update
                    """,
                    (request_id,),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise KeyError(f"public web work request {request_id} was not found")
                if row["status"] != WebWorkStatus.PENDING.value:
                    raise ValueError(f"public web work request is {row['status']}, not PENDING")
                if not row["is_eligible"]:
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
            template_key=row["template_key"],
            query=row["query"],
            minimum_interval_seconds=row["minimum_interval_seconds"],
            max_results=row["max_results"],
            max_fetches=row["max_fetches"],
            next_allowed_run_at=row["next_allowed_run_at"],
        )

    async def has_direct_source_coverage(self, query: SearchQueryConfig) -> bool:
        if query.template_key not in {
            "early-career",
            "internship",
            "internship-role",
            "new-grad",
            "role",
        }:
            return False
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select exists (
                  select 1 from public.sources source
                  where source.company_id = %s
                    and source.source_type in ('ATS', 'COMPANY_CAREERS')
                    and public.source_policy_is_executable(source.id)
                ) as covered
                """,
                (query.company.id,),
            )
            row = await cursor.fetchone()
        return bool(row and row["covered"])

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
                        insert into public.collector_runs (
                          source_id, collector, metadata, work_attempt_id
                        ) values (%s, 'public_web', %s, %s)
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
                            self.work_attempt_id,
                        ),
                    )
                    row = await cursor.fetchone()
                    if row is None:
                        raise RuntimeError("public web collector run insert returned no ID")
                    run_id = UUID(str(row["id"]))
                    await connection.execute(
                        """
                        insert into public.public_web_runs (
                          collector_run_id, work_request_id, company_id, work_attempt_id
                        ) values (%s, %s, %s, %s)
                        """,
                        (run_id, request.id, request.company_id, self.work_attempt_id),
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
        batch: SearchBatch,
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
                for result in batch.results[: query.max_results]:
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
                          base_url, reliability, metadata, source_policy_id
                        ) values (
                          %s, 'PUBLIC_WEB', 'public_web', %s, %s, %s, 0.500, %s,
                          public.executable_source_policy_for_hostname(%s)
                        )
                        on conflict (provider, external_key) do update set
                          name = excluded.name, base_url = excluded.base_url, enabled = true,
                          source_policy_id = coalesce(
                            excluded.source_policy_id, public.sources.source_policy_id
                          )
                        returning id
                        """,
                        (
                            query.company.id,
                            external_key,
                            (result.title or f"Public page on {hostname}")[:500],
                            canonical,
                            Jsonb({"discovered_by": query.provider}),
                            hostname,
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
                        (
                            candidate["id"],
                            query.id,
                            result.rank,
                            Jsonb(
                                {
                                    "result_kind": result.result_kind.value,
                                    "published_at": (
                                        result.published_at.isoformat()
                                        if result.published_at is not None
                                        else None
                                    ),
                                    **result.metadata.model_dump(mode="json", exclude_none=True),
                                }
                            ),
                        ),
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
                        ) select 'WEB_FETCH', %s, %s, 'web-search', %s
                        where public.source_policy_is_executable(
                          (select source_id from public.public_web_candidates where id = %s)
                        )
                        on conflict (work_type, candidate_id)
                          where status in ('PENDING', 'RUNNING')
                            and work_type in ('WEB_FETCH', 'WEB_PROCESS')
                        do nothing
                        """,
                        (
                            query.company.id,
                            candidate_id,
                            Jsonb({"parent_request_id": str(request.id)}),
                            candidate_id,
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
                      candidate_count = %s, metadata = metadata || %s
                    where collector_run_id = %s
                    """,
                    (
                        query.provider,
                        query.query,
                        len(candidates),
                        Jsonb(
                            {
                                "provider_calls": batch.provider_calls,
                                "cost_units": batch.cost_units,
                                "estimated_cost_micros": batch.estimated_cost_micros,
                                "paid_spend_micros": batch.paid_spend_micros,
                                "quota_remaining": batch.quota_remaining,
                                "quota_reset_at": (
                                    batch.quota_reset_at.isoformat()
                                    if batch.quota_reset_at is not None
                                    else None
                                ),
                                "truncated": batch.truncated,
                            }
                        ),
                        run_id,
                    ),
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

    async def persist_direct_sources(
        self,
        *,
        candidate: CandidateConfig,
        discoveries: Sequence[DirectSourceEndpoint],
        verified_at: datetime,
    ) -> int:
        if not discoveries:
            async with await self._connect() as connection:
                await connection.execute(
                    "update public.sources set last_verified_at = %s where id = %s",
                    (verified_at, candidate.source_id),
                )
            return 0
        created = 0
        async with await self._connect() as connection:
            async with connection.transaction():
                await connection.execute(
                    "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"direct-source:{candidate.company.id}",),
                )
                await connection.execute(
                    "update public.sources set last_verified_at = %s where id = %s",
                    (verified_at, candidate.source_id),
                )
                for discovery in discoveries:
                    cursor = await connection.execute(
                        """
                        select id from public.sources
                        where discovery_fingerprint = %s
                           or (provider = %s and external_key = %s)
                        limit 1
                        """,
                        (
                            discovery.fingerprint,
                            discovery.provider,
                            discovery.external_key,
                        ),
                    )
                    existed = await cursor.fetchone() is not None
                    hostname = (urlsplit(discovery.url).hostname or "").casefold()
                    if discovery.source_type == "ATS":
                        policy_cursor = await connection.execute(
                            "select id from public.source_policies where provider = %s",
                            (discovery.provider,),
                        )
                    else:
                        policy_cursor = await connection.execute(
                            "select public.executable_source_policy_for_hostname(%s) as id",
                            (hostname,),
                        )
                    policy_row = await policy_cursor.fetchone()
                    policy_id = policy_row["id"] if policy_row is not None else None
                    cursor = await connection.execute(
                        """
                        insert into public.sources (
                          company_id, source_type, provider, external_key, name, base_url,
                          reliability, enabled, metadata, source_policy_id,
                          discovery_method, first_seen_at, last_verified_at,
                          discovery_confidence, discovered_from_source_id,
                          discovery_fingerprint, discovery_provenance
                        ) values (
                          %s, %s::public.source_type, %s, %s, %s, %s, %s, %s, %s,
                          %s, %s::public.source_discovery_method,
                          %s, %s, %s, %s, %s, %s
                        )
                        on conflict (provider, external_key) do update set
                          source_type = excluded.source_type,
                          name = excluded.name,
                          base_url = excluded.base_url,
                          reliability = greatest(public.sources.reliability, excluded.reliability),
                          enabled = public.sources.enabled or excluded.enabled,
                          metadata = public.sources.metadata || excluded.metadata,
                          source_policy_id = coalesce(
                            excluded.source_policy_id, public.sources.source_policy_id
                          ),
                          last_verified_at = excluded.last_verified_at,
                          discovery_confidence = greatest(
                            public.sources.discovery_confidence,
                            excluded.discovery_confidence
                          ),
                          discovery_provenance = public.sources.discovery_provenance
                            || excluded.discovery_provenance
                        returning id
                        """,
                        (
                            candidate.company.id,
                            discovery.source_type,
                            discovery.provider,
                            discovery.external_key,
                            discovery.name,
                            discovery.url,
                            discovery.confidence,
                            discovery.collector_supported and policy_id is not None,
                            Jsonb(
                                {
                                    "ats_type": discovery.ats_type,
                                    "collector_supported": discovery.collector_supported,
                                }
                            ),
                            policy_id,
                            discovery.discovery_method.value,
                            verified_at,
                            verified_at,
                            discovery.confidence,
                            candidate.source_id,
                            discovery.fingerprint,
                            Jsonb(
                                {
                                    "evidence": discovery.evidence,
                                    "discovered_from_url": discovery.discovered_from_url,
                                }
                            ),
                        ),
                    )
                    source = await cursor.fetchone()
                    if source is None:
                        raise RuntimeError("direct source upsert returned no row")
                    source_id = UUID(str(source["id"]))
                    await connection.execute(
                        """
                        update public.sources set enabled = enabled
                          and public.source_policy_is_executable(id)
                        where id = %s
                        """,
                        (source_id,),
                    )
                    if not existed:
                        created += 1
                    if discovery.source_type == "ATS":
                        if discovery.collector_supported and discovery.ats_type is not None:
                            await connection.execute(
                                """
                                update public.companies set
                                  ats_type = %s::public.ats_type,
                                  ats_identifier = %s
                                where id = %s and ats_type is null and ats_identifier is null
                                  and not exists (
                                    select 1 from public.companies existing
                                    where existing.id <> %s
                                      and existing.ats_type = %s::public.ats_type
                                      and existing.ats_identifier = %s
                                  )
                                """,
                                (
                                    discovery.ats_type,
                                    discovery.external_key,
                                    candidate.company.id,
                                    candidate.company.id,
                                    discovery.ats_type,
                                    discovery.external_key,
                                ),
                            )
                        await connection.execute(
                            """
                            insert into public.schedules (
                              name, work_type, work_class, source_id, enabled,
                              schedule_kind, interval_seconds, anchor_at, next_run_at,
                              jitter_seconds, priority, max_attempts, retry_policy
                            ) select 'ats:' || source.id::text, 'ATS_COLLECT', 'ATS', source.id,
                              source.enabled and public.source_policy_is_executable(source.id),
                              'INTERVAL', 3600, now(), now() + interval '1 hour',
                              300, 60, 3, 'EXPONENTIAL_V1'
                            from public.sources source where source.id = %s
                            on conflict (name) do update set
                              enabled = excluded.enabled, updated_at = now()
                            """,
                            (source_id,),
                        )
                        continue
                    cursor = await connection.execute(
                        """
                        insert into public.public_web_candidates (
                          company_id, source_id, source_provider, original_url,
                          canonical_url, title, snippet
                        ) values (%s, %s, 'direct', %s, %s, %s, %s)
                        on conflict (company_id, canonical_url) do update set
                          source_id = excluded.source_id,
                          last_seen_at = excluded.last_seen_at,
                          title = coalesce(public.public_web_candidates.title, excluded.title)
                        returning id
                        """,
                        (
                            candidate.company.id,
                            source_id,
                            discovery.url,
                            discovery.url,
                            discovery.name,
                            discovery.evidence,
                        ),
                    )
                    direct_candidate = await cursor.fetchone()
                    if direct_candidate is None:
                        raise RuntimeError("direct candidate upsert returned no row")
                    await connection.execute(
                        """
                        insert into public.schedules (
                          name, work_type, work_class, public_web_candidate_id,
                          enabled, schedule_kind, interval_seconds, anchor_at,
                          next_run_at, jitter_seconds, priority, max_attempts, retry_policy
                        ) select 'direct-web:' || candidate.id::text,
                          'PUBLIC_WEB_FETCH', 'WEB_FETCH', candidate.id,
                          public.source_policy_is_executable(candidate.source_id),
                          'INTERVAL', 21600, now(), now() + interval '6 hours',
                          900, 45, 3, 'EXPONENTIAL_V1'
                        from public.public_web_candidates candidate where candidate.id = %s
                        on conflict (name) do update set
                          enabled = excluded.enabled, updated_at = now()
                        """,
                        (direct_candidate["id"],),
                    )
        return created

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

    @staticmethod
    async def _resolve_json_ld_source(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        candidate: CandidateConfig,
        document: StoredDocument,
    ) -> tuple[UUID, float] | None:
        await cursor.execute(
            """
            select id, reliability from public.sources
            where id = %s and company_id = %s
              and source_type in ('ATS', 'COMPANY_CAREERS')
              and public.source_policy_is_executable(id)
            """,
            (candidate.source_id, candidate.company.id),
        )
        direct = await cursor.fetchone()
        if direct is not None:
            return UUID(str(direct["id"])), float(direct["reliability"])

        final_url = canonicalize_url(document.extracted.final_url)
        hostname = (urlsplit(final_url).hostname or "").casefold()
        await cursor.execute(
            "select public.executable_source_policy_for_hostname(%s) as id",
            (hostname,),
        )
        policy = await cursor.fetchone()
        if policy is None or policy["id"] is None:
            return None
        external_key = candidate_source_key(candidate.company.id, final_url)
        await cursor.execute(
            """
            insert into public.sources (
              company_id, source_type, provider, external_key, name, base_url,
              reliability, enabled, source_policy_id, discovery_method,
              last_verified_at, discovered_from_source_id, discovery_provenance
            ) values (
              %s, 'COMPANY_CAREERS', 'public_web', %s, %s, %s,
              0.900, true, %s, 'SEARCH', %s, %s, %s
            )
            on conflict (provider, external_key) do update set
              last_verified_at = excluded.last_verified_at,
              reliability = greatest(public.sources.reliability, excluded.reliability),
              discovered_from_source_id = coalesce(
                public.sources.discovered_from_source_id,
                excluded.discovered_from_source_id
              ),
              discovery_provenance = public.sources.discovery_provenance
                || excluded.discovery_provenance
            returning id, reliability
            """,
            (
                candidate.company.id,
                external_key,
                f"{candidate.company.canonical_name} JobPosting page",
                final_url,
                policy["id"],
                document.fetched_at,
                candidate.source_id,
                Jsonb(
                    {
                        "method": "validated_jobposting_jsonld",
                        "candidateId": str(candidate.id),
                    }
                ),
            ),
        )
        source = await cursor.fetchone()
        if source is None:
            raise RuntimeError("JSON-LD source endpoint upsert returned no row")
        source_id = UUID(str(source["id"]))
        await cursor.execute(
            "update public.public_web_candidates set source_id = %s where id = %s",
            (source_id, candidate.id),
        )
        await cursor.execute(
            """
            insert into public.schedules (
              name, work_type, work_class, public_web_candidate_id, enabled,
              schedule_kind, interval_seconds, anchor_at, next_run_at,
              jitter_seconds, priority, max_attempts, retry_policy
            ) values (
              %s, 'PUBLIC_WEB_FETCH', 'WEB_FETCH', %s, true, 'INTERVAL', 21600,
              now(), now() + interval '6 hours', 900, 45, 3, 'EXPONENTIAL_V1'
            ) on conflict (name) do update set enabled = true, updated_at = now()
            """,
            (f"direct-web:{candidate.id}", candidate.id),
        )
        return source_id, float(source["reliability"])

    @staticmethod
    async def _persist_json_ld_postings(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        run_id: UUID,
        candidate: CandidateConfig,
        document: StoredDocument,
    ) -> int:
        raw_postings = document.extracted.structured_metadata.get("job_postings")
        if not isinstance(raw_postings, list):
            return 0
        await cursor.execute(
            """
            select canonical_name as name from public.companies where id = %s
            union all select alias from public.company_aliases where company_id = %s
            """,
            (candidate.company.id, candidate.company.id),
        )
        names = frozenset(normalize_company_name(row["name"]) for row in await cursor.fetchall())
        source = await PostgresPublicWebRepository._resolve_json_ld_source(
            cursor, candidate=candidate, document=document
        )
        if source is None:
            return 0
        source_id, reliability = source
        persisted = 0
        now = datetime.now(UTC)
        for raw in raw_postings[:50]:
            if not isinstance(raw, dict):
                continue
            normalized = normalize_json_ld_job_posting(
                raw,
                company_id=str(candidate.company.id),
                company_names=names,
                document_url=document.extracted.final_url,
            )
            if normalized is None:
                continue
            value, deadline_at = normalized
            job = value.job
            derivation_hash = value.derivation_hash or fingerprint_job_derivation(job)
            await cursor.execute(
                """
                select id, title, description, location, application_url, source_url,
                  published_at, content_hash, source_content_hash, source_content_version,
                  derivation_hash, derivation_version, closed_at
                from public.jobs where source_id = %s and external_id = %s for update
                """,
                (source_id, job.external_id),
            )
            existing = await cursor.fetchone()
            same_source = bool(
                existing
                and existing["title"] == job.title
                and existing["description"] == job.description
                and existing["location"] == job.location
                and existing["application_url"] == job.application_url
                and existing["source_url"] == job.source_url
                and existing["published_at"] == job.published_at
            )
            if existing is None:
                await cursor.execute(
                    """
                    insert into public.jobs (
                      company_id, source_id, external_id, title, description, location,
                      employment_type, role_family, experience_level, is_internship,
                      is_new_grad, season, graduation_years, application_url, source_url,
                      first_seen_at, last_seen_at, changed_at, published_at, content_hash,
                      fingerprint_version, source_content_hash, source_content_version,
                      derivation_hash, derivation_version, classification_version,
                      last_seen_run_id, raw_payload
                    ) values (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      %s, %s, %s, %s
                    ) returning id
                    """,
                    (
                        candidate.company.id,
                        source_id,
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
                        now,
                        now,
                        now,
                        job.published_at,
                        value.content_hash,
                        job.fingerprint_version,
                        value.content_hash,
                        job.fingerprint_version,
                        derivation_hash,
                        job.derivation_version,
                        job.classification_version,
                        run_id,
                        Jsonb(job.raw_payload),
                    ),
                )
                inserted = await cursor.fetchone()
                if inserted is None:
                    raise RuntimeError("JSON-LD job insert returned no ID")
                job_id = UUID(str(inserted["id"]))
                transition = "OPENED"
            else:
                job_id = UUID(str(existing["id"]))
                derivation_changed = (
                    existing["derivation_hash"] != derivation_hash
                    or existing["derivation_version"] != job.derivation_version
                )
                source_hash_recomputed = same_source and (
                    existing["source_content_hash"] != value.content_hash
                    or existing["source_content_version"] != job.fingerprint_version
                )
                transition = (
                    "UNCHANGED"
                    if same_source and existing["closed_at"] is None
                    else ("OPENED" if existing["closed_at"] is not None else "CHANGED")
                )
                await cursor.execute(
                    """
                    update public.jobs set
                      title = %s, description = %s, location = %s,
                      employment_type = %s, role_family = %s, experience_level = %s,
                      is_internship = %s, is_new_grad = %s, season = %s,
                      graduation_years = %s, application_url = %s, source_url = %s,
                      last_seen_at = %s,
                      changed_at = case when %s then changed_at else %s end,
                      published_at = %s, closed_at = null, content_hash = %s,
                      fingerprint_version = %s, source_content_hash = %s,
                      source_content_version = %s, derivation_hash = %s,
                      derivation_version = %s, classification_version = %s,
                      last_seen_run_id = %s, raw_payload = %s
                    where id = %s
                    """,
                    (
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
                        now,
                        same_source,
                        now,
                        job.published_at,
                        value.content_hash,
                        job.fingerprint_version,
                        value.content_hash,
                        job.fingerprint_version,
                        derivation_hash,
                        job.derivation_version,
                        job.classification_version,
                        run_id,
                        Jsonb(job.raw_payload),
                        job_id,
                    ),
                )
                if transition == "UNCHANGED" and (derivation_changed or source_hash_recomputed):
                    await cursor.execute(
                        """
                        insert into public.job_derivation_events (
                          job_id, event_type, previous_derivation_hash, derivation_hash,
                          derivation_version, source_content_hash, reason_code
                        ) values (%s, %s, %s, %s, %s, %s, %s) on conflict do nothing
                        """,
                        (
                            job_id,
                            "DERIVATION_RECOMPUTED"
                            if derivation_changed
                            else "SOURCE_HASH_RECOMPUTED",
                            existing["derivation_hash"],
                            derivation_hash,
                            job.derivation_version,
                            value.content_hash,
                            "CLASSIFIER_OR_PARSER_VERSION_CHANGED"
                            if derivation_changed
                            else "SOURCE_HASH_VERSION_CHANGED",
                        ),
                    )
            if deadline_at is not None:
                await cursor.execute(
                    """
                    delete from public.job_application_deadlines
                    where job_id = %s and source_field = 'validThrough'
                    """,
                    (job_id,),
                )
                await cursor.execute(
                    """
                    insert into public.job_application_deadlines (
                      job_id, deadline_at, source_field, parser_version, evidence_fingerprint
                    ) values (%s, %s, 'validThrough', 1,
                      encode(digest('jsonld-validThrough:' || %s::text || ':' || %s::text,
                        'sha256'), 'hex'))
                    """,
                    (job_id, deadline_at, job_id, deadline_at),
                )
            if transition != "UNCHANGED":
                normalized_payload = job.model_dump(mode="json", exclude={"raw_payload"})
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
                        value.content_hash,
                        job.fingerprint_version,
                        Jsonb(normalized_payload),
                        Jsonb(job.raw_payload),
                        now,
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
                        source_id,
                        run_id,
                        job_id,
                        job.source_url,
                        now,
                        job.published_at,
                        job.description,
                        "\n".join((job.title, job.description, job.location)),
                        value.content_hash,
                        reliability,
                        Jsonb({"provider": "company_jsonld", "schema": "JobPosting"}),
                    ),
                )
                event_type = (
                    RecruitingEventType.JOB_OPENED
                    if transition == "OPENED"
                    else RecruitingEventType.JOB_CHANGED
                )
                event_hash = fingerprint_event(
                    event_type=event_type,
                    company_id=candidate.company.id,
                    source_id=source_id,
                    job_id=job_id,
                    causal_hash=value.content_hash,
                    sequence="jsonld-open" if transition == "OPENED" else value.content_hash,
                )
                await cursor.execute(
                    """
                    insert into public.recruiting_events (
                      company_id, source_id, job_id, event_type, occurred_at,
                      discovered_at, source_url, confidence, fingerprint, payload,
                      public_web_candidate_id
                    ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    on conflict (fingerprint) do nothing
                    """,
                    (
                        candidate.company.id,
                        source_id,
                        job_id,
                        event_type.value,
                        job.published_at or now,
                        now,
                        job.source_url,
                        reliability,
                        event_hash,
                        Jsonb(
                            {
                                "content_hash": value.content_hash,
                                "schema": "JobPosting",
                                "sourceChanged": transition == "CHANGED",
                            }
                        ),
                        candidate.id,
                    ),
                )
                persisted += 1
        return persisted

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
                    # Source postings are not public-web observations. Keep the existing
                    # return contract stable and store only a bounded operational count.
                    json_ld_postings = await self._persist_json_ld_postings(
                        cursor,
                        run_id=run_id,
                        candidate=candidate,
                        document=document,
                    )
                    if json_ld_postings:
                        await cursor.execute(
                            """
                            update public.public_web_runs set metadata = metadata || %s
                            where collector_run_id = %s
                            """,
                            (Jsonb({"jsonLdSourcePostingsProcessed": json_ld_postings}), run_id),
                        )
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
                      events_created = greatest(events_created, %s),
                      recruiter_profiles_created = greatest(recruiter_profiles_created, %s),
                      campus_events_created = greatest(campus_events_created, %s),
                      unresolved_recruiter_references = greatest(
                        unresolved_recruiter_references, %s
                      ),
                      duration_ms = %s,
                      metadata = metadata || %s
                    where collector_run_id = %s
                    """,
                    (
                        stats.candidates,
                        stats.fetched,
                        stats.relevant,
                        stats.observations_created,
                        stats.events_created,
                        stats.recruiter_profiles_created,
                        stats.campus_events_created,
                        stats.unresolved_recruiter_references,
                        stats.duration_ms,
                        Jsonb(
                            {
                                "direct_sources_discovered": stats.direct_sources_discovered,
                                "general_search_skipped": stats.general_search_skipped,
                                "paid_spend_micros": stats.paid_spend_micros,
                            }
                        ),
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

    async def observation_ids_for_request(self, request_id: UUID) -> tuple[UUID, ...]:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select observation.id
                from public.public_web_work_requests request
                join public.public_web_candidates candidate on candidate.id = request.candidate_id
                join public.public_web_documents document on document.candidate_id = candidate.id
                  and document.content_hash = candidate.content_hash
                join public.public_recruiting_observations observation
                  on observation.document_id = document.id
                where request.id = %s
                order by observation.id
                """,
                (request_id,),
            )
            rows = await cursor.fetchall()
        return tuple(UUID(str(row["id"])) for row in rows)

    async def source_ids_for_request(self, request_id: UUID) -> tuple[UUID, ...]:
        """Return the durable source endpoints affected by a completed request.

        Processing a search-discovered company page may promote the candidate from
        the generic search source to a durable company-careers SourceEndpoint.  The
        opportunity resolver must therefore follow the candidate's current source,
        rather than the source captured on the already-claimed WorkItem.
        """
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select distinct candidate.source_id
                from public.public_web_work_requests request
                join public.public_web_candidates candidate
                  on candidate.id = request.candidate_id
                where request.id = %s and candidate.source_id is not null
                order by candidate.source_id
                """,
                (request_id,),
            )
            rows = await cursor.fetchall()
        return tuple(UUID(str(row["source_id"])) for row in rows)

    async def fail_run(
        self, run_id: UUID | None, request: PublicWebWorkRequest, error: Exception
    ) -> None:
        now = datetime.now(UTC)
        blocked = isinstance(
            error, (UnsafeUrlError, RobotsDeniedError, SearchProviderCostBlockedError)
        )
        permanent = isinstance(
            error,
            (SearchProviderAuthRequiredError, SearchProviderPermanentError),
        )
        retry = not blocked and not permanent and request.attempt_count < request.max_attempts
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
                            redact_text(str(error))[:2000],
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
                            redact_text(str(error))[:2000],
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
                        (now, redact_text(str(error))[:2000], request.id),
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
                    rate_limited = isinstance(error, SearchProviderRateLimitedError)
                    provider_retry_after = (
                        error.retry_after_seconds
                        if isinstance(error, SearchProviderRateLimitedError)
                        else None
                    )
                    await connection.execute(
                        """
                        update public.public_web_search_queries set
                          status = %s, last_run_at = %s,
                          next_allowed_run_at = %s
                        where id = %s
                        """,
                        (
                            "RATE_LIMITED" if rate_limited else "FAILED",
                            now,
                            now
                            + timedelta(
                                seconds=(
                                    provider_retry_after
                                    if provider_retry_after is not None
                                    else 300
                                )
                            ),
                            request.search_query_id,
                        ),
                    )
