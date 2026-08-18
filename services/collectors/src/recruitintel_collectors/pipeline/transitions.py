from datetime import datetime

from recruitintel_collectors.domain.enums import JobTransition


def decide_job_transition(
    *,
    existing_hash: str | None,
    existing_closed_at: datetime | None,
    incoming_hash: str,
) -> JobTransition:
    if existing_hash is None:
        return JobTransition.OPENED
    if existing_closed_at is not None:
        return JobTransition.REOPENED
    if existing_hash == incoming_hash:
        return JobTransition.UNCHANGED
    return JobTransition.CHANGED


def ensure_unique_external_ids(external_ids: list[str]) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for external_id in external_ids:
        if external_id in seen:
            duplicates.add(external_id)
        seen.add(external_id)
    if duplicates:
        joined = ", ".join(sorted(duplicates))
        raise ValueError(f"provider batch contains duplicate external IDs: {joined}")
