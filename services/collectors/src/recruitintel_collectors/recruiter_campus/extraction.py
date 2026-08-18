import re
from collections.abc import Sequence
from typing import Any
from uuid import UUID

from recruitintel_collectors.public_web.enums import PublicObservationType

from .classification import (
    classify_recruiter_title,
    classify_role_focus,
)
from .enums import (
    CampusEventType,
    RecruiterEvidenceType,
    RecruiterRoleCategory,
    UnresolvedRecruiterReason,
)
from .models import (
    CampusEventCandidate,
    RecruiterCampusExtraction,
    RecruiterCandidate,
    RecruiterObservationInput,
    SchoolReference,
    UnresolvedRecruiterReference,
)
from .normalization import (
    normalize_display_text,
    normalize_person_name,
    normalize_school_name,
    normalize_title,
    split_person_name,
)

_TITLE_PART = (
    r"(?:university recruiter|university recruiting|campus recruiter|campus recruiting|"
    r"early career recruiter|early careers?|early talent|emerging talent|"
    r"university programs?|campus programs?|technical recruiter|technical recruiting|"
    r"talent acquisition partner|university relations|recruiter|talent partner)"
)
_NAME_WORD_PATTERN = r"(?:[A-Z]\.|[A-Z][A-Za-z'\u2019-]+)"
_NAME_PART = rf"(?:{_NAME_WORD_PATTERN}(?:\s+{_NAME_WORD_PATTERN}){{1,3}})"
_NAME_THEN_TITLE = re.compile(
    rf"\b(?P<name>{_NAME_PART})\s*[,\-\u2013\u2014]?\s*"
    rf"(?P<title>(?i:{_TITLE_PART}))\b"
)
_TITLE_THEN_NAME = re.compile(
    rf"\b(?P<title>(?i:{_TITLE_PART}))\s*[,\-\u2013\u2014:]?\s*"
    rf"(?P<name>{_NAME_PART})\b"
)
_PROFILE_URL = re.compile(r"https?://(?:www\.)?linkedin\.com/in/[A-Za-z0-9_%\-]+/?", re.I)

_EVENT_RULES: tuple[tuple[CampusEventType, re.Pattern[str]], ...] = (
    (CampusEventType.CAREER_FAIR, re.compile(r"\b(?:career fair|engineering expo)\b", re.I)),
    (CampusEventType.INFO_SESSION, re.compile(r"\b(?:info(?:rmation)? session)\b", re.I)),
    (CampusEventType.COMPANY_VISIT, re.compile(r"\b(?:company visit|campus visit)\b", re.I)),
    (CampusEventType.TECH_TALK, re.compile(r"\btech(?:nical)? talk\b", re.I)),
    (CampusEventType.COFFEE_CHAT, re.compile(r"\bcoffee chat\b", re.I)),
    (CampusEventType.HACKATHON, re.compile(r"\bhackathon\b", re.I)),
    (
        CampusEventType.INTERVIEW_EVENT,
        re.compile(r"\b(?:interview day|on-campus interview)\b", re.I),
    ),
    (
        CampusEventType.RECRUITING_EVENT,
        re.compile(r"\b(?:recruiting event|recruitment event|networking event)\b", re.I),
    ),
)

_SCHOOL_LIKE = re.compile(
    r"\b(?P<school>(?:[A-Z][A-Za-z&'\u2019.-]*\s+){0,6}"
    r"(?:University|College|Institute|Polytechnic)(?:\s+(?:of|at)\s+"
    r"(?:[A-Z][A-Za-z&'\u2019.-]*\s*){1,4})?)\b"
)


def _metadata_people(metadata: dict[str, Any]) -> list[tuple[str, str, str | None]]:
    result: list[tuple[str, str, str | None]] = []
    structured = metadata.get("structured_metadata")
    values = structured.get("people") if isinstance(structured, dict) else None
    if not isinstance(values, list):
        return result
    for value in values:
        if not isinstance(value, dict):
            continue
        name = value.get("name")
        title = value.get("job_title")
        url = value.get("url")
        if isinstance(name, str) and isinstance(title, str):
            result.append((name, title, url if isinstance(url, str) else None))
    return result


def _school_alias_index(schools: Sequence[SchoolReference]) -> dict[str, set[UUID]]:
    result: dict[str, set[UUID]] = {}
    for school in schools:
        for value in (school.canonical_name, *school.aliases):
            normalized = normalize_school_name(value)
            if normalized:
                result.setdefault(normalized, set()).add(school.id)
    return result


def _resolve_schools(
    text: str,
    schools: Sequence[SchoolReference],
    linked_school_id: UUID | None,
) -> tuple[tuple[UUID, ...], tuple[UnresolvedRecruiterReference, ...]]:
    resolved: set[UUID] = {linked_school_id} if linked_school_id else set()
    unresolved: list[UnresolvedRecruiterReference] = []
    folded = normalize_school_name(text)
    index = _school_alias_index(schools)
    for alias, ids in index.items():
        if re.search(rf"(?:^|\s){re.escape(alias)}(?:$|\s)", folded):
            if len(ids) == 1:
                resolved.update(ids)
            else:
                unresolved.append(
                    UnresolvedRecruiterReference(
                        reason=UnresolvedRecruiterReason.AMBIGUOUS_SCHOOL,
                        raw_school_name=alias,
                        evidence_text=text[:4000],
                    )
                )
    known_normalized = set(index)
    for match in _SCHOOL_LIKE.finditer(text):
        raw = normalize_display_text(match.group("school"))
        normalized_raw = normalize_school_name(raw)
        if normalized_raw in {"university", "college", "institute", "polytechnic"}:
            continue
        if normalized_raw not in known_normalized:
            unresolved.append(
                UnresolvedRecruiterReference(
                    reason=UnresolvedRecruiterReason.UNKNOWN_SCHOOL,
                    raw_school_name=raw,
                    evidence_text=text[:4000],
                )
            )
    deduped = {(item.reason, item.raw_school_name): item for item in unresolved}
    return tuple(sorted(resolved, key=str)), tuple(deduped.values())


def _event_type(text: str, observation_type: str) -> CampusEventType | None:
    for event_type, pattern in _EVENT_RULES:
        if pattern.search(text):
            return event_type
    if observation_type == PublicObservationType.CAREER_FAIR.value:
        return CampusEventType.CAREER_FAIR
    if observation_type == PublicObservationType.CAMPUS_VISIT.value:
        return CampusEventType.COMPANY_VISIT
    return None


class DeterministicRecruiterCampusExtractor:
    def extract(
        self,
        observation: RecruiterObservationInput,
        *,
        schools: Sequence[SchoolReference],
    ) -> RecruiterCampusExtraction:
        text = normalize_display_text(f"{observation.title}. {observation.evidence_text}")
        school_ids, school_unresolved = _resolve_schools(
            text, schools, observation.linked_school_id
        )
        role_families = classify_role_focus(text)
        raw_people = _metadata_people(observation.metadata)
        seen_pairs: set[tuple[str, str]] = set()
        for pattern in (_NAME_THEN_TITLE, _TITLE_THEN_NAME):
            for match in pattern.finditer(text):
                raw_people.append((match.group("name"), match.group("title"), None))

        recruiters: list[RecruiterCandidate] = []
        unresolved: list[UnresolvedRecruiterReference] = list(school_unresolved)
        for raw_name, raw_title, raw_profile_url in raw_people:
            name = normalize_display_text(raw_name).strip(" ,.-")
            name_parts = name.split()
            if len(name_parts) > 2 and name_parts[0].casefold() in {
                "contact",
                "featuring",
                "join",
                "meet",
            }:
                name = " ".join(name_parts[1:])
            title = normalize_display_text(raw_title).strip(" ,.-")
            normalized_name = normalize_person_name(name)
            normalized_recruiter_title = normalize_title(title)
            identity = (normalized_name, normalized_recruiter_title)
            if len(normalized_name.split()) < 2 or identity in seen_pairs:
                continue
            seen_pairs.add(identity)
            categories = classify_recruiter_title(title)
            if categories == (RecruiterRoleCategory.OTHER,):
                unresolved.append(
                    UnresolvedRecruiterReference(
                        reason=UnresolvedRecruiterReason.INSUFFICIENT_EVIDENCE,
                        raw_person_name=name,
                        raw_title=title,
                        evidence_text=observation.evidence_text[:4000],
                    )
                )
                continue
            first_name, last_name = split_person_name(name)
            profile_url = raw_profile_url
            if profile_url is None:
                profile_match = _PROFILE_URL.search(text)
                profile_url = profile_match.group(0) if profile_match else None
            if school_ids:
                evidence_type = RecruiterEvidenceType.SCHOOL_CONNECTION
            elif role_families:
                evidence_type = RecruiterEvidenceType.ROLE_FOCUS
            elif any(
                category
                in {
                    RecruiterRoleCategory.UNIVERSITY_RECRUITING,
                    RecruiterRoleCategory.CAMPUS_PROGRAMS,
                    RecruiterRoleCategory.UNIVERSITY_PROGRAMS,
                }
                for category in categories
            ):
                evidence_type = RecruiterEvidenceType.UNIVERSITY_RECRUITING
            else:
                evidence_type = RecruiterEvidenceType.RECRUITING_ANNOUNCEMENT
            recruiters.append(
                RecruiterCandidate(
                    canonical_name=name,
                    normalized_name=normalized_name,
                    first_name=first_name,
                    last_name=last_name,
                    title=title,
                    normalized_title=normalized_recruiter_title,
                    categories=categories,
                    public_profile_url=profile_url,
                    evidence_type=evidence_type,
                    school_ids=school_ids,
                    role_families=role_families,
                    explicit_company_match=(observation.company_name.casefold() in text.casefold()),
                    metadata={"extraction_rule": "named_recruiter_title_v1"},
                )
            )

        event_type = _event_type(text, str(observation.metadata.get("observation_type", "")))
        campus_events: list[CampusEventCandidate] = []
        if event_type is not None:
            campus_events.append(
                CampusEventCandidate(
                    title=observation.title,
                    event_type=event_type,
                    description=observation.evidence_text[:4000],
                    school_id=school_ids[0] if len(school_ids) == 1 else None,
                    date_start=observation.date_start,
                    date_end=observation.date_end,
                    date_precision=observation.date_precision,
                    date_certainty=observation.date_certainty,
                    is_virtual=bool(re.search(r"\b(?:virtual|online|zoom)\b", text, re.I)),
                    metadata={"extraction_rule": "campus_event_keyword_v1"},
                )
            )

        if not recruiters and re.search(
            r"\b(?:recruiter|recruiting team|talent acquisition)\b", text, re.I
        ):
            unresolved.append(
                UnresolvedRecruiterReference(
                    reason=UnresolvedRecruiterReason.UNKNOWN_PERSON,
                    evidence_text=observation.evidence_text[:4000],
                    metadata={"signal": "recruiter_without_explicit_name_and_title"},
                )
            )
        deduped_unresolved = {
            (item.reason, item.raw_person_name, item.raw_school_name, item.raw_title): item
            for item in unresolved
        }
        return RecruiterCampusExtraction(
            recruiters=tuple(recruiters),
            campus_events=tuple(campus_events),
            unresolved=tuple(deduped_unresolved.values()),
        )
