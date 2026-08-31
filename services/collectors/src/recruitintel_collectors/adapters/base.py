from abc import ABC, abstractmethod
from typing import Any

from recruitintel_collectors.domain.enums import CollectorStage
from recruitintel_collectors.domain.fingerprints import fingerprint_job, fingerprint_job_derivation
from recruitintel_collectors.domain.models import (
    CollectorResult,
    CollectorTarget,
    FetchedBatch,
    FingerprintedJob,
    NormalizedJob,
    SourceConfig,
)
from recruitintel_collectors.infrastructure.http import ProviderHttpClient


class CollectorError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        stage: CollectorStage,
        retryable: bool = False,
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.retryable = retryable
        self.context = context or {}


class BaseCollector(ABC):
    """Provider adapter contract. Database persistence belongs to the runner repository port."""

    provider: str

    def __init__(self, http: ProviderHttpClient) -> None:
        self.http = http

    @abstractmethod
    async def discover(self, source: SourceConfig) -> tuple[CollectorTarget, ...]:
        """Turn a configured source into one or more fixed-host fetch targets."""

    @abstractmethod
    async def fetch(self, target: CollectorTarget) -> FetchedBatch:
        """Fetch one complete target or raise. Partial batches must set complete=False."""

    @abstractmethod
    def normalize(self, item: dict[str, Any], source: SourceConfig) -> NormalizedJob:
        """Map one provider payload into the provider-independent contract."""

    def fingerprint(self, job: NormalizedJob) -> str:
        return fingerprint_job(job)

    async def collect(self, source: SourceConfig) -> CollectorResult:
        if source.provider != self.provider:
            raise CollectorError(
                f"source provider {source.provider!r} does not match {self.provider!r}",
                stage=CollectorStage.DISCOVER,
            )
        targets = await self.discover(source)
        jobs: list[FingerprintedJob] = []
        discovered = 0
        metadata: dict[str, Any] = {"targets": len(targets)}

        for target in targets:
            batch = await self.fetch(target)
            discovered += len(batch.items)
            if not batch.complete:
                return CollectorResult(
                    provider=self.provider,
                    source_id=source.id,
                    jobs=tuple(jobs),
                    discovered=discovered,
                    complete=False,
                    metadata={**metadata, **batch.metadata},
                )
            for index, item in enumerate(batch.items):
                try:
                    job = self.normalize(item, source)
                    jobs.append(
                        FingerprintedJob(
                            job=job,
                            content_hash=self.fingerprint(job),
                            derivation_hash=fingerprint_job_derivation(job),
                        )
                    )
                except CollectorError:
                    raise
                except Exception as exc:
                    raise CollectorError(
                        f"{self.provider} item {index} could not be normalized: {exc}",
                        stage=CollectorStage.NORMALIZE,
                        context={"item_index": index},
                    ) from exc

        return CollectorResult(
            provider=self.provider,
            source_id=source.id,
            jobs=tuple(jobs),
            discovered=discovered,
            complete=True,
            metadata=metadata,
        )
