from recruitintel_collectors.domain.enums import RoleFamily

from .models import SearchContext, SearchQuerySpec

_ROLE_LABELS: dict[RoleFamily, str] = {
    RoleFamily.SOFTWARE_ENGINEERING: "software engineering",
    RoleFamily.AI_ML: "machine learning",
    RoleFamily.DATA_SCIENCE: "data science",
    RoleFamily.DATA_ENGINEERING: "data engineering",
    RoleFamily.PRODUCT: "product",
    RoleFamily.DESIGN: "design",
    RoleFamily.SECURITY: "security",
    RoleFamily.CLOUD_DEVOPS: "cloud devops",
    RoleFamily.QUANT: "quantitative",
    RoleFamily.HARDWARE: "hardware",
    RoleFamily.OTHER: "early career",
}


def generate_search_queries(context: SearchContext) -> tuple[SearchQuerySpec, ...]:
    company = f'"{context.company.canonical_name}"'
    role = (
        _ROLE_LABELS.get(context.role_family, "software engineering")
        if context.role_family is not None
        else "software engineering"
    )
    year = str(context.graduation_year) if context.graduation_year else ""
    templates: list[tuple[str, str]] = [
        ("early-career", f"{company} early career"),
        ("university-recruiting", f"{company} university recruiting"),
        ("application-deadline", f"{company} application deadline"),
        ("interview-experience", f"{company} internship interview experience"),
        ("role", f"{company} {role} early career"),
    ]
    if context.focus in {"INTERNSHIP", "BOTH"}:
        suffix = f" {year}" if year else ""
        templates.extend(
            (
                ("internship", f"{company} internship{suffix}"),
                ("internship-role", f"{company} {role} internship"),
                ("reddit-internship", f"site:reddit.com {company} internship"),
            )
        )
    if context.focus in {"NEW_GRAD", "BOTH"}:
        templates.append(("new-grad", f"{company} new grad {role}"))
    if context.school_name:
        templates.extend(
            (
                ("school", f'{company} "{context.school_name}" recruiting'),
                ("career-fair", f'{company} "{context.school_name}" career fair'),
            )
        )
    templates.append(("github-interview", f"site:github.com {company} interview questions"))
    seen: set[str] = set()
    result: list[SearchQuerySpec] = []
    for key, query in templates:
        normalized = " ".join(query.split())
        if normalized.casefold() not in seen:
            seen.add(normalized.casefold())
            result.append(SearchQuerySpec(template_key=key, query=normalized))
    return tuple(result)
