import re
import unicodedata

_SPACE = re.compile(r"\s+")
_IDENTITY_PUNCTUATION = re.compile(r"[^a-z0-9]+")


def normalize_display_text(value: str) -> str:
    return _SPACE.sub(" ", unicodedata.normalize("NFKC", value)).strip()


def normalize_person_name(value: str) -> str:
    return _IDENTITY_PUNCTUATION.sub(" ", normalize_display_text(value).casefold()).strip()


def normalize_title(value: str) -> str:
    return _IDENTITY_PUNCTUATION.sub(" ", normalize_display_text(value).casefold()).strip()


def normalize_school_name(value: str) -> str:
    normalized = normalize_display_text(value).casefold()
    normalized = re.sub(r"\bthe\b", " ", normalized)
    normalized = normalized.replace("&", " and ")
    return _IDENTITY_PUNCTUATION.sub(" ", normalized).strip()


def split_person_name(value: str) -> tuple[str | None, str | None]:
    parts = normalize_display_text(value).split()
    if len(parts) < 2:
        return (parts[0] if parts else None), None
    return parts[0], parts[-1]
