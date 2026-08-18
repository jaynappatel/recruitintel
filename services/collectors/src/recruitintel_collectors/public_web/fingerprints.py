import hashlib
import json
import re
from datetime import date
from uuid import UUID

from recruitintel_collectors.domain.enums import RecruitingEventType

from .models import NormalizedWebObservation


def _hash(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


def normalize_evidence(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def candidate_source_key(company_id: UUID, canonical_url: str) -> str:
    return f"{company_id}:{hashlib.sha256(canonical_url.encode()).hexdigest()}"


def observation_fingerprint(
    *,
    company_id: UUID,
    candidate_id: UUID,
    observation: NormalizedWebObservation,
) -> str:
    return _hash(
        {
            "version": 1,
            "company_id": str(company_id),
            "candidate_id": str(candidate_id),
            "type": observation.observation_type.value,
            "claim_subject": observation.claim_subject,
            "evidence": normalize_evidence(observation.evidence_text),
            "date_start": observation.date_start.isoformat() if observation.date_start else None,
            "date_end": observation.date_end.isoformat() if observation.date_end else None,
        }
    )


def claim_fingerprint(*, company_id: UUID, observation_type: str, normalized_subject: str) -> str:
    return _hash(
        {
            "version": 1,
            "company_id": str(company_id),
            "type": observation_type,
            "subject": normalized_subject,
        }
    )


def web_event_fingerprint(
    *,
    company_id: UUID,
    source_id: UUID,
    event_type: RecruitingEventType,
    causal_key: str,
) -> str:
    return _hash(
        {
            "version": 1,
            "company_id": str(company_id),
            "source_id": str(source_id),
            "event_type": event_type.value,
            "causal_key": causal_key,
        }
    )


def date_signature(start: date | None, end: date | None) -> str | None:
    if start is None:
        return None
    return f"{start.isoformat()}:{end.isoformat() if end else ''}"
