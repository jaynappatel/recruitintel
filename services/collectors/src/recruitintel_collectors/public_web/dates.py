import calendar
import re
from datetime import date

from .enums import DateCertainty, DatePrecision, ReliabilityLevel
from .models import DateSignal

_MONTHS = {name.casefold(): number for number, name in enumerate(calendar.month_name) if name}
_MONTHS.update({name.casefold(): number for number, name in enumerate(calendar.month_abbr) if name})
_MONTH_PATTERN = "|".join(sorted((re.escape(value) for value in _MONTHS), key=len, reverse=True))
_EXACT = re.compile(
    rf"\b(?P<month>{_MONTH_PATTERN})\.?\s+(?P<day>[0-3]?\d)(?:st|nd|rd|th)?(?:,)?\s+(?P<year>20\d{{2}})\b",
    re.I,
)
_ISO = re.compile(r"\b(?P<year>20\d{2})-(?P<month>0?[1-9]|1[0-2])-(?P<day>0?[1-9]|[12]\d|3[01])\b")
_RANGE = re.compile(
    rf"\b(?P<m1>{_MONTH_PATTERN})\.?\s+(?P<d1>[0-3]?\d)(?:st|nd|rd|th)?\s*"
    rf"(?:-|\u2013|\u2014|to|through)\s*(?:(?P<m2>{_MONTH_PATTERN})\.?\s+)?"
    rf"(?P<d2>[0-3]?\d)(?:st|nd|rd|th)?(?:,)?\s+(?P<year>20\d{{2}})\b",
    re.I,
)
_MONTH_YEAR = re.compile(rf"\b(?P<month>{_MONTH_PATTERN})\.?\s+(?P<year>20\d{{2}})\b", re.I)
_APPROXIMATE = re.compile(
    rf"\b(?P<qualifier>early|mid|middle of|late|around)\s+"
    rf"(?P<month>{_MONTH_PATTERN})(?:\s+(?P<year>20\d{{2}}))?\b",
    re.I,
)
_HISTORICAL = re.compile(
    r"\b(?:last year|previous(?:ly| year)?|historically|usually|typically)\b", re.I
)


def _month(value: str) -> int:
    return _MONTHS[value.casefold().rstrip(".")]


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _context(text: str, start: int, end: int, radius: int = 100) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    value = " ".join(text[left:right].split())
    return value[:400]


def _certainty(evidence: str, reliability: ReliabilityLevel) -> DateCertainty:
    if _HISTORICAL.search(evidence):
        return DateCertainty.HISTORICAL
    if reliability in {ReliabilityLevel.OFFICIAL, ReliabilityLevel.HIGH}:
        return DateCertainty.CONFIRMED
    if reliability is ReliabilityLevel.LOW:
        return DateCertainty.CLAIMED
    return DateCertainty.ESTIMATED


def extract_date_signals(
    text: str,
    *,
    reliability: ReliabilityLevel,
    reference_year: int | None = None,
) -> tuple[DateSignal, ...]:
    signals: list[tuple[int, int, DateSignal]] = []
    occupied: list[tuple[int, int]] = []

    def add(start: int, end: int, signal: DateSignal) -> None:
        if any(start < other_end and end > other_start for other_start, other_end in occupied):
            return
        occupied.append((start, end))
        signals.append((start, end, signal))

    for match in _RANGE.finditer(text):
        year = int(match.group("year"))
        first_month = _month(match.group("m1"))
        second_month = _month(match.group("m2") or match.group("m1"))
        start = _safe_date(year, first_month, int(match.group("d1")))
        end = _safe_date(year, second_month, int(match.group("d2")))
        if start is None or end is None or end < start:
            continue
        evidence = _context(text, match.start(), match.end())
        add(
            match.start(),
            match.end(),
            DateSignal(
                start=start,
                end=end,
                precision=DatePrecision.RANGE,
                certainty=_certainty(evidence, reliability),
                evidence=evidence,
            ),
        )
    for pattern in (_EXACT, _ISO):
        for match in pattern.finditer(text):
            value = _safe_date(
                int(match.group("year")),
                _month(match.group("month")) if pattern is _EXACT else int(match.group("month")),
                int(match.group("day")),
            )
            if value is None:
                continue
            evidence = _context(text, match.start(), match.end())
            add(
                match.start(),
                match.end(),
                DateSignal(
                    start=value,
                    precision=DatePrecision.EXACT,
                    certainty=_certainty(evidence, reliability),
                    evidence=evidence,
                ),
            )
    for match in _APPROXIMATE.finditer(text):
        year_text = match.group("year")
        if year_text is None and reference_year is None:
            continue
        approximate_year = int(year_text) if year_text else reference_year
        if approximate_year is None:
            continue
        month = _month(match.group("month"))
        qualifier = match.group("qualifier").casefold()
        day = 5 if qualifier == "early" else 15 if qualifier in {"mid", "middle of"} else 25
        value = _safe_date(approximate_year, month, day)
        if value is None:
            continue
        evidence = _context(text, match.start(), match.end())
        add(
            match.start(),
            match.end(),
            DateSignal(
                start=value,
                precision=DatePrecision.APPROXIMATE,
                certainty=_certainty(evidence, reliability),
                evidence=evidence,
            ),
        )
    for match in _MONTH_YEAR.finditer(text):
        value = _safe_date(int(match.group("year")), _month(match.group("month")), 1)
        if value is None:
            continue
        evidence = _context(text, match.start(), match.end())
        add(
            match.start(),
            match.end(),
            DateSignal(
                start=value,
                precision=DatePrecision.MONTH,
                certainty=_certainty(evidence, reliability),
                evidence=evidence,
            ),
        )
    return tuple(item[2] for item in sorted(signals, key=lambda item: item[0]))
