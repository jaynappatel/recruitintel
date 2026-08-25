import hashlib
from datetime import UTC, datetime
from typing import Any

from recruitintel_collectors.domain.classification import CLASSIFICATION_VERSION, classify_job
from recruitintel_collectors.domain.enums import EmploymentType
from recruitintel_collectors.domain.fingerprints import fingerprint_job, fingerprint_job_derivation
from recruitintel_collectors.domain.models import FingerprintedJob, NormalizedJob
from recruitintel_collectors.domain.normalization import (
    normalize_company_name,
    normalize_text,
    normalize_url,
)


def _datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _employment(value: object) -> EmploymentType:
    values = [value] if isinstance(value, str) else value if isinstance(value, list) else []
    normalized = {
        normalize_text(item).upper().replace("-", "_").replace(" ", "_")
        for item in values
        if isinstance(item, str)
    }
    aliases = {
        "FULLTIME": EmploymentType.FULL_TIME,
        "FULL_TIME": EmploymentType.FULL_TIME,
        "PARTTIME": EmploymentType.PART_TIME,
        "PART_TIME": EmploymentType.PART_TIME,
        "CONTRACTOR": EmploymentType.CONTRACT,
        "CONTRACT": EmploymentType.CONTRACT,
        "TEMPORARY": EmploymentType.TEMPORARY,
        "INTERN": EmploymentType.INTERNSHIP,
        "INTERNSHIP": EmploymentType.INTERNSHIP,
    }
    return next((aliases[item] for item in normalized if item in aliases), EmploymentType.UNKNOWN)


def normalize_json_ld_job_posting(
    value: dict[str, Any],
    *,
    company_id: str,
    company_names: frozenset[str],
    document_url: str,
) -> tuple[FingerprintedJob, datetime | None] | None:
    organization = value.get("hiring_organization_name")
    if isinstance(organization, str) and normalize_company_name(organization) not in company_names:
        return None
    title = normalize_text(value.get("title") if isinstance(value.get("title"), str) else "")
    if not title:
        return None
    description_parts: list[str] = []
    for key in (
        "description",
        "qualifications",
        "education_requirements",
        "experience_requirements",
        "skills_text",
    ):
        part = value.get(key)
        if isinstance(part, str):
            description_parts.append(part)
    description = normalize_text("\n".join(description_parts))[:100_000]
    raw_application_url = value.get("url")
    application_value: str = (
        raw_application_url if isinstance(raw_application_url, str) else document_url
    )
    try:
        application_url = normalize_url(application_value)
        source_url = normalize_url(document_url)
    except ValueError:
        return None
    identifier = value.get("identifier") if isinstance(value.get("identifier"), str) else None
    external_material = identifier or f"{company_id}\x1f{application_url}\x1f{title.casefold()}"
    external_id = f"jsonld:{hashlib.sha256(external_material.encode()).hexdigest()}"
    location_value = value.get("location")
    location = normalize_text(location_value if isinstance(location_value, str) else "")
    if value.get("job_location_type") == "TELECOMMUTE":
        remote_region = value.get("applicant_location_requirements")
        suffix = f" - {normalize_text(remote_region)}" if isinstance(remote_region, str) else ""
        location = f"Remote{suffix}"
    provider_employment = _employment(value.get("employment_type"))
    classification = classify_job(title, description, provider_employment)
    published_at = _datetime(value.get("date_posted"))
    deadline_at = _datetime(value.get("valid_through"))
    job = NormalizedJob(
        external_id=external_id,
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
        classification_version=CLASSIFICATION_VERSION,
        raw_payload={"schema": "JobPosting", **value},
    )
    return (
        FingerprintedJob(
            job=job,
            content_hash=fingerprint_job(job),
            derivation_hash=fingerprint_job_derivation(job),
        ),
        deadline_at,
    )
