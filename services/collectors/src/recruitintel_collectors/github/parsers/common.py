import re

from recruitintel_collectors.domain.normalization import normalize_text

from .base import ParsedRow

_HEADER_TOKEN = re.compile(r"[^a-z0-9]+")
_MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]+\)")
_MARKDOWN_LINK = re.compile(r"\[(?P<label>[^\]]+)\]\((?P<url>[^)]+)\)")


def normalize_header(value: str) -> str:
    return " ".join(_HEADER_TOKEN.sub(" ", value.casefold()).split())


def clean_cell(value: str, *, prefer_link_url: bool = False) -> str:
    without_images = _MARKDOWN_IMAGE.sub("", value)
    link = _MARKDOWN_LINK.search(without_images)
    if link and prefer_link_url:
        return normalize_text(link.group("url"))
    if link:
        without_images = _MARKDOWN_LINK.sub(lambda match: match.group("label"), without_images)
    return normalize_text(without_images.replace("<br>", " ").replace("<br/>", " "))


def markdown_link_url(value: str) -> str | None:
    match = _MARKDOWN_LINK.search(value)
    return normalize_text(match.group("url")) if match else None


def value_for(row: ParsedRow, aliases: tuple[str, ...], *, prefer_link_url: bool = False) -> str:
    for alias in aliases:
        value = row.values.get(alias)
        if value:
            return clean_cell(value, prefer_link_url=prefer_link_url)
    return ""
