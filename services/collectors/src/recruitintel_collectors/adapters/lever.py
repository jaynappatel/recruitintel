from datetime import UTC, datetime
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

LEVER_HOST = "api.lever.co"
LEVER_EU_HOST = "api.eu.lever.co"


class _LeverCategories(BaseModel):
    model_config = ConfigDict(extra="ignore")

    location: str = ""
    commitment: str = ""


class _LeverList(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str = ""
    content: str = ""


class _LeverJob(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    hosted_url: str = Field(alias="hostedUrl")
    apply_url: str | None = Field(default=None, alias="applyUrl")
    created_at: int | None = Field(default=None, alias="createdAt")
    description: str = ""
    additional: str = ""
    workplace_type: str = Field(default="", alias="workplaceType")
    lists: list[_LeverList] = Field(default_factory=list)
    categories: _LeverCategories = Field(default_factory=_LeverCategories)


def _employment_type(value: str) -> EmploymentType:
    folded = value.casefold()
    if "intern" in folded:
        return EmploymentType.INTERNSHIP
    if "part-time" in folded or "part time" in folded:
        return EmploymentType.PART_TIME
    if "full-time" in folded or "full time" in folded:
        return EmploymentType.FULL_TIME
    if any(term in folded for term in ("contract", "temporary", "seasonal")):
        return EmploymentType.CONTRACT
    return EmploymentType.UNKNOWN


class LeverCollector(BaseCollector):
    provider = "lever"

    async def discover(self, source: SourceConfig) -> tuple[CollectorTarget, ...]:
        if not source.external_key.replace("-", "").replace("_", "").isalnum():
            raise CollectorError(
                "Lever tenant contains unsupported characters",
                stage=CollectorStage.DISCOVER,
            )
        region = str(source.metadata.get("region", "us")).casefold()
        if region not in {"us", "eu"}:
            raise CollectorError(
                "Lever region must be 'us' or 'eu'",
                stage=CollectorStage.DISCOVER,
            )
        host = LEVER_EU_HOST if region == "eu" else LEVER_HOST
        url = f"https://{host}/v0/postings/{quote(source.external_key, safe='')}?mode=json"
        return (CollectorTarget(source=source, url=url, allowed_hosts=frozenset({host})),)

    async def fetch(self, target: CollectorTarget) -> FetchedBatch:
        try:
            payload = await self.http.get_json(target.url, allowed_hosts=target.allowed_hosts)
        except Exception as exc:
            raise CollectorError(
                f"Lever board fetch failed: {exc}",
                stage=CollectorStage.FETCH,
                retryable=True,
                context={"tenant": target.source.external_key},
            ) from exc
        if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
            raise CollectorError(
                "Lever response must be an array of job objects",
                stage=CollectorStage.FETCH,
                context={"tenant": target.source.external_key},
            )
        return FetchedBatch(items=payload, complete=True)

    def normalize(self, item: dict[str, Any], source: SourceConfig) -> NormalizedJob:
        del source
        raw = _LeverJob.model_validate(item)
        body_parts = [raw.description]
        for section in raw.lists:
            body_parts.extend((f"<h3>{section.text}</h3>", section.content))
        body_parts.append(raw.additional)

        title = normalize_text(raw.text)
        description = html_to_text("".join(body_parts))
        location = normalize_text(raw.categories.location)
        if not location and raw.workplace_type.casefold() == "remote":
            location = "Remote"
        classification = classify_job(
            title,
            description,
            _employment_type(raw.categories.commitment),
        )
        source_url = normalize_url(raw.hosted_url)
        application_url = normalize_url(raw.apply_url or raw.hosted_url)
        published_at = (
            datetime.fromtimestamp(raw.created_at / 1000, tz=UTC)
            if raw.created_at is not None
            else None
        )

        return NormalizedJob(
            external_id=raw.id,
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
            source_url=source_url,
            published_at=published_at,
            fingerprint_version=FINGERPRINT_VERSION,
            classification_version=CLASSIFICATION_VERSION,
            raw_payload=item,
        )
