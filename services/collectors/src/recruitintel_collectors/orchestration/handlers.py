# ruff: noqa: E501
import base64
import hashlib
import os
import re
from collections.abc import Mapping
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from recruitintel_collectors.adapters import GreenhouseCollector, LeverCollector
from recruitintel_collectors.calendar.encryption import AesGcmCredentialCipher
from recruitintel_collectors.calendar.provider import GoogleCalendarProvider, GoogleTokenRefresher
from recruitintel_collectors.calendar.runner import CalendarSyncWorker
from recruitintel_collectors.config import Settings
from recruitintel_collectors.github.client import OfficialGitHubClient
from recruitintel_collectors.github.runner import GitHubSyncRunner
from recruitintel_collectors.infrastructure.calendar_postgres import (
    PostgresCalendarSyncRepository,
)
from recruitintel_collectors.infrastructure.github_postgres import PostgresGitHubSyncRepository
from recruitintel_collectors.infrastructure.http import ProviderHttpClient
from recruitintel_collectors.infrastructure.postgres import PostgresCollectorRepository
from recruitintel_collectors.infrastructure.public_web_postgres import PostgresPublicWebRepository
from recruitintel_collectors.infrastructure.rate_limit import PostgresDistributedRateLimiter
from recruitintel_collectors.infrastructure.recruiter_campus_postgres import (
    PostgresRecruiterCampusRepository,
)
from recruitintel_collectors.infrastructure.search_budget import PostgresSearchUsageBudget
from recruitintel_collectors.opportunities import PostgresOpportunityResolver
from recruitintel_collectors.personalization import PostgresAlertEngine
from recruitintel_collectors.pipeline import CollectorRunner
from recruitintel_collectors.public_web.fetcher import SafePublicWebFetcher
from recruitintel_collectors.public_web.runner import PublicWebWorker
from recruitintel_collectors.public_web.search import (
    SEARXNG_SEARCH_DESCRIPTOR,
    STATIC_SEARCH_DESCRIPTOR,
    JsonFileSearchProvider,
    SearchProvider,
    SearchProviderRegistry,
    SearXNGProvider,
    StaticSearchProvider,
)

from .dispatcher import WorkHandler
from .enums import CoverageStatus, WorkType
from .failures import M11PermanentError
from .models import ClaimedWork, WorkExecutionResult
from .repository import PostgresOrchestrationRepository


class RuntimeWorkHandlers:
    def __init__(
        self, *, settings: Settings, orchestration: PostgresOrchestrationRepository
    ) -> None:
        self._settings = settings
        self._orchestration = orchestration
        self._rate_limiter = PostgresDistributedRateLimiter(orchestration)

    def mapping(self) -> Mapping[WorkType, WorkHandler]:
        return {
            WorkType.ATS_COLLECT: self.ats_collect,
            WorkType.GITHUB_SYNC: self.github_sync,
            WorkType.PUBLIC_WEB_SEARCH: self.public_web,
            WorkType.PUBLIC_WEB_FETCH: self.public_web,
            WorkType.PUBLIC_WEB_PROCESS: self.public_web,
            WorkType.RECRUITER_CAMPUS_PROJECT: self.recruiter_campus,
            WorkType.CALENDAR_SYNC: self.calendar_sync,
            WorkType.PRIVACY_RETENTION_CLEANUP: self.privacy_cleanup,
            WorkType.SOURCE_HEALTH_ROLLUP: self.source_health,
            WorkType.ALERT_FANOUT: self.alert_fanout,
            WorkType.ALERT_EVALUATE: self.alert_evaluate,
            WorkType.RESUME_PARSE: self.resume_parse,
            WorkType.MATCH_MATERIALIZE: self.match_materialize,
        }

    async def resume_parse(self, work: ClaimedWork) -> WorkExecutionResult:
        if work.user_id is None or work.resume_version_id is None:
            raise ValueError("Resume parse work requires an owner and version")
        async with await self._orchestration._connect() as connection:
            cursor = await connection.execute(
                "select media_type,content_hash,storage_ciphertext,storage_nonce from public.m11_claimed_resume_object(%s)",
                (work.id,),
            )
            target = await cursor.fetchone()
            if target is None:
                raise M11PermanentError("Resume version is not owned by work item user")
            if target["storage_ciphertext"] is None or target["storage_nonce"] is None:
                raise M11PermanentError("Resume object is unavailable")
            configured = os.environ.get("RESUME_STORAGE_KEY")
            key = (
                hashlib.sha256(b"recruitintel-m11-local-resume-storage").digest()
                if configured is None
                else (
                    bytes.fromhex(configured)
                    if re.fullmatch(r"[0-9a-fA-F]{64}", configured)
                    else base64.b64decode(configured)
                )
            )
            plaintext = AESGCM(key).decrypt(
                bytes(target["storage_nonce"]),
                bytes(target["storage_ciphertext"]),
                f"{work.user_id}:{target['content_hash']}".encode(),
            )
            text = (
                plaintext.decode("utf-8", errors="replace")
                if target["media_type"] == "text/plain"
                else " ".join(re.findall(r"\(([^()]*)\)\s*Tj", plaintext.decode("latin1")))
            )
            if len(text) > 200_000 or not text.strip():
                raise M11PermanentError("Resume text is unavailable or exceeds bounds")
            skills = {
                skill
                for skill in (
                    "python",
                    "typescript",
                    "javascript",
                    "java",
                    "react",
                    "angular",
                    "pytorch",
                    "aws",
                    "kubernetes",
                    "sql",
                )
                if re.search(rf"(?i)(^|[^a-z0-9+#]){re.escape(skill)}($|[^a-z0-9+#])", text)
            }
            for skill in skills:
                evidence_hash = hashlib.sha256(
                    f"{work.resume_version_id}\0skill\0{skill}".encode()
                ).hexdigest()
                await connection.execute(
                    "insert into public.candidate_evidence (user_id,resume_version_id,evidence_type,normalized_value,source,review_status,section,source_span,evidence_hash) values (%s,%s,'SKILL',jsonb_build_object('skill',%s),'DETERMINISTIC_PARSE','EXTRACTED','skills',%s,%s) on conflict (user_id,evidence_hash) do nothing",
                    (work.user_id, work.resume_version_id, skill, text[:500], evidence_hash),
                )
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            discovered=len(skills),
            processed=1,
            diagnostics={"parserVersion": work.parser_version or 1, "evidenceCount": len(skills)},
        )

    async def match_materialize(self, work: ClaimedWork) -> WorkExecutionResult:
        if work.user_id is None or work.resume_version_id is None or work.opportunity_id is None:
            raise ValueError("Match work requires owner, resume version, and opportunity")
        async with await self._orchestration._connect() as connection:
            cursor = await connection.execute(
                "select 1 from public.resume_versions where id=%s and user_id=%s",
                (work.resume_version_id, work.user_id),
            )
            if await cursor.fetchone() is None:
                raise M11PermanentError("Match resume version is not owned by work item user")
            cursor = await connection.execute(
                "select id from public.job_requirement_sets where opportunity_id=%s order by version desc limit 1",
                (work.opportunity_id,),
            )
            requirement = await cursor.fetchone()
            if requirement is None:
                raise M11PermanentError("Requirement set is unavailable")
            cursor = await connection.execute(
                "select id,evidence_hash,review_version from public.candidate_evidence where user_id=%s and resume_version_id=%s and superseded_at is null and review_status <> 'REJECTED'",
                (work.user_id, work.resume_version_id),
            )
            evidence = await cursor.fetchall()
            digest = hashlib.sha256(
                "|".join(
                    sorted(
                        f"{row['id']}:{row['evidence_hash']}:{row['review_version']}"
                        for row in evidence
                    )
                ).encode()
            ).hexdigest()
            await connection.execute(
                "insert into public.resume_job_matches (user_id,resume_version_id,opportunity_id,requirement_set_id,eligibility,reason_codes,algorithm_version,idempotency_key,evidence_fingerprint) values (%s,%s,%s,%s,'UNKNOWN',ARRAY['WORKER_MATERIALIZED'],%s,%s,%s) on conflict (user_id,resume_version_id,opportunity_id,requirement_set_id,algorithm_version,evidence_fingerprint) do update set generated_at=now()",
                (
                    work.user_id,
                    work.resume_version_id,
                    work.opportunity_id,
                    requirement["id"],
                    work.algorithm_version or "resume-coverage-v1",
                    f"{work.resume_version_id}:{work.opportunity_id}:{requirement['id']}:{digest}",
                    digest,
                ),
            )
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            processed=1,
            diagnostics={"algorithmVersion": work.algorithm_version or "resume-coverage-v1"},
        )

    async def ats_collect(self, work: ClaimedWork) -> WorkExecutionResult:
        if work.source_id is None:
            raise ValueError("ATS work requires source_id")
        repository = PostgresCollectorRepository(
            self._settings.database_url, work_attempt_id=work.attempt_id
        )
        async with ProviderHttpClient(
            user_agent=self._settings.user_agent,
            timeout_seconds=self._settings.timeout_seconds,
            requests_per_second=self._settings.requests_per_second,
            max_response_bytes=self._settings.max_response_bytes,
            distributed_limiter=self._rate_limiter,
        ) as http:
            runner = CollectorRunner(
                repository=repository,
                registry={
                    "greenhouse": GreenhouseCollector(http),
                    "lever": LeverCollector(http),
                },
            )
            stats = await runner.run(work.source_id)
        resolved = await PostgresOpportunityResolver(self._settings.database_url).resolve_source(
            work.source_id
        )
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            discovered=stats.discovered,
            processed=stats.new + stats.changed + stats.unchanged,
            failed=0,
            diagnostics={"opportunityPostingsResolved": resolved},
        )

    async def github_sync(self, work: ClaimedWork) -> WorkExecutionResult:
        if work.github_sync_request_id is None:
            raise ValueError("GitHub work requires a sync request")
        repository_id = await self._orchestration.resolve_github_repository_id(
            work.github_sync_request_id
        )
        repository = PostgresGitHubSyncRepository(
            self._settings.database_url, work_attempt_id=work.attempt_id
        )
        async with OfficialGitHubClient(
            user_agent=self._settings.user_agent,
            token=self._settings.github_token,
            timeout_seconds=self._settings.timeout_seconds,
            requests_per_second=min(self._settings.requests_per_second, 2),
            max_response_bytes=self._settings.max_response_bytes,
            distributed_limiter=self._rate_limiter,
        ) as github:
            stats = await GitHubSyncRunner(
                repository=repository,
                client=github,
                max_concurrency=min(self._settings.max_concurrency, 5),
            ).run(repository_id, request_id=work.github_sync_request_id)
        resolved = (
            await PostgresOpportunityResolver(self._settings.database_url).resolve_source(
                work.source_id
            )
            if work.source_id is not None
            else 0
        )
        return WorkExecutionResult(
            coverage=(CoverageStatus.PARTIAL if stats.errors else CoverageStatus.COMPLETE),
            discovered=stats.records_parsed,
            processed=stats.new + stats.updated + stats.unchanged,
            failed=stats.errors,
            diagnostics={
                "unchangedCommit": stats.skipped_unchanged_sha,
                "opportunityPostingsResolved": resolved,
            },
        )

    async def public_web(self, work: ClaimedWork) -> WorkExecutionResult:
        if work.public_web_work_request_id is None:
            raise ValueError("public-web work requires a request")
        if work.source_id is None:
            raise ValueError("public-web work requires a source")
        source_id = work.source_id
        static_provider: StaticSearchProvider
        if self._settings.public_web_static_results_file:
            static_provider = JsonFileSearchProvider(
                Path(self._settings.public_web_static_results_file)
            )
        else:
            static_provider = StaticSearchProvider({})
        providers: list[SearchProvider] = [static_provider]
        descriptors = [STATIC_SEARCH_DESCRIPTOR]
        searxng: SearXNGProvider | None = None
        if self._settings.searxng_base_url:
            searxng = SearXNGProvider(
                base_url=self._settings.searxng_base_url,
                budget=PostgresSearchUsageBudget(
                    self._settings.database_url,
                    zero_cost_mode=self._settings.zero_cost_mode,
                ),
                user_agent=self._settings.user_agent,
                timeout_seconds=self._settings.timeout_seconds,
                distributed_limiter=self._rate_limiter,
            )
            providers.append(searxng)
            descriptors.append(SEARXNG_SEARCH_DESCRIPTOR)
        search_registry = SearchProviderRegistry(
            providers,
            descriptors,
            zero_cost_mode=self._settings.zero_cost_mode,
        )
        repository = PostgresPublicWebRepository(
            self._settings.database_url, work_attempt_id=work.attempt_id
        )
        try:
            async with SafePublicWebFetcher(
                user_agent=self._settings.user_agent,
                timeout_seconds=self._settings.timeout_seconds,
                max_response_bytes=self._settings.public_web_max_response_bytes,
                requests_per_second=self._settings.public_web_requests_per_second,
                distributed_limiter=self._rate_limiter,
                host_policy_check=lambda hostname, scheme, port: (
                    self._orchestration.assert_source_host_policy(source_id, hostname, scheme, port)
                ),
            ) as fetcher:
                stats = await PublicWebWorker(
                    repository=repository,
                    search_registry=search_registry,
                    fetcher=fetcher,
                    recruiter_campus_processor=None,
                ).run(work.public_web_work_request_id)
        finally:
            if searxng is not None:
                await searxng.aclose()
        if work.work_type is WorkType.PUBLIC_WEB_PROCESS:
            for observation_id in await repository.observation_ids_for_request(
                work.public_web_work_request_id
            ):
                await self._orchestration.enqueue_recruiter_projection(observation_id, parent=work)
            resolver = PostgresOpportunityResolver(self._settings.database_url)
            resolved = 0
            for affected_source_id in await repository.source_ids_for_request(
                work.public_web_work_request_id
            ):
                resolved += await resolver.resolve_source(affected_source_id)
        else:
            resolved = 0
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            discovered=stats.candidates,
            processed=(stats.fetched + stats.observations_created + stats.events_created),
            failed=0,
            diagnostics={
                "unchangedContent": stats.unchanged,
                "providerCalls": stats.provider_calls,
                "costUnits": stats.cost_units,
                "estimatedCostMicros": stats.estimated_cost_micros,
                "paidSpendMicros": stats.paid_spend_micros,
                "directSourcesDiscovered": stats.direct_sources_discovered,
                "generalSearchSkipped": stats.general_search_skipped,
                "opportunityPostingsResolved": resolved,
            },
        )

    async def recruiter_campus(self, work: ClaimedWork) -> WorkExecutionResult:
        if work.recruiting_observation_id is None:
            raise ValueError("recruiter/campus projection requires an observation")
        stats = await PostgresRecruiterCampusRepository(
            self._settings.database_url
        ).process_observation(work.recruiting_observation_id)
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            processed=(
                stats.recruiters_created + stats.campus_events_created + stats.unresolved_created
            ),
        )

    async def calendar_sync(self, work: ClaimedWork) -> WorkExecutionResult:
        if work.calendar_sync_request_id is None:
            raise ValueError("Calendar work requires a sync request")
        if not self._settings.google_client_id or not self._settings.google_client_secret:
            raise ValueError("Google Calendar OAuth client configuration is missing")
        if not self._settings.calendar_token_encryption_key:
            raise ValueError("Calendar token encryption configuration is missing")
        repository = PostgresCalendarSyncRepository(
            self._settings.database_url, work_attempt_id=work.attempt_id
        )
        refresher = GoogleTokenRefresher(
            client_id=self._settings.google_client_id,
            client_secret=self._settings.google_client_secret,
            distributed_limiter=self._rate_limiter,
        )
        try:
            stats = await CalendarSyncWorker(
                repository=repository,
                cipher=AesGcmCredentialCipher(self._settings.calendar_token_encryption_key),
                token_refresher=refresher,
                provider_factory=lambda token: GoogleCalendarProvider(
                    token, distributed_limiter=self._rate_limiter
                ),
                app_url=self._settings.recruitintel_app_url,
            ).run(work.calendar_sync_request_id)
        finally:
            await refresher.aclose()
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            discovered=stats.attempted_items,
            processed=stats.created + stats.updated + stats.deleted + stats.unchanged,
            failed=stats.failed,
        )

    async def privacy_cleanup(self, work: ClaimedWork) -> WorkExecutionResult:
        del work
        deleted = await self._orchestration.privacy_retention_cleanup()
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            processed=deleted,
            diagnostics={"deletedRecords": deleted},
        )

    async def source_health(self, work: ClaimedWork) -> WorkExecutionResult:
        del work
        updated = await self._orchestration.rollup_source_health()
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            processed=updated,
            diagnostics={"updatedSources": updated},
        )

    async def alert_fanout(self, work: ClaimedWork) -> WorkExecutionResult:
        return await PostgresAlertEngine(self._settings.database_url).fanout(work)

    async def alert_evaluate(self, work: ClaimedWork) -> WorkExecutionResult:
        return await PostgresAlertEngine(self._settings.database_url).evaluate(work)
