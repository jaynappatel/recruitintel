from collections.abc import Sequence
from typing import Protocol
from uuid import UUID

from .models import (
    CandidateConfig,
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


class SearchProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def search(self, query: str, *, max_results: int) -> Sequence[SearchResult]: ...


class PublicWebFetcher(Protocol):
    async def fetch(self, url: str) -> FetchedDocument: ...


class ContentExtractor(Protocol):
    def extract(self, document: FetchedDocument) -> ExtractedDocument: ...


class RecruitingRelevanceClassifier(Protocol):
    def classify(self, document: ExtractedDocument) -> RelevanceDecision: ...


class RecruitingInformationExtractor(Protocol):
    def extract(
        self,
        document: ExtractedDocument,
        *,
        assessment: SourceAssessment,
        relevance: RelevanceDecision,
    ) -> Sequence[NormalizedWebObservation]: ...


class LLMRecruitingExtractor(Protocol):
    """Future opt-in interface. Page text is bounded, untrusted data, never instructions."""

    async def extract_bounded_text(
        self, *, content_hash: str, relevant_text: str
    ) -> Sequence[NormalizedWebObservation]: ...


class PublicWebRepository(Protocol):
    async def claim_work_request(self, request_id: UUID) -> PublicWebWorkRequest: ...

    async def get_search_query(self, query_id: UUID) -> SearchQueryConfig: ...

    async def get_candidate(self, candidate_id: UUID) -> CandidateConfig: ...

    async def start_run(self, request: PublicWebWorkRequest, source_id: UUID) -> UUID: ...

    async def persist_search_results(
        self,
        *,
        run_id: UUID,
        request: PublicWebWorkRequest,
        query: SearchQueryConfig,
        results: Sequence[SearchResult],
    ) -> tuple[int, tuple[UUID, ...]]: ...

    async def persist_fetched_document(
        self,
        *,
        run_id: UUID,
        request: PublicWebWorkRequest,
        candidate: CandidateConfig,
        fetched: FetchedDocument,
        extracted: ExtractedDocument,
        content_hash: str,
    ) -> tuple[StoredDocument | None, bool]: ...

    async def get_current_document(self, candidate: CandidateConfig) -> StoredDocument: ...

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
    ) -> tuple[int, int]: ...

    async def complete_run(self, run_id: UUID, stats: WebRunStats) -> None: ...

    async def fail_run(
        self, run_id: UUID | None, request: PublicWebWorkRequest, error: Exception
    ) -> None: ...
