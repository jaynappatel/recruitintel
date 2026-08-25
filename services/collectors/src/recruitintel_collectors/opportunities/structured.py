import hashlib
import json
import re
from dataclasses import asdict, dataclass
from typing import Any

from recruitintel_collectors.domain.normalization import normalize_text

STRUCTURED_PARSER_VERSION = 1

_SKILLS: dict[str, tuple[str, ...]] = {
    "JavaScript": ("javascript", "js"),
    "TypeScript": ("typescript", "ts"),
    "PostgreSQL": ("postgresql", "postgres"),
    "React": ("react", "react.js"),
    "Python": ("python",),
    "Java": ("java",),
    "C++": ("c++", "cpp"),
    "SQL": ("sql",),
    "AWS": ("aws", "amazon web services"),
}
_US_STATE = re.compile(r"^(?P<city>[^,]{1,100}),\s*(?P<region>[A-Z]{2})$")
_YEARS = re.compile(
    r"\b(?P<minimum>\d{1,2})(?:\s*[-\u2013]\s*(?P<maximum>\d{1,2}))?\+?\s+years?\b",
    re.I,
)
_SPONSORSHIP_AVAILABLE = re.compile(
    r"\b(?:visa\s+)?sponsorship\s+(?:is\s+)?available\b|\bwe\s+(?:offer|provide)\s+(?:visa\s+)?sponsorship\b",
    re.I,
)
_SPONSORSHIP_UNAVAILABLE = re.compile(
    r"\b(?:unable|not able)\s+to\s+sponsor\b|"
    r"\b(?:do|does)\s+not\s+(?:offer\s+)?sponsor(?:ship)?\b|"
    r"\bno\s+(?:visa\s+)?sponsorship\b",
    re.I,
)
_CITIZENSHIP = re.compile(
    r"\b(?:u\.?s\.?|united states)\s+citizenship\s+(?:is\s+)?required\b", re.I
)
_WORK_AUTH = re.compile(
    r"\bmust\s+be\s+authorized\s+to\s+work\s+in\s+the\s+u\.?s\.?\b|"
    r"\b(?:u\.?s\.?\s+)?work\s+authorization\s+(?:is\s+)?required\b",
    re.I,
)


def _fingerprint(kind: str, evidence: str, value: object) -> str:
    encoded = json.dumps(
        {"version": STRUCTURED_PARSER_VERSION, "kind": kind, "evidence": evidence, "value": value},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class LocationFact:
    raw: str
    city: str | None
    region: str | None
    country_code: str | None
    remote_region: str | None
    workplace_mode: str
    fingerprint: str


@dataclass(frozen=True, slots=True)
class SkillFact:
    canonical_name: str | None
    raw: str
    requirement: str
    fingerprint: str


@dataclass(frozen=True, slots=True)
class RequirementFact:
    requirement_type: str
    value: dict[str, Any]
    evidence: str
    fingerprint: str


@dataclass(frozen=True, slots=True)
class ConstraintFact:
    constraint_type: str
    value: dict[str, Any]
    evidence: str
    fingerprint: str


@dataclass(frozen=True, slots=True)
class StructuredJobFacts:
    locations: tuple[LocationFact, ...]
    skills: tuple[SkillFact, ...]
    requirements: tuple[RequirementFact, ...]
    constraints: tuple[ConstraintFact, ...]
    derivation_hash: str


def _location_facts(raw_location: str) -> tuple[LocationFact, ...]:
    parts = [
        normalize_text(item) for item in re.split(r"[;|]", raw_location) if normalize_text(item)
    ]
    facts: list[LocationFact] = []
    for part in parts[:20]:
        folded = part.casefold()
        mode = "UNKNOWN"
        if "hybrid" in folded:
            mode = "HYBRID"
        elif "remote" in folded:
            mode = "REMOTE"
        elif part:
            mode = "ONSITE"
        location_without_mode = re.sub(r"\b(?:remote|hybrid|onsite)\b", "", part, flags=re.I)
        location_without_mode = normalize_text(location_without_mode.strip(" -(),"))
        match = _US_STATE.fullmatch(location_without_mode)
        city = match.group("city") if match else None
        region = match.group("region") if match else None
        country = "US" if match else None
        remote_region = location_without_mode or None if mode == "REMOTE" else None
        value = {
            "city": city,
            "region": region,
            "country": country,
            "remoteRegion": remote_region,
            "mode": mode,
        }
        facts.append(
            LocationFact(
                raw=part,
                city=city,
                region=region,
                country_code=country,
                remote_region=remote_region,
                workplace_mode=mode,
                fingerprint=_fingerprint("LOCATION", part, value),
            )
        )
    return tuple(facts)


def _skill_facts(description: str, raw_payload: dict[str, Any]) -> tuple[SkillFact, ...]:
    folded = description.casefold()
    values: dict[tuple[str | None, str], SkillFact] = {}
    for canonical, aliases in _SKILLS.items():
        for alias in aliases:
            pattern = rf"(?<![\w+#]){re.escape(alias)}(?![\w+#])"
            if re.search(pattern, folded, re.I):
                requirement = "REQUIRED" if "required" in folded else "MENTIONED"
                evidence = alias
                fact = SkillFact(
                    canonical_name=canonical,
                    raw=alias,
                    requirement=requirement,
                    fingerprint=_fingerprint(
                        "SKILL",
                        evidence,
                        {"canonical": canonical, "requirement": requirement},
                    ),
                )
                values[(canonical, alias)] = fact
                break
    raw_skills = raw_payload.get("skills")
    if isinstance(raw_skills, list):
        for item in raw_skills[:50]:
            if not isinstance(item, str):
                continue
            raw = normalize_text(item)[:200]
            if not raw:
                continue
            matched_canonical: str | None = next(
                (
                    name
                    for name, aliases in _SKILLS.items()
                    if raw.casefold() in {name.casefold(), *aliases}
                ),
                None,
            )
            values[(matched_canonical, raw.casefold())] = SkillFact(
                canonical_name=matched_canonical,
                raw=raw,
                requirement="MENTIONED",
                fingerprint=_fingerprint(
                    "SKILL",
                    raw,
                    {"canonical": matched_canonical, "requirement": "MENTIONED"},
                ),
            )
    return tuple(
        sorted(values.values(), key=lambda value: (value.canonical_name or "~", value.raw))
    )


def derive_structured_job_facts(
    *,
    description: str,
    location: str,
    graduation_years: tuple[int, ...],
    raw_payload: dict[str, Any],
) -> StructuredJobFacts:
    normalized = normalize_text(description)
    requirements: list[RequirementFact] = []
    constraints: list[ConstraintFact] = []
    for match in _YEARS.finditer(normalized):
        evidence = match.group(0)
        requirement_value: dict[str, Any] = {
            "minimum": int(match.group("minimum")),
            "maximum": int(match.group("maximum")) if match.group("maximum") else None,
        }
        requirements.append(
            RequirementFact(
                "YEARS_EXPERIENCE",
                requirement_value,
                evidence,
                _fingerprint("YEARS_EXPERIENCE", evidence, requirement_value),
            )
        )
    if graduation_years:
        evidence = ",".join(str(year) for year in graduation_years)
        graduation_value: dict[str, Any] = {"years": list(graduation_years)}
        constraints.append(
            ConstraintFact(
                "GRADUATION_ELIGIBILITY",
                graduation_value,
                evidence,
                _fingerprint("GRADUATION_ELIGIBILITY", evidence, graduation_value),
            )
        )
    explicit_patterns = (
        ("SPONSORSHIP_UNAVAILABLE", _SPONSORSHIP_UNAVAILABLE),
        ("SPONSORSHIP_AVAILABLE", _SPONSORSHIP_AVAILABLE),
        ("CITIZENSHIP_REQUIRED", _CITIZENSHIP),
        ("WORK_AUTHORIZATION_REQUIRED", _WORK_AUTH),
    )
    for constraint_type, pattern in explicit_patterns:
        constraint_match = pattern.search(normalized)
        if constraint_match:
            evidence = constraint_match.group(0)
            constraint_value: dict[str, Any] = {"explicit": True}
            constraints.append(
                ConstraintFact(
                    constraint_type,
                    constraint_value,
                    evidence,
                    _fingerprint(constraint_type, evidence, constraint_value),
                )
            )
    locations = _location_facts(location)
    skills = _skill_facts(normalized, raw_payload)
    payload = {
        "version": STRUCTURED_PARSER_VERSION,
        "locations": [asdict(item) for item in locations],
        "skills": [asdict(item) for item in skills],
        "requirements": [asdict(item) for item in requirements],
        "constraints": [asdict(item) for item in constraints],
    }
    derivation_hash = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()
    return StructuredJobFacts(
        locations=locations,
        skills=skills,
        requirements=tuple(requirements),
        constraints=tuple(constraints),
        derivation_hash=derivation_hash,
    )
