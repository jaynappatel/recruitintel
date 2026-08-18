import hashlib
import json
from uuid import UUID

from recruitintel_collectors.domain.enums import RecruitingEventType, RoleFamily

from .enums import CampusEventType, RecruiterEvidenceType, UnresolvedRecruiterReason


def _hash(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


def recruiter_evidence_fingerprint(
    *,
    profile_id: UUID,
    source_id: UUID,
    observation_id: UUID | None,
    evidence_type: RecruiterEvidenceType,
    content_hash: str,
    school_id: UUID | None,
    role_family: RoleFamily | None,
) -> str:
    return _hash(
        {
            "version": 1,
            "profile_id": str(profile_id),
            "source_id": str(source_id),
            "observation_id": str(observation_id) if observation_id else None,
            "evidence_type": evidence_type.value,
            "content_hash": content_hash,
            "school_id": str(school_id) if school_id else None,
            "role_family": role_family.value if role_family else None,
        }
    )


def campus_event_fingerprint(
    *,
    company_id: UUID,
    event_type: CampusEventType,
    school_id: UUID | None,
    date_key: str | None,
    normalized_title: str,
) -> str:
    return _hash(
        {
            "version": 1,
            "company_id": str(company_id),
            "event_type": event_type.value,
            "school_id": str(school_id) if school_id else None,
            "date": date_key,
            "title": normalized_title,
        }
    )


def unresolved_fingerprint(
    *, observation_id: UUID, reason: UnresolvedRecruiterReason, identity: str
) -> str:
    return _hash(
        {
            "version": 1,
            "observation_id": str(observation_id),
            "reason": reason.value,
            "identity": identity,
        }
    )


def recruiter_event_fingerprint(
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
