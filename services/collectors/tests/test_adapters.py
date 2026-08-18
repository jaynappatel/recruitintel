from typing import Any

import httpx
import pytest
from recruitintel_collectors.adapters.greenhouse import GreenhouseCollector
from recruitintel_collectors.adapters.lever import LeverCollector
from recruitintel_collectors.domain.enums import EmploymentType, ExperienceLevel, RoleFamily
from recruitintel_collectors.domain.models import SourceConfig
from recruitintel_collectors.infrastructure.http import ProviderHttpClient


async def _no_sleep(_: float) -> None:
    return None


def _client(payload: Any) -> ProviderHttpClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload, request=request)

    return ProviderHttpClient(
        user_agent="RecruitIntel tests",
        requests_per_second=100_000,
        transport=httpx.MockTransport(handler),
        sleep=_no_sleep,
    )


@pytest.mark.asyncio
async def test_greenhouse_collects_and_normalizes_fixture(
    source: SourceConfig,
    load_fixture: Any,
) -> None:
    async with _client(load_fixture("greenhouse_jobs.json")) as http:
        result = await GreenhouseCollector(http).collect(source)

    assert result.complete is True
    assert result.discovered == 1
    normalized = result.jobs[0].job
    assert normalized.external_id == "123456"
    assert normalized.title == "Software Engineering Intern — Summer 2027"
    assert normalized.description == "Build reliable systems & APIs. Class of 2027."
    assert "ignore" not in normalized.description
    assert normalized.location == "New York, NY"
    assert normalized.role_family is RoleFamily.SOFTWARE_ENGINEERING
    assert normalized.experience_level is ExperienceLevel.INTERNSHIP
    assert normalized.employment_type is EmploymentType.INTERNSHIP
    assert normalized.graduation_years == (2027,)
    assert "utm_source" not in normalized.application_url
    assert "gh_jid=123456" in normalized.application_url
    assert len(result.jobs[0].content_hash) == 64


@pytest.mark.asyncio
async def test_lever_collects_and_normalizes_fixture(
    source: SourceConfig,
    load_fixture: Any,
) -> None:
    lever_source = source.model_copy(
        update={"provider": "lever", "name": "Acme Lever", "metadata": {"region": "us"}}
    )
    async with _client(load_fixture("lever_jobs.json")) as http:
        result = await LeverCollector(http).collect(lever_source)

    normalized = result.jobs[0].job
    assert normalized.external_id == "lever-abc-123"
    assert normalized.description == (
        "Build production ML systems. What you will do Ship models Early career program."
    )
    assert normalized.role_family is RoleFamily.AI_ML
    assert normalized.is_new_grad is True
    assert normalized.experience_level is ExperienceLevel.ENTRY_LEVEL
    assert normalized.employment_type is EmploymentType.FULL_TIME
    assert normalized.published_at is not None
    assert normalized.published_at.isoformat() == "2026-08-15T16:00:00+00:00"


@pytest.mark.asyncio
async def test_lever_eu_region_selects_eu_host(source: SourceConfig) -> None:
    lever_source = source.model_copy(update={"provider": "lever", "metadata": {"region": "eu"}})
    async with _client([]) as http:
        target = (await LeverCollector(http).discover(lever_source))[0]
    assert target.url.startswith("https://api.eu.lever.co/")
