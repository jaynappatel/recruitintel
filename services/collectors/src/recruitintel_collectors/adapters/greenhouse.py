from typing import Any
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict, Field

from recruitintel_collectors.domain.classification import CLASSIFICATION_VERSION, classify_job
from recruitintel_collectors.domain.enums import CollectorStage, EmploymentType
from recruitintel_collectors.domain.fingerprints import FINGERPRINT_VERSION
from recruitintel_collectors.domain.models import (
    CollectorTarget,
    FetchedBatch,
    NormalizedJob,
    SourceConfig,
)
from recruitintel_collectors.domain.normalization import html_to_text, normalize_text, normalize_url

from .base import BaseCollector, CollectorError

GREENHOUSE_HOST = "boards-api.greenhouse.io"


class _Location(BaseModel):
    name: str = ""


class _Metadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = ""
    value: Any = None


class _GreenhouseJob(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | int
    title: str = Field(min_length=1)
    absolute_url: str
    content: str = ""
    updated_at: str | None = None
    location: _Location = Field(default_factory=_Location)
    metadata: list[_Metadata] = Field(default_factory=list)


def _employment_type(metadata: list[_Metadata]) -> EmploymentType:
    for item in metadata:
        if item.name.strip().casefold() != "employment type" or not isinstance(item.value, str):
            continue
        value = item.value.casefold()
        if "intern" in value:
            return EmploymentType.INTERNSHIP
        if "part-time" in value or "part time" in value:
            return EmploymentType.PART_TIME
        if "full-time" in value or "full time" in value:
            return EmploymentType.FULL_TIME
        if any(term in value for term in ("contract", "temporary", "seasonal")):
            return EmploymentType.CONTRACT
    return EmploymentType.UNKNOWN


class GreenhouseCollector(BaseCollector):
    provider = "greenhouse"

    async def discover(self, source: SourceConfig) -> tuple[CollectorTarget, ...]:
        if not source.external_key.replace("-", "").replace("_", "").isalnum():
            raise CollectorError(
                "Greenhouse board token contains unsupported characters",
                stage=CollectorStage.DISCOVER,
            )
        url = (
            f"https://{GREENHOUSE_HOST}/v1/boards/"
            f"{quote(source.external_key, safe='')}/jobs?content=true"
        )
        return (
            CollectorTarget(
                source=source,
                url=url,
                allowed_hosts=frozenset({GREENHOUSE_HOST}),
            ),
        )

    async def fetch(self, target: CollectorTarget) -> FetchedBatch:
        try:
            payload = await self.http.get_json(target.url, allowed_hosts=target.allowed_hosts)
        except Exception as exc:
            raise CollectorError(
                f"Greenhouse board fetch failed: {exc}",
                stage=CollectorStage.FETCH,
                retryable=True,
                context={"board": target.source.external_key},
            ) from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
            raise CollectorError(
                "Greenhouse response is missing the jobs array",
                stage=CollectorStage.FETCH,
                context={"board": target.source.external_key},
            )
        return FetchedBatch(items=payload["jobs"], complete=True)

    def normalize(self, item: dict[str, Any], source: SourceConfig) -> NormalizedJob:
        raw = _GreenhouseJob.model_validate(item)
        title = normalize_text(raw.title)
        description = html_to_text(raw.content)
        location = normalize_text(raw.location.name)
        provider_type = _employment_type(raw.metadata)
        classification = classify_job(title, description, provider_type)
        application_url = normalize_url(raw.absolute_url)

        return NormalizedJob(
            external_id=str(raw.id),
            title=title,
            description=description,
            location=location,
            employment_type=classification.employment_type,
            role_family=classification.role_family,
            experience_level=classification.experience_level,
            is_internship=classification.is_internship,
            is_new_grad=classification.is_new_grad,
            season=classification.season,
            graduation_years=classification.graduation_years,
            application_url=application_url,
            source_url=application_url,
            published_at=None,
            fingerprint_version=FINGERPRINT_VERSION,
            classification_version=CLASSIFICATION_VERSION,
            raw_payload=item,
        )
