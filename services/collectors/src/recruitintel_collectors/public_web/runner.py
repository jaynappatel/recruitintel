from datetime import UTC, datetime
from time import monotonic
from uuid import UUID

from .classification import DeterministicRelevanceClassifier, classify_source
from .extraction import DeterministicHtmlExtractor, normalized_content_hash
from .information import DeterministicRecruitingInformationExtractor
from .models import PublicWebWorkRequest, WebRunStats
from .protocols import PublicWebFetcher, PublicWebRepository, SearchProvider


class SearchFrequencyLimitError(RuntimeError):
    pass


class PublicWebWorker:
    def __init__(
        self,
        *,
        repository: PublicWebRepository,
        search_providers: dict[str, SearchProvider],
        fetcher: PublicWebFetcher,
        extractor: DeterministicHtmlExtractor | None = None,
        relevance_classifier: DeterministicRelevanceClassifier | None = None,
        information_extractor: DeterministicRecruitingInformationExtractor | None = None,
    ) -> None:
        self._repository = repository
        self._search_providers = search_providers
        self._fetcher = fetcher
        self._extractor = extractor or DeterministicHtmlExtractor()
        self._relevance = relevance_classifier or DeterministicRelevanceClassifier()
        self._information = information_extractor or DeterministicRecruitingInformationExtractor()

    async def run(self, request_id: UUID) -> WebRunStats:
        started = monotonic()
        request: PublicWebWorkRequest | None = None
        run_id: UUID | None = None
        try:
            request = await self._repository.claim_work_request(request_id)
            if request.work_type.value == "WEB_SEARCH":
                if request.search_query_id is None:
                    raise ValueError("WEB_SEARCH request requires a search query")
                query = await self._repository.get_search_query(request.search_query_id)
                now = datetime.now(UTC)
                if query.next_allowed_run_at and query.next_allowed_run_at > now:
                    raise SearchFrequencyLimitError(
                        f"query cannot run before {query.next_allowed_run_at.isoformat()}"
                    )
                try:
                    provider = self._search_providers[query.provider]
                except KeyError as exc:
                    raise KeyError(f"search provider {query.provider!r} is not configured") from exc
                run_id = await self._repository.start_run(request, query.source_id)
                results = await provider.search(query.query, max_results=query.max_results)
                count, _fetch_ids = await self._repository.persist_search_results(
                    run_id=run_id,
                    request=request,
                    query=query,
                    results=results,
                )
                stats = WebRunStats(
                    request_id=request.id,
                    work_type=request.work_type,
                    candidates=count,
                    duration_ms=int((monotonic() - started) * 1000),
                )
            elif request.work_type.value == "WEB_FETCH":
                if request.candidate_id is None:
                    raise ValueError("WEB_FETCH request requires a candidate")
                candidate = await self._repository.get_candidate(request.candidate_id)
                run_id = await self._repository.start_run(request, candidate.source_id)
                fetched = await self._fetcher.fetch(candidate.canonical_url)
                extracted = self._extractor.extract(fetched)
                content_hash = normalized_content_hash(extracted)
                _document, unchanged = await self._repository.persist_fetched_document(
                    run_id=run_id,
                    request=request,
                    candidate=candidate,
                    fetched=fetched,
                    extracted=extracted,
                    content_hash=content_hash,
                )
                stats = WebRunStats(
                    request_id=request.id,
                    work_type=request.work_type,
                    fetched=1,
                    unchanged=unchanged,
                    duration_ms=int((monotonic() - started) * 1000),
                )
            else:
                if request.candidate_id is None:
                    raise ValueError("WEB_PROCESS request requires a candidate")
                candidate = await self._repository.get_candidate(request.candidate_id)
                run_id = await self._repository.start_run(request, candidate.source_id)
                document = await self._repository.get_current_document(candidate)
                assessment = classify_source(document.extracted.final_url, candidate.company)
                relevance = self._relevance.classify(document.extracted)
                observations = self._information.extract(
                    document.extracted,
                    assessment=assessment,
                    relevance=relevance,
                )
                created, events = await self._repository.persist_processed_document(
                    run_id=run_id,
                    request=request,
                    candidate=candidate,
                    document=document,
                    assessment=assessment,
                    relevance=relevance,
                    observations=observations,
                )
                stats = WebRunStats(
                    request_id=request.id,
                    work_type=request.work_type,
                    relevant=int(relevance.status.value == "RELEVANT"),
                    observations_created=created,
                    events_created=events,
                    duration_ms=int((monotonic() - started) * 1000),
                )
            await self._repository.complete_run(run_id, stats)
            return stats
        except Exception as error:
            if request is not None:
                await self._repository.fail_run(run_id, request, error)
            raise
