from typing import Any, Protocol
from uuid import UUID

from recruitintel_collectors.domain.enums import CollectorStage
from recruitintel_collectors.domain.models import CollectorResult, SourceConfig, SyncStats


class CollectorRepository(Protocol):
    async def get_source(self, source_id: UUID) -> SourceConfig: ...

    async def list_sources(self) -> tuple[SourceConfig, ...]: ...

    async def create_run(self, source: SourceConfig, collector: str) -> UUID: ...

    async def persist_complete_batch(
        self,
        *,
        run_id: UUID,
        source: SourceConfig,
        result: CollectorResult,
    ) -> SyncStats: ...

    async def record_error(
        self,
        *,
        run_id: UUID,
        stage: CollectorStage,
        error_type: str,
        message: str,
        retryable: bool,
        context: dict[str, Any],
    ) -> None: ...

    async def fail_run(self, run_id: UUID, *, discovered: int, errors: int = 1) -> None: ...
