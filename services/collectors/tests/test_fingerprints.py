from typing import Any, cast
from uuid import UUID

from recruitintel_collectors.adapters.greenhouse import GreenhouseCollector
from recruitintel_collectors.domain.enums import RecruitingEventType
from recruitintel_collectors.domain.fingerprints import fingerprint_event, fingerprint_job
from recruitintel_collectors.domain.models import SourceConfig
from recruitintel_collectors.infrastructure.http import ProviderHttpClient


def test_job_fingerprint_is_stable_after_provider_normalization(
    source: SourceConfig,
    load_fixture: Any,
) -> None:
    payload = load_fixture("greenhouse_jobs.json")
    first = payload["jobs"][0]
    second = {**first, "title": "\n Software   Engineering Intern — Summer 2027\t"}
    second["content"] = "<p>Build reliable systems &amp; APIs.</p><p>Class of 2027.</p>"

    collector = GreenhouseCollector(cast(ProviderHttpClient, object()))
    assert fingerprint_job(collector.normalize(first, source)) == fingerprint_job(
        collector.normalize(second, source)
    )


def test_meaningful_job_change_changes_fingerprint(source: SourceConfig, load_fixture: Any) -> None:
    payload = load_fixture("greenhouse_jobs.json")
    first = payload["jobs"][0]
    second = {**first, "location": {"name": "Chicago, IL"}}
    collector = GreenhouseCollector(cast(ProviderHttpClient, object()))
    assert fingerprint_job(collector.normalize(first, source)) != fingerprint_job(
        collector.normalize(second, source)
    )


def test_event_fingerprint_is_deterministic_and_causal() -> None:
    arguments = {
        "event_type": RecruitingEventType.JOB_CHANGED,
        "company_id": UUID("10000000-0000-0000-0000-000000000001"),
        "source_id": UUID("20000000-0000-0000-0000-000000000001"),
        "job_id": UUID("40000000-0000-0000-0000-000000000001"),
        "causal_hash": "a" * 64,
        "sequence": "a" * 64,
    }
    first = fingerprint_event(**arguments)  # type: ignore[arg-type]
    second = fingerprint_event(**arguments)  # type: ignore[arg-type]
    changed = fingerprint_event(**{**arguments, "causal_hash": "b" * 64})  # type: ignore[arg-type]
    assert first == second
    assert first != changed
