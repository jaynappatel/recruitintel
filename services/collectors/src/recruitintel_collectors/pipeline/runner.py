import logging
from uuid import UUID

from recruitintel_collectors.adapters.base import BaseCollector, CollectorError
from recruitintel_collectors.domain.enums import CollectorStage
from recruitintel_collectors.domain.models import SyncStats
from recruitintel_collectors.redaction import redact_text, redact_value

from .repository import CollectorRepository

logger = logging.getLogger(__name__)


class CollectorRunner:
    def __init__(
        self,
        *,
        repository: CollectorRepository,
        registry: dict[str, BaseCollector],
    ) -> None:
        self.repository = repository
        self.registry = registry

    async def run(self, source_id: UUID) -> SyncStats:
        source = await self.repository.get_source(source_id)
        collector = self.registry.get(source.provider)
        if collector is None:
            raise ValueError(f"no collector is registered for provider {source.provider!r}")

        run_id = await self.repository.create_run(source, collector.provider)
        discovered = 0
        try:
            result = await collector.collect(source)
            discovered = result.discovered
            if not result.complete:
                raise CollectorError(
                    "collector returned an incomplete batch; refusing closure-capable persistence",
                    stage=CollectorStage.FETCH,
                    retryable=True,
                    context={"discovered": result.discovered},
                )
            stats = await self.repository.persist_complete_batch(
                run_id=run_id,
                source=source,
                result=result,
            )
            logger.info(
                "collector_run_succeeded",
                extra={
                    "run_id": str(run_id),
                    "source_id": str(source.id),
                    "provider": source.provider,
                    **stats.model_dump(),
                },
            )
            return stats
        except Exception as exc:
            stage = exc.stage if isinstance(exc, CollectorError) else CollectorStage.PERSIST
            retryable = exc.retryable if isinstance(exc, CollectorError) else False
            context = exc.context if isinstance(exc, CollectorError) else {}
            try:
                await self.repository.record_error(
                    run_id=run_id,
                    stage=stage,
                    error_type=type(exc).__name__,
                    message=redact_text(str(exc)),
                    retryable=retryable,
                    context=redact_value(context),
                )
                await self.repository.fail_run(run_id, discovered=discovered)
            except Exception:
                logger.exception(
                    "collector_run_error_recording_failed",
                    extra={"run_id": str(run_id), "source_id": str(source.id)},
                )
            raise
