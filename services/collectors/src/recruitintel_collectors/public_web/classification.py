import re
from urllib.parse import urlsplit

from .enums import RelevanceStatus, ReliabilityLevel, WebSourceClassification
from .models import CompanyWebConfig, ExtractedDocument, RelevanceDecision, SourceAssessment

_SIGNALS: dict[str, tuple[re.Pattern[str], int]] = {
    "internship": (re.compile(r"\b(?:intern|internship|co-?op)\b", re.I), 2),
    "new_grad": (re.compile(r"\b(?:new grad|graduate role|entry[- ]level)\b", re.I), 2),
    "early_career": (
        re.compile(r"\b(?:early career|university recruiting|campus recruiting)\b", re.I),
        2,
    ),
    "career_fair": (re.compile(r"\b(?:career fair|info session|campus visit)\b", re.I), 2),
    "application": (re.compile(r"\b(?:application|apply|deadline|applications? open)\b", re.I), 1),
    "interview": (re.compile(r"\b(?:interview|technical screen)\b", re.I), 1),
    "student": (re.compile(r"\b(?:student|students|graduation|university)\b", re.I), 1),
    "role": (
        re.compile(r"\b(?:software engineer|machine learning|data science|hiring)\b", re.I),
        1,
    ),
}

_NEGATIVE_ONLY = re.compile(
    r"\b(?:privacy policy|cookie policy|terms of (?:use|service)|accessibility statement)\b",
    re.I,
)


def _host_matches(host: str, domain: str) -> bool:
    normalized = domain.casefold().removeprefix("www.").rstrip(".")
    value = host.casefold().removeprefix("www.").rstrip(".")
    return value == normalized or value.endswith(f".{normalized}")


def classify_source(url: str, company: CompanyWebConfig) -> SourceAssessment:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").casefold()
    path = parsed.path.casefold()
    official = any(_host_matches(host, domain) for domain in company.domains)
    reasons: list[str] = []
    if official:
        reasons.append("host_matches_configured_company_domain")
        if any(token in path for token in ("career", "jobs", "intern", "early-career")):
            return SourceAssessment(
                classification=WebSourceClassification.COMPANY_CAREERS,
                reliability_level=ReliabilityLevel.OFFICIAL,
                confidence=0.98,
                reasons=(*reasons, "careers_path"),
            )
        if any(token in path for token in ("blog", "news", "press", "stories")):
            return SourceAssessment(
                classification=WebSourceClassification.COMPANY_BLOG,
                reliability_level=ReliabilityLevel.HIGH,
                confidence=0.90,
                reasons=(*reasons, "company_publication_path"),
            )
        return SourceAssessment(
            classification=WebSourceClassification.COMPANY_PUBLIC_PAGE,
            reliability_level=ReliabilityLevel.OFFICIAL,
            confidence=0.94,
            reasons=tuple(reasons),
        )
    if host.endswith(".edu") or ".edu." in host:
        return SourceAssessment(
            classification=WebSourceClassification.UNIVERSITY,
            reliability_level=ReliabilityLevel.HIGH,
            confidence=0.85,
            reasons=("education_domain",),
        )
    if _host_matches(host, "reddit.com") or _host_matches(host, "news.ycombinator.com"):
        return SourceAssessment(
            classification=WebSourceClassification.FORUM,
            reliability_level=ReliabilityLevel.LOW,
            confidence=0.35,
            reasons=("community_forum_domain",),
        )
    if _host_matches(host, "github.com"):
        return SourceAssessment(
            classification=WebSourceClassification.GITHUB,
            reliability_level=ReliabilityLevel.MEDIUM,
            confidence=0.65,
            reasons=("github_domain",),
        )
    if _host_matches(host, "linkedin.com"):
        return SourceAssessment(
            classification=WebSourceClassification.RECRUITER_PUBLIC_PAGE,
            reliability_level=ReliabilityLevel.UNKNOWN,
            confidence=0.50,
            reasons=("restricted_public_profile_url", "page_content_not_fetched"),
        )
    return SourceAssessment(
        classification=WebSourceClassification.PUBLIC_WEB,
        reliability_level=ReliabilityLevel.UNKNOWN,
        confidence=0.50,
        reasons=("unclassified_public_domain",),
    )


class DeterministicRelevanceClassifier:
    def classify(self, document: ExtractedDocument) -> RelevanceDecision:
        text = "\n".join(
            part
            for part in (
                document.title or "",
                document.meta_description or "",
                "\n".join(document.headings),
                document.text[:100_000],
            )
            if part
        )
        signals = tuple(key for key, (pattern, _) in _SIGNALS.items() if pattern.search(text))
        score = sum(_SIGNALS[key][1] for key in signals)
        reasons = [f"matched:{key}" for key in signals]
        if _NEGATIVE_ONLY.search(text) and score <= 1:
            return RelevanceDecision(
                status=RelevanceStatus.NOT_RELEVANT,
                score=score,
                signals=signals,
                reasons=(*reasons, "boilerplate_or_policy_page"),
            )
        if score >= 3:
            status = RelevanceStatus.RELEVANT
        elif score >= 1:
            status = RelevanceStatus.POSSIBLY_RELEVANT
        else:
            status = RelevanceStatus.NOT_RELEVANT
            reasons.append("no_recruiting_signals")
        return RelevanceDecision(
            status=status, score=score, signals=signals, reasons=tuple(reasons)
        )
