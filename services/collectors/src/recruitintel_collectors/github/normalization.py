import re
import unicodedata
from urllib.parse import unquote, urlsplit

from recruitintel_collectors.domain.normalization import normalize_text

from .enums import QuestionDifficulty
from .models import GitHubCoordinates, NormalizedInterviewQuestion

_OWNER = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$")
_REPOSITORY = re.compile(r"^[a-z0-9._-]{1,100}$")
_SHA = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
_LEETCODE_URL = re.compile(
    r"(?:https?://)?(?:www\.)?leetcode\.com/problems/"
    r"(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)",
    re.IGNORECASE,
)
_MARKDOWN_LINK = re.compile(r"^\s*\[(?P<label>[^\]]+)\]\((?P<url>[^)]+)\)\s*$")
_NUMBERED_TITLE = re.compile(
    r"^\s*(?:(?:lc|leetcode)\s*)?(?:#\s*)?(?P<number>\d+)"
    r"\s*(?:[.:\-\u2013\u2014]\s*|\s+)(?P<title>.+?)\s*$",
    re.IGNORECASE,
)
_TITLE_TOKEN = re.compile(r"[^a-z0-9]+")
_TOPIC_SEPARATOR = re.compile(r"[,;|/]+")
_SMALL_TITLE_WORDS = frozenset(
    {"a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to", "with"}
)


class QuestionNormalizationError(ValueError):
    pass


def parse_github_url(value: str) -> GitHubCoordinates:
    parsed = urlsplit(value.strip())
    if parsed.scheme != "https" or (parsed.hostname or "").lower() != "github.com":
        raise ValueError("GitHub repository URL must use https://github.com")
    if parsed.username or parsed.password or parsed.port not in {None, 443}:
        raise ValueError("GitHub repository URL contains disallowed authority components")
    if parsed.query or parsed.fragment:
        raise ValueError("GitHub repository URL must not contain query parameters or fragments")
    parts = [unquote(part) for part in parsed.path.strip("/").split("/") if part]
    if len(parts) != 2:
        raise ValueError("GitHub repository URL must contain exactly owner/repository")
    owner = parts[0].casefold()
    repository_name = parts[1].removesuffix(".git").casefold()
    if not _OWNER.fullmatch(owner) or not _REPOSITORY.fullmatch(repository_name):
        raise ValueError("GitHub owner or repository name is invalid")
    return GitHubCoordinates(
        owner=owner,
        repository_name=repository_name,
        repository_url=f"https://github.com/{owner}/{repository_name}",
    )


def validate_commit_sha(value: str) -> str:
    normalized = value.casefold().strip()
    if not _SHA.fullmatch(normalized):
        raise ValueError("GitHub commit SHA must contain 40 or 64 lowercase hexadecimal digits")
    return normalized


def _normalized_title(value: str) -> str:
    folded = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(token for token in _TITLE_TOKEN.sub(" ", folded).split() if token)


def _title_from_slug(slug: str) -> str:
    words = slug.split("-")
    return " ".join(
        word if index and word in _SMALL_TITLE_WORDS else word.capitalize()
        for index, word in enumerate(words)
    )


def _difficulty(value: str | None) -> QuestionDifficulty | None:
    normalized = normalize_text(value).upper()
    if not normalized:
        return None
    aliases = {
        "EASY": QuestionDifficulty.EASY,
        "MEDIUM": QuestionDifficulty.MEDIUM,
        "HARD": QuestionDifficulty.HARD,
    }
    return aliases.get(normalized)


def normalize_topics(values: tuple[str, ...] | list[str] | str | None) -> tuple[str, ...]:
    if values is None:
        return ()
    raw = [values] if isinstance(values, str) else list(values)
    topics: set[str] = set()
    for item in raw:
        topics.update(
            normalized.casefold()
            for part in _TOPIC_SEPARATOR.split(str(item))
            if (normalized := normalize_text(part))
        )
    return tuple(sorted(topics))


def normalize_interview_question(
    *,
    raw_title: str | None,
    problem_url: str | None = None,
    difficulty: str | None = None,
    topics: tuple[str, ...] | list[str] | str | None = None,
) -> NormalizedInterviewQuestion:
    title = normalize_text(raw_title)
    candidate_url = normalize_text(problem_url)

    markdown = _MARKDOWN_LINK.fullmatch(title)
    if markdown:
        title = normalize_text(markdown.group("label"))
        candidate_url = candidate_url or normalize_text(markdown.group("url"))

    url_match = _LEETCODE_URL.search(candidate_url) or _LEETCODE_URL.search(title)
    slug = url_match.group("slug").casefold() if url_match else None
    title_is_problem_url = bool(
        url_match and url_match.start() == 0 and url_match.end() == len(title.rstrip("/"))
    )
    if url_match and (not title or title_is_problem_url):
        title = _title_from_slug(slug or "")

    number: int | None = None
    numbered = _NUMBERED_TITLE.fullmatch(title)
    if numbered:
        number = int(numbered.group("number"))
        title = normalize_text(numbered.group("title"))

    if not title and slug:
        title = _title_from_slug(slug)
    normalized_title = _normalized_title(title)
    if not normalized_title:
        raise QuestionNormalizationError(
            "question has no deterministic title or LeetCode problem slug"
        )
    if len(normalized_title) < 3 and not slug and number is None:
        raise QuestionNormalizationError("question title is too ambiguous to canonicalize")

    return NormalizedInterviewQuestion(
        canonical_title=title,
        normalized_title=normalized_title,
        leetcode_slug=slug,
        leetcode_number=number,
        difficulty=_difficulty(difficulty),
        topics=normalize_topics(topics),
    )
