import html
import ipaddress
import re
import unicodedata
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_WHITESPACE = re.compile(r"\s+")
_NON_ALPHANUMERIC = re.compile(r"[^a-z0-9]+")
_CORPORATE_SUFFIXES = {
    "co",
    "company",
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "llc",
    "limited",
    "ltd",
    "plc",
}
_TRACKING_PARAMETERS = {
    "gh_src",
    "lever-origin",
    "lever-source",
    "ref",
    "source",
}
_BLOCK_TAGS = {
    "address",
    "article",
    "br",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "p",
    "section",
    "tr",
}


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.suppressed_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag in {"script", "style", "template"}:
            self.suppressed_depth += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "template"} and self.suppressed_depth:
            self.suppressed_depth -= 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.suppressed_depth:
            self.parts.append(data)


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKC", html.unescape(value))
    return _WHITESPACE.sub(" ", normalized).strip()


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    parser = _VisibleTextParser()
    parser.feed(value)
    parser.close()
    return normalize_text(" ".join(parser.parts))


def normalize_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError("URLs must be absolute HTTPS URLs")
    if parsed.username or parsed.password:
        raise ValueError("URLs must not contain credentials")

    host = parsed.hostname.encode("idna").decode("ascii").lower()
    port = f":{parsed.port}" if parsed.port and parsed.port != 443 else ""
    query = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in _TRACKING_PARAMETERS
    ]
    return urlunsplit(("https", host + port, parsed.path or "/", urlencode(query), ""))


def normalize_company_name(value: str) -> str:
    folded = unicodedata.normalize("NFKC", value).casefold().replace("&", " and ")
    folded = unicodedata.normalize("NFKD", folded).encode("ascii", errors="ignore").decode("ascii")
    tokens = [token for token in _NON_ALPHANUMERIC.sub(" ", folded).split() if token]
    while tokens and tokens[-1] in _CORPORATE_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def slugify_company_name(value: str) -> str:
    normalized = normalize_company_name(value)
    slug = normalized.replace(" ", "-")
    if not slug:
        raise ValueError("company name cannot normalize to an empty slug")
    return slug


def normalize_domain(value: str) -> str:
    candidate = value if "://" in value else f"https://{value}"
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("invalid company domain")
    if parsed.username or parsed.password:
        raise ValueError("company domains must not contain credentials")
    host = parsed.hostname.encode("idna").decode("ascii").lower().removeprefix("www.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("company domains cannot be IP addresses")
    if "." not in host or any(part == "" for part in host.split(".")):
        raise ValueError("company domains must be fully qualified")
    return host


class CompanyResolver:
    """Deterministic alias/domain resolver; unresolved input is never guessed."""

    def __init__(self, aliases: dict[str, str], domains: dict[str, str]) -> None:
        self._aliases = {normalize_company_name(key): value for key, value in aliases.items()}
        self._domains = {normalize_domain(key): value for key, value in domains.items()}

    def resolve(self, *, name: str | None = None, domain: str | None = None) -> str | None:
        if domain:
            company_id = self._domains.get(normalize_domain(domain))
            if company_id:
                return company_id
        if name:
            return self._aliases.get(normalize_company_name(name))
        return None
