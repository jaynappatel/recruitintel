import hashlib
import json
import re
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin

from recruitintel_collectors.domain.normalization import html_to_text, normalize_text

from .models import ExtractedDocument, FetchedDocument
from .urls import UnsafeUrlError, canonicalize_url

_SPACE = re.compile(r"\s+")
_SUPPRESSED_TAGS = {
    "script",
    "style",
    "svg",
    "template",
    "noscript",
    "form",
    "nav",
    "footer",
    "aside",
}
_BOILERPLATE_MARKERS = ("cookie", "consent", "navigation", "site-footer", "site-header")


def _clean(value: str) -> str:
    return _SPACE.sub(" ", value).strip()


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        try:
            parsed = datetime.strptime(normalized[:10], "%Y-%m-%d").replace(tzinfo=UTC)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


class _ReadableHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.body_parts: list[str] = []
        self.main_parts: list[str] = []
        self.headings: list[str] = []
        self.meta: dict[str, str] = {}
        self.canonical_href: str | None = None
        self.time_values: list[str] = []
        self.json_ld_parts: list[str] = []
        self._title_depth = 0
        self._heading_depth = 0
        self._heading_parts: list[str] = []
        self._main_depth = 0
        self._suppressed_depth = 0
        self._suppressed_tags: dict[str, int] = {}
        self._json_ld_depth = 0

    @staticmethod
    def _attributes(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {key.casefold(): value or "" for key, value in attrs}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.casefold()
        attributes = self._attributes(attrs)
        marker = f"{attributes.get('id', '')} {attributes.get('class', '')}".casefold()
        if tag == "script" and attributes.get("type", "").casefold() == "application/ld+json":
            self._json_ld_depth += 1
            return
        if tag in _SUPPRESSED_TAGS or any(item in marker for item in _BOILERPLATE_MARKERS):
            self._suppressed_depth += 1
            self._suppressed_tags[tag] = self._suppressed_tags.get(tag, 0) + 1
            return
        if self._suppressed_depth:
            return
        if tag == "title":
            self._title_depth += 1
        if tag in {"main", "article"}:
            self._main_depth += 1
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._heading_depth += 1
            self._heading_parts = []
        if tag == "meta":
            key = (attributes.get("property") or attributes.get("name") or "").casefold()
            content = attributes.get("content", "").strip()
            if key and content:
                self.meta.setdefault(key, content)
        if tag == "link" and "canonical" in attributes.get("rel", "").casefold().split():
            self.canonical_href = attributes.get("href") or None
        if tag == "time" and attributes.get("datetime"):
            self.time_values.append(attributes["datetime"])

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if self._json_ld_depth:
            if tag == "script":
                self._json_ld_depth -= 1
            return
        if self._suppressed_depth:
            if self._suppressed_tags.get(tag, 0):
                self._suppressed_depth -= 1
                self._suppressed_tags[tag] -= 1
            return
        if tag == "title" and self._title_depth:
            self._title_depth -= 1
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"} and self._heading_depth:
            heading = _clean(" ".join(self._heading_parts))
            if heading:
                self.headings.append(heading)
            self._heading_depth -= 1
            self._heading_parts = []
        if tag in {"main", "article"} and self._main_depth:
            self._main_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._json_ld_depth:
            self.json_ld_parts.append(data)
            return
        if self._suppressed_depth:
            return
        value = _clean(data)
        if not value:
            return
        if self._title_depth:
            self.title_parts.append(value)
        self.body_parts.append(value)
        if self._main_depth:
            self.main_parts.append(value)
        if self._heading_depth:
            self._heading_parts.append(value)


def _json_ld_metadata(parts: list[str]) -> tuple[dict[str, Any], datetime | None]:
    values: list[Any] = []
    for raw in parts:
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        values.extend(parsed if isinstance(parsed, list) else [parsed])
    published: datetime | None = None
    types: list[str] = []
    people: list[dict[str, str]] = []
    job_postings: list[dict[str, Any]] = []

    def bounded_text(value: Any, maximum: int) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = normalize_text(value)[:maximum]
        return normalized or None

    def bounded_text_or_list(value: Any, maximum: int) -> str | None:
        if isinstance(value, str):
            return bounded_text(value, maximum)
        if isinstance(value, list):
            items = [bounded_text(item, maximum) for item in value[:50]]
            return "; ".join(item for item in items if item)[:maximum] or None
        return None

    def job_location(value: Any) -> str | None:
        values = value if isinstance(value, list) else [value]
        locations: list[str] = []
        for item in values[:20]:
            if not isinstance(item, dict):
                continue
            address = item.get("address")
            if isinstance(address, str):
                candidate = bounded_text(address, 500)
            elif isinstance(address, dict):
                candidate = ", ".join(
                    part
                    for part in (
                        bounded_text(address.get("addressLocality"), 100),
                        bounded_text(address.get("addressRegion"), 100),
                        bounded_text(address.get("addressCountry"), 100),
                    )
                    if part
                )
            else:
                candidate = None
            if candidate:
                locations.append(candidate)
        return "; ".join(dict.fromkeys(locations))[:1_000] or None

    def normalize_job_posting(value: dict[str, Any]) -> dict[str, Any] | None:
        title = bounded_text(value.get("title") or value.get("name"), 1_000)
        description_value = value.get("description")
        description = (
            html_to_text(description_value)[:50_000] if isinstance(description_value, str) else ""
        )
        if not title:
            return None
        result: dict[str, Any] = {"title": title, "description": description}
        for source_key, target_key, maximum in (
            ("url", "url", 8_192),
            ("datePosted", "date_posted", 100),
            ("validThrough", "valid_through", 100),
            ("jobLocationType", "job_location_type", 200),
            ("skills", "skills_text", 2_000),
            ("qualifications", "qualifications", 5_000),
            ("educationRequirements", "education_requirements", 2_000),
            ("experienceRequirements", "experience_requirements", 2_000),
        ):
            item = bounded_text(value.get(source_key), maximum)
            if item:
                result[target_key] = item
        employment_type = bounded_text_or_list(value.get("employmentType"), 200)
        if employment_type:
            result["employment_type"] = employment_type
        location = job_location(value.get("jobLocation"))
        if location:
            result["location"] = location
        identifier = value.get("identifier")
        if isinstance(identifier, dict):
            identifier_value = bounded_text(identifier.get("value"), 500)
            if identifier_value:
                result["identifier"] = identifier_value
        organization = value.get("hiringOrganization")
        if isinstance(organization, dict):
            name = bounded_text(organization.get("name"), 500)
            same_as = bounded_text(organization.get("sameAs"), 8_192)
            if name:
                result["hiring_organization_name"] = name
            if same_as:
                result["hiring_organization_url"] = same_as
        applicant_location = value.get("applicantLocationRequirements")
        if isinstance(applicant_location, dict):
            name = bounded_text(applicant_location.get("name"), 500)
            if name:
                result["applicant_location_requirements"] = name
        return result

    def visit(value: Any) -> None:
        nonlocal published
        if isinstance(value, dict):
            type_value = value.get("@type")
            type_values = (
                [type_value]
                if isinstance(type_value, str)
                else [item for item in type_value if isinstance(item, str)]
                if isinstance(type_value, list)
                else []
            )
            for schema_type in type_values:
                types.append(schema_type)
                if schema_type.casefold() == "jobposting" and len(job_postings) < 50:
                    posting = normalize_job_posting(value)
                    if posting:
                        job_postings.append(posting)
                if schema_type.casefold() == "person":
                    name = value.get("name")
                    job_title = value.get("jobTitle")
                    url = value.get("url")
                    if isinstance(name, str) and isinstance(job_title, str):
                        person = {"name": _clean(name), "job_title": _clean(job_title)}
                        if isinstance(url, str) and url.startswith(("http://", "https://")):
                            person["url"] = url
                        people.append(person)
            if published is None:
                for key in ("datePublished", "dateCreated", "uploadDate"):
                    raw_date = value.get(key)
                    if isinstance(raw_date, str):
                        published = _parse_datetime(raw_date)
                        if published is not None:
                            break
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    for item in values:
        visit(item)
    metadata: dict[str, Any] = {}
    if types:
        metadata["json_ld_types"] = sorted(set(types))
    if people:
        metadata["people"] = list(
            {json.dumps(item, sort_keys=True): item for item in people}.values()
        )[:20]
    if job_postings:
        metadata["job_postings"] = list(
            {json.dumps(item, sort_keys=True): item for item in job_postings}.values()
        )[:50]
        metadata["job_postings_truncated"] = len(job_postings) >= 50
    return metadata, published


class DeterministicHtmlExtractor:
    def extract(self, document: FetchedDocument) -> ExtractedDocument:
        parser = _ReadableHtmlParser()
        parser.feed(document.body)
        parser.close()
        text_parts = parser.main_parts if parser.main_parts else parser.body_parts
        text = "\n".join(text_parts)
        text = "\n".join(dict.fromkeys(part for part in text.splitlines() if part))
        if not text.strip():
            raise ValueError("HTML document did not contain readable text")
        title = _clean(" ".join(parser.title_parts)) or None
        description = parser.meta.get("description") or parser.meta.get("og:description")
        canonical: str | None = None
        if parser.canonical_href:
            try:
                canonical = canonicalize_url(urljoin(document.final_url, parser.canonical_href))
            except UnsafeUrlError:
                canonical = None
        structured_metadata, json_ld_published = _json_ld_metadata(parser.json_ld_parts)
        published = None
        for key in (
            "article:published_time",
            "date",
            "datepublished",
            "publish-date",
        ):
            published = _parse_datetime(parser.meta.get(key))
            if published is not None:
                break
        if published is None:
            published = next(
                (value for value in map(_parse_datetime, parser.time_values) if value is not None),
                json_ld_published,
            )
        return ExtractedDocument(
            final_url=document.final_url,
            title=title,
            meta_description=_clean(description) if description else None,
            canonical_url=canonical,
            published_at=published,
            headings=tuple(dict.fromkeys(parser.headings)),
            text=text,
            structured_metadata=structured_metadata,
        )


def normalized_content_hash(document: ExtractedDocument) -> str:
    payload = {
        "title": _clean(document.title or "").casefold(),
        "description": _clean(document.meta_description or "").casefold(),
        "headings": [_clean(value).casefold() for value in document.headings],
        "text": [_clean(value).casefold() for value in document.text.splitlines() if _clean(value)],
        "published_at": document.published_at.isoformat() if document.published_at else None,
        "structured_metadata": document.structured_metadata,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode()).hexdigest()
