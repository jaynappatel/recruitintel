import re
from datetime import UTC, datetime

from recruitintel_collectors.domain.enums import RoleFamily
from recruitintel_collectors.public_web.enums import ReliabilityLevel

from .enums import FreshnessStatus, RecruiterRoleCategory, RelationshipStrength
from .models import (
    FreshnessDecision,
    RelationshipStrengthDecision,
    RelationshipStrengthInput,
)

_TITLE_RULES: tuple[tuple[RecruiterRoleCategory, re.Pattern[str]], ...] = (
    (
        RecruiterRoleCategory.UNIVERSITY_RECRUITING,
        re.compile(r"\b(?:university recruit(?:er|ing)|university relations)\b", re.I),
    ),
    (
        RecruiterRoleCategory.EARLY_CAREER,
        re.compile(r"\b(?:early career(?:s)?|early talent)\b", re.I),
    ),
    (
        RecruiterRoleCategory.TECHNICAL_RECRUITING,
        re.compile(r"\btechnical recruit(?:er|ing)\b", re.I),
    ),
    (
        RecruiterRoleCategory.TALENT_ACQUISITION,
        re.compile(r"\btalent acquisition(?: partner)?\b", re.I),
    ),
    (
        RecruiterRoleCategory.CAMPUS_PROGRAMS,
        re.compile(r"\b(?:campus recruit(?:er|ing)|campus programs?)\b", re.I),
    ),
    (
        RecruiterRoleCategory.UNIVERSITY_PROGRAMS,
        re.compile(r"\buniversity programs?\b", re.I),
    ),
    (
        RecruiterRoleCategory.EMERGING_TALENT,
        re.compile(r"\bemerging talent\b", re.I),
    ),
    (
        RecruiterRoleCategory.GENERAL_RECRUITING,
        re.compile(r"\b(?:recruiter|recruiting|talent partner)\b", re.I),
    ),
)

_ROLE_RULES: tuple[tuple[RoleFamily, re.Pattern[str]], ...] = (
    (RoleFamily.QUANT, re.compile(r"\b(?:quant|quantitative|trading)\b", re.I)),
    (RoleFamily.SECURITY, re.compile(r"\b(?:security|cyber)\b", re.I)),
    (
        RoleFamily.DATA_ENGINEERING,
        re.compile(r"\b(?:data engineering|data engineer|analytics engineer)\b", re.I),
    ),
    (
        RoleFamily.DATA_SCIENCE,
        re.compile(r"\b(?:data science|data scientist|applied scientist)\b", re.I),
    ),
    (
        RoleFamily.AI_ML,
        re.compile(r"\b(?:machine learning|artificial intelligence|AI/ML|ML engineer)\b", re.I),
    ),
    (
        RoleFamily.CLOUD_DEVOPS,
        re.compile(r"\b(?:cloud|devops|site reliability|infrastructure)\b", re.I),
    ),
    (RoleFamily.HARDWARE, re.compile(r"\b(?:hardware|firmware|silicon|embedded)\b", re.I)),
    (RoleFamily.DESIGN, re.compile(r"\b(?:design|designer|UX|UI)\b", re.I)),
    (
        RoleFamily.PRODUCT,
        re.compile(r"\b(?:product management|product manager|product roles?)\b", re.I),
    ),
    (
        RoleFamily.SOFTWARE_ENGINEERING,
        re.compile(
            r"\b(?:software engineering|software engineer|developer|engineering roles?)\b",
            re.I,
        ),
    ),
)


def classify_recruiter_title(title: str) -> tuple[RecruiterRoleCategory, ...]:
    matched = tuple(category for category, pattern in _TITLE_RULES if pattern.search(title))
    if not matched:
        return (RecruiterRoleCategory.OTHER,)
    if len(matched) > 1 and RecruiterRoleCategory.GENERAL_RECRUITING in matched:
        matched = tuple(
            category
            for category in matched
            if category is not RecruiterRoleCategory.GENERAL_RECRUITING
        )
    return matched


def classify_role_focus(value: str) -> tuple[RoleFamily, ...]:
    return tuple(family for family, pattern in _ROLE_RULES if pattern.search(value))


def classify_freshness(
    last_verified_at: datetime | None, *, as_of: datetime | None = None
) -> FreshnessDecision:
    if last_verified_at is None:
        return FreshnessDecision(status=FreshnessStatus.UNKNOWN)
    now = as_of or datetime.now(UTC)
    observed = (
        last_verified_at.replace(tzinfo=UTC)
        if last_verified_at.tzinfo is None
        else last_verified_at.astimezone(UTC)
    )
    age_days = max(0, (now.astimezone(UTC) - observed).days)
    if age_days <= 90:
        status = FreshnessStatus.CURRENT
    elif age_days <= 180:
        status = FreshnessStatus.AGING
    else:
        status = FreshnessStatus.STALE
    return FreshnessDecision(status=status, age_days=age_days)


def classify_relationship_strength(
    value: RelationshipStrengthInput, *, as_of: datetime | None = None
) -> RelationshipStrengthDecision:
    points = 0
    reasons: list[str] = []
    reliability_points = {
        ReliabilityLevel.OFFICIAL: 3,
        ReliabilityLevel.HIGH: 2,
        ReliabilityLevel.MEDIUM: 1,
        ReliabilityLevel.LOW: 0,
        ReliabilityLevel.UNKNOWN: 0,
    }[value.reliability]
    points += reliability_points
    reasons.append(f"source_reliability:{value.reliability.value.casefold()}")
    if value.independent_source_count >= 3:
        points += 3
        reasons.append("three_or_more_independent_sources")
    elif value.independent_source_count == 2:
        points += 2
        reasons.append("two_independent_sources")
    else:
        reasons.append("single_source")
    if value.explicit_relationship:
        points += 2
        reasons.append("explicit_relationship_mention")
    if value.title_match:
        points += 1
        reasons.append("recruiting_title_match")
    freshness = classify_freshness(value.last_observed_at, as_of=as_of)
    if freshness.status is FreshnessStatus.CURRENT:
        points += 1
        reasons.append("verified_within_90_days")
    elif freshness.status is FreshnessStatus.STALE:
        reasons.append("evidence_older_than_180_days")
    if points >= 7:
        strength = RelationshipStrength.HIGH
    elif points >= 5:
        strength = RelationshipStrength.MEDIUM
    elif points >= 3:
        strength = RelationshipStrength.LOW
    else:
        strength = RelationshipStrength.LIMITED_EVIDENCE
    return RelationshipStrengthDecision(strength=strength, reasons=tuple(reasons))
