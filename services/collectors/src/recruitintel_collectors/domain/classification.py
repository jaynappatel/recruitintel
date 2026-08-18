import re
from dataclasses import dataclass

from .enums import EmploymentType, ExperienceLevel, RoleFamily
from .normalization import normalize_text

CLASSIFICATION_VERSION = 1


def _matches(value: str, patterns: tuple[str, ...]) -> bool:
    return any(re.search(pattern, value, re.IGNORECASE) for pattern in patterns)


_INTERN = (r"\bintern(?:ship)?\b", r"\bco[ -]?op\b", r"\bplacement student\b")
_NEW_GRAD = (
    r"\bnew grad(?:uate)?\b",
    r"\brecent grad(?:uate)?\b",
    r"\bgraduate (?:software |data |machine learning )?engineer\b",
    r"\bearly career\b",
    r"\bentry[ -]level\b",
    r"\buniversity grad(?:uate)?\b",
)
_LEADERSHIP = (r"\bdirector\b", r"\bhead of\b", r"\bvice president\b", r"\bvp\b")
_SENIOR = (r"\bsenior\b", r"\bstaff\b", r"\bprincipal\b", r"\blead\b", r"\barchitect\b")

_ROLE_RULES: tuple[tuple[RoleFamily, tuple[str, ...]], ...] = (
    (RoleFamily.QUANT, (r"\bquant(?:itative)?\b", r"\btrading engineer\b")),
    (
        RoleFamily.SECURITY,
        (r"\bsecurity\b", r"\bcyber", r"\bapplication security\b", r"\bthreat\b"),
    ),
    (
        RoleFamily.DATA_ENGINEERING,
        (r"\bdata (?:platform |infrastructure )?engineer", r"\banalytics engineer\b"),
    ),
    (
        RoleFamily.DATA_SCIENCE,
        (r"\bdata scien", r"\bdecision scien", r"\bapplied scientist\b"),
    ),
    (
        RoleFamily.AI_ML,
        (
            r"\bmachine learning\b",
            r"\bml engineer",
            r"\bartificial intelligence\b",
            r"\bai engineer",
            r"\bdeep learning\b",
            r"\bnatural language processing\b",
        ),
    ),
    (
        RoleFamily.CLOUD_DEVOPS,
        (
            r"\bdevops\b",
            r"\bsite reliability\b",
            r"\bsre\b",
            r"\bcloud engineer",
            r"\bplatform engineer",
            r"\binfrastructure engineer",
        ),
    ),
    (
        RoleFamily.HARDWARE,
        (
            r"\bhardware\b",
            r"\bfirmware\b",
            r"\belectrical engineer",
            r"\bembedded (?:systems |software )?engineer",
            r"\bsilicon\b",
        ),
    ),
    (
        RoleFamily.DESIGN,
        (r"\bproduct design", r"\bux\b", r"\bui designer", r"\bvisual design", r"\bdesigner\b"),
    ),
    (
        RoleFamily.PRODUCT,
        (r"\bproduct manager", r"\bproduct management", r"\bproduct owner\b", r"\bproduct intern"),
    ),
    (
        RoleFamily.SOFTWARE_ENGINEERING,
        (
            r"\bsoftware\b",
            r"\bdeveloper\b",
            r"\bfrontend\b",
            r"\bfront-end\b",
            r"\bbackend\b",
            r"\bback-end\b",
            r"\bfull[ -]?stack\b",
            r"\bmobile engineer",
            r"\bios engineer",
            r"\bandroid engineer",
        ),
    ),
)


@dataclass(frozen=True, slots=True)
class Classification:
    role_family: RoleFamily
    experience_level: ExperienceLevel
    employment_type: EmploymentType
    is_internship: bool
    is_new_grad: bool
    season: str | None
    graduation_years: tuple[int, ...]


def _role_family(title: str, description: str) -> RoleFamily:
    for family, patterns in _ROLE_RULES:
        if _matches(title, patterns):
            return family
    description_prefix = description[:2_000]
    for family, patterns in _ROLE_RULES:
        if _matches(description_prefix, patterns):
            return family
    return RoleFamily.OTHER


def _season(value: str) -> str | None:
    for season in ("SPRING", "SUMMER", "FALL", "WINTER"):
        if re.search(rf"\b{season}\b", value, re.IGNORECASE):
            return season
    return None


def _graduation_years(value: str) -> tuple[int, ...]:
    patterns = (
        r"(?:class of|graduat(?:e|ing|ion(?: year)?))\D{0,24}(20[2-4]\d)",
        r"(20[2-4]\d)\s+(?:graduate|graduation)",
    )
    years: set[int] = set()
    for pattern in patterns:
        years.update(int(item) for item in re.findall(pattern, value, re.IGNORECASE))
    return tuple(sorted(years))


def classify_job(
    title: str,
    description: str,
    provider_employment_type: EmploymentType = EmploymentType.UNKNOWN,
) -> Classification:
    normalized_title = normalize_text(title)
    normalized_description = normalize_text(description)
    evidence = f"{normalized_title}\n{normalized_description[:4_000]}"
    is_internship = _matches(normalized_title, _INTERN)
    is_new_grad = not is_internship and _matches(normalized_title, _NEW_GRAD)

    if is_internship:
        experience = ExperienceLevel.INTERNSHIP
        employment = (
            EmploymentType.CO_OP
            if _matches(normalized_title, (r"\bco[ -]?op\b",))
            else EmploymentType.INTERNSHIP
        )
    elif is_new_grad:
        experience = ExperienceLevel.ENTRY_LEVEL
        employment = provider_employment_type
    elif _matches(normalized_title, _LEADERSHIP):
        experience = ExperienceLevel.LEADERSHIP
        employment = provider_employment_type
    elif _matches(normalized_title, _SENIOR):
        experience = ExperienceLevel.SENIOR
        employment = provider_employment_type
    else:
        experience = ExperienceLevel.UNKNOWN
        employment = provider_employment_type

    return Classification(
        role_family=_role_family(normalized_title, normalized_description),
        experience_level=experience,
        employment_type=employment,
        is_internship=is_internship,
        is_new_grad=is_new_grad,
        season=_season(evidence),
        graduation_years=_graduation_years(evidence),
    )
