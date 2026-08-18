import re

from .dates import extract_date_signals
from .enums import DateCertainty, DatePrecision, PublicObservationType, RelevanceStatus
from .models import (
    ExtractedDocument,
    NormalizedWebObservation,
    RelevanceDecision,
    SourceAssessment,
)

_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")
_TYPE_PATTERNS: tuple[tuple[PublicObservationType, re.Pattern[str]], ...] = (
    (PublicObservationType.CAREER_FAIR, re.compile(r"\bcareer fair\b", re.I)),
    (PublicObservationType.CAMPUS_VISIT, re.compile(r"\b(?:campus visit|info session)\b", re.I)),
    (
        PublicObservationType.INTERVIEW_EXPERIENCE,
        re.compile(r"\b(?:interview experience|interview report|technical interview)\b", re.I),
    ),
    (
        PublicObservationType.NEW_GRAD_OPENING_SIGNAL,
        re.compile(r"\b(?:new grad|graduate role|entry[- ]level role)\b", re.I),
    ),
    (
        PublicObservationType.INTERNSHIP_OPENING_SIGNAL,
        re.compile(r"\b(?:internship|intern role|intern position|co-?op)\b", re.I),
    ),
    (
        PublicObservationType.EARLY_CAREER_PROGRAM,
        re.compile(r"\b(?:early career program|university program|student program)\b", re.I),
    ),
    (
        PublicObservationType.SCHOOL_RECRUITING_SIGNAL,
        re.compile(r"\b(?:university recruiting|campus recruiting|student recruiting)\b", re.I),
    ),
    (
        PublicObservationType.RECRUITING_ANNOUNCEMENT,
        re.compile(r"\b(?:now hiring|hiring announcement|applications? (?:are )?open)\b", re.I),
    ),
)
_DEADLINE = re.compile(r"\b(?:application )?deadline\b", re.I)
_OPEN_DATE = re.compile(r"\bapplications?\s+(?:are\s+)?(?:open|opens?|will open)\b", re.I)


def _evidence(text: str, pattern: re.Pattern[str]) -> str:
    sentences = [" ".join(value.split()) for value in _SENTENCE.split(text) if value.strip()]
    return next((value[:600] for value in sentences if pattern.search(value)), text[:600])


def _focus(text: str) -> str:
    folded = text.casefold()
    if "intern" in folded or "co-op" in folded:
        return "internship"
    if "new grad" in folded or "graduate" in folded:
        return "new-grad"
    return "general"


def _subject(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return normalized[:400] or "general"


class DeterministicRecruitingInformationExtractor:
    def extract(
        self,
        document: ExtractedDocument,
        *,
        assessment: SourceAssessment,
        relevance: RelevanceDecision,
    ) -> tuple[NormalizedWebObservation, ...]:
        if relevance.status is not RelevanceStatus.RELEVANT:
            return ()
        full_text = "\n".join(
            value
            for value in (document.title or "", "\n".join(document.headings), document.text)
            if value
        )
        date_signals = extract_date_signals(
            full_text,
            reliability=assessment.reliability_level,
            reference_year=document.published_at.year if document.published_at else None,
        )
        fallback_title = document.headings[0] if document.headings else "Recruiting signal"
        title = (document.title or fallback_title)[:500]
        observations: list[NormalizedWebObservation] = []
        focus = _focus(full_text)
        for signal in date_signals:
            evidence_folded = signal.evidence.casefold()
            observation_type: PublicObservationType | None = None
            if _DEADLINE.search(evidence_folded):
                observation_type = PublicObservationType.APPLICATION_DEADLINE
            elif _OPEN_DATE.search(evidence_folded):
                observation_type = PublicObservationType.APPLICATION_DATE
            if observation_type is None:
                continue
            observations.append(
                NormalizedWebObservation(
                    observation_type=observation_type,
                    title=title,
                    summary=signal.evidence,
                    evidence_text=signal.evidence,
                    source_url=document.final_url,
                    occurred_at=document.published_at,
                    date_start=signal.start,
                    date_end=signal.end,
                    date_precision=signal.precision,
                    date_certainty=signal.certainty,
                    claim_subject=f"{observation_type.value.casefold()}:{focus}",
                    metadata={"extraction_rule": "date_phrase_v1"},
                )
            )
        first_date = date_signals[0] if date_signals else None
        for observation_type, pattern in _TYPE_PATTERNS:
            if not pattern.search(full_text):
                continue
            evidence = _evidence(full_text, pattern)
            observations.append(
                NormalizedWebObservation(
                    observation_type=observation_type,
                    title=title,
                    summary=evidence,
                    evidence_text=evidence,
                    source_url=document.final_url,
                    occurred_at=document.published_at,
                    date_start=first_date.start if first_date else None,
                    date_end=first_date.end if first_date else None,
                    date_precision=first_date.precision if first_date else DatePrecision.UNKNOWN,
                    date_certainty=(first_date.certainty if first_date else DateCertainty.CLAIMED),
                    claim_subject=f"{observation_type.value.casefold()}:{_subject(title)}",
                    metadata={"extraction_rule": "keyword_signal_v1"},
                )
            )
        if not observations:
            evidence = _evidence(
                full_text, re.compile(r"\b(?:hiring|recruiting|application)\b", re.I)
            )
            observations.append(
                NormalizedWebObservation(
                    observation_type=PublicObservationType.GENERAL_RECRUITING_SIGNAL,
                    title=title,
                    summary=evidence,
                    evidence_text=evidence,
                    source_url=document.final_url,
                    occurred_at=document.published_at,
                    claim_subject=f"general:{_subject(title)}",
                    metadata={"extraction_rule": "relevance_fallback_v1"},
                )
            )
        deduplicated = {
            (item.observation_type, item.claim_subject, item.evidence_text.casefold()): item
            for item in observations
        }
        return tuple(deduplicated.values())
