from collections.abc import Sequence
from typing import Protocol
from uuid import UUID

from .models import (
    RecruiterCampusExtraction,
    RecruiterCampusRunStats,
    RecruiterObservationInput,
    SchoolReference,
)


class RecruiterCampusExtractor(Protocol):
    def extract(
        self,
        observation: RecruiterObservationInput,
        *,
        schools: Sequence[SchoolReference],
    ) -> RecruiterCampusExtraction: ...


class LLMRecruiterCampusExtractor(Protocol):
    """Future opt-in boundary; bounded evidence is untrusted data, never instructions."""

    async def extract_bounded_evidence(
        self, *, content_hash: str, evidence_text: str
    ) -> RecruiterCampusExtraction: ...


class RecruiterCampusObservationProcessor(Protocol):
    async def process_document(self, document_id: UUID) -> RecruiterCampusRunStats: ...

    async def process_observation(self, observation_id: UUID) -> RecruiterCampusRunStats: ...
