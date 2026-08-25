import hashlib
import json
from typing import Any
from uuid import UUID

from .enums import RecruitingEventType
from .models import NormalizedJob

FINGERPRINT_VERSION = 2
DERIVATION_VERSION = 1
EVENT_FINGERPRINT_VERSION = 1


def _canonical_hash(value: dict[str, Any]) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def job_fingerprint_document(job: NormalizedJob) -> dict[str, Any]:
    """Return only provider-derived content.

    Source identity and deterministic classifier output intentionally live outside this
    hash. A parser/rule upgrade therefore cannot manufacture a JOB_CHANGED event.
    """

    return {
        "version": FINGERPRINT_VERSION,
        "title": job.title,
        "description": job.description,
        "location": job.location,
        "application_url": job.application_url,
        "source_url": job.source_url,
        "published_at": job.published_at.isoformat() if job.published_at else None,
    }


def fingerprint_job(job: NormalizedJob) -> str:
    return _canonical_hash(job_fingerprint_document(job))


def job_derivation_document(job: NormalizedJob) -> dict[str, Any]:
    return {
        "version": job.derivation_version,
        "employment_type": job.employment_type.value,
        "role_family": job.role_family.value,
        "experience_level": job.experience_level.value,
        "is_internship": job.is_internship,
        "is_new_grad": job.is_new_grad,
        "season": job.season,
        "graduation_years": list(job.graduation_years),
        "classification_version": job.classification_version,
    }


def fingerprint_job_derivation(job: NormalizedJob) -> str:
    return _canonical_hash(job_derivation_document(job))


def fingerprint_event(
    *,
    event_type: RecruitingEventType,
    company_id: UUID,
    source_id: UUID,
    job_id: UUID,
    causal_hash: str,
    sequence: str,
) -> str:
    return _canonical_hash(
        {
            "version": EVENT_FINGERPRINT_VERSION,
            "event_type": event_type.value,
            "company_id": str(company_id),
            "source_id": str(source_id),
            "subject_type": "JOB",
            "subject_id": str(job_id),
            "causal_hash": causal_hash,
            "sequence": sequence,
        }
    )
