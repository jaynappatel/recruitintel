import hashlib
import json
from typing import Any
from uuid import UUID

from recruitintel_collectors.domain.enums import RecruitingEventType
from recruitintel_collectors.domain.fingerprints import fingerprint_job
from recruitintel_collectors.domain.models import NormalizedJob

FINGERPRINT_VERSION = 1


def canonical_fingerprint(document: dict[str, Any]) -> str:
    encoded = json.dumps(
        document,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def observation_fingerprint(
    *,
    repository_id: UUID,
    source_path: str,
    commit_sha: str,
    record_type: str,
    company_key: str,
    item_key: str,
    row_number: int | None,
) -> str:
    return canonical_fingerprint(
        {
            "version": FINGERPRINT_VERSION,
            "kind": "GITHUB_OBSERVATION",
            "repository_id": str(repository_id),
            "source_path": source_path,
            "commit_sha": commit_sha,
            "record_type": record_type,
            "company_key": company_key,
            "item_key": item_key,
            "row_number": row_number,
        }
    )


def github_event_fingerprint(
    *,
    event_type: RecruitingEventType,
    company_id: UUID,
    source_id: UUID,
    repository_id: UUID,
    subject_key: str,
    causal_sha: str,
) -> str:
    return canonical_fingerprint(
        {
            "version": FINGERPRINT_VERSION,
            "kind": "RECRUITING_EVENT",
            "event_type": event_type.value,
            "company_id": str(company_id),
            "source_id": str(source_id),
            "repository_id": str(repository_id),
            "subject_key": subject_key,
            "causal_sha": causal_sha,
        }
    )


def github_job_content_fingerprint(job: NormalizedJob) -> str:
    """Hash normalized job content, excluding commit-specific provenance fields."""

    return fingerprint_job(job)
