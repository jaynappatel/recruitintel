import hashlib
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from .enums import SourceDiscoveryMethod
from .fingerprints import candidate_source_key
from .models import (
    CompanyWebConfig,
    DirectDiscoveryPlan,
    DirectSourceEndpoint,
    FetchedDocument,
    KnownSourceCoverage,
)
from .urls import UnsafeUrlError, canonicalize_url

_COMMON_PATHS = ("careers", "jobs", "early-careers", "internships", "university")
_CAREER_SIGNAL = re.compile(
    r"(?:career|jobs?|students?|university|early[-_ ]?careers?|internships?|"
    r"graduates?|campus|talent|roles?)",
    re.IGNORECASE,
)
_TOKEN = re.compile(r"^[A-Za-z0-9_.:-]{1,500}$")


class _LinkParser(HTMLParser):
    def __init__(self, maximum_links: int) -> None:
        super().__init__(convert_charrefs=True)
        self.maximum_links = maximum_links
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() != "a" or len(self.links) >= self.maximum_links:
            return
        attributes = {key.casefold(): value or "" for key, value in attrs}
        href = attributes.get("href", "").strip()
        if href:
            self._href = href
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None and len(" ".join(self._text)) < 500:
            self._text.append(data.strip())

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() != "a" or self._href is None:
            return
        self.links.append((self._href, " ".join(item for item in self._text if item)[:500]))
        self._href = None
        self._text = []


def _host_matches(hostname: str, domain: str) -> bool:
    host = hostname.casefold().removeprefix("www.").rstrip(".")
    expected = domain.casefold().removeprefix("www.").rstrip(".")
    return host == expected or host.endswith(f".{expected}")


def _fingerprint(*, company_id: str, provider: str, external_key: str, url: str) -> str:
    value = f"direct-source:v1:{company_id}:{provider}:{external_key}:{url}"
    return hashlib.sha256(value.encode()).hexdigest()


def _ats_endpoint(
    company: CompanyWebConfig,
    url: str,
    *,
    discovered_from_url: str,
) -> DirectSourceEndpoint | None:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").casefold()
    parts = [part for part in parsed.path.split("/") if part]
    provider: str | None = None
    ats_type: str | None = None
    external_key: str | None = None
    supported = False

    if host in {"boards.greenhouse.io", "job-boards.greenhouse.io"} and parts:
        provider, ats_type, external_key, supported = "greenhouse", "GREENHOUSE", parts[0], True
    elif host == "boards-api.greenhouse.io" and len(parts) >= 3 and parts[:2] == ["v1", "boards"]:
        provider, ats_type, external_key, supported = "greenhouse", "GREENHOUSE", parts[2], True
    elif host in {"jobs.lever.co", "api.lever.co", "api.eu.lever.co"} and parts:
        offset = 2 if host.startswith("api.") and parts[:2] == ["v0", "postings"] else 0
        if len(parts) > offset:
            provider, ats_type, external_key, supported = "lever", "LEVER", parts[offset], True
    elif host == "jobs.ashbyhq.com" and parts:
        provider, ats_type, external_key = "ashby", "ASHBY", parts[0]
    elif host == "jobs.smartrecruiters.com" and parts:
        provider, ats_type, external_key = "smartrecruiters", "SMARTRECRUITERS", parts[0]
    elif host.endswith(".myworkdayjobs.com"):
        tenant = parts[0] if parts else "jobs"
        provider, ats_type, external_key = "workday", "WORKDAY", f"{host}:{tenant}"
    elif host.endswith(".icims.com") and "jobs" in parts:
        provider, ats_type, external_key = "icims", "ICIMS", host
    elif "successfactors" in host or host.endswith(".successfactors.eu"):
        provider, ats_type, external_key = "successfactors", "SUCCESSFACTORS", host
    elif host.endswith(".bamboohr.com") and parts and parts[0].casefold() in {"careers", "jobs"}:
        provider, ats_type, external_key = "bamboohr", "BAMBOOHR", host.split(".")[0]

    if (
        provider is None
        or ats_type is None
        or external_key is None
        or not _TOKEN.fullmatch(external_key)
    ):
        return None
    return DirectSourceEndpoint(
        url=url,
        source_type="ATS",
        provider=provider,
        external_key=external_key.casefold(),
        name=f"{company.canonical_name} {ats_type.title()} recruiting endpoint",
        discovery_method=SourceDiscoveryMethod.ATS_FINGERPRINT,
        confidence=0.98 if supported else 0.90,
        discovered_from_url=discovered_from_url,
        evidence=f"recognized_{provider}_url",
        ats_type=ats_type,
        collector_supported=supported,
        fingerprint=_fingerprint(
            company_id=str(company.id),
            provider=provider,
            external_key=external_key.casefold(),
            url=url,
        ),
    )


class DirectSourceDiscovery:
    """Deterministic source discovery from configured domains and already-fetched pages."""

    def __init__(self, *, maximum_links: int = 500, maximum_endpoints: int = 50) -> None:
        if not 1 <= maximum_links <= 2_000 or not 1 <= maximum_endpoints <= 100:
            raise ValueError("direct discovery bounds are invalid")
        self.maximum_links = maximum_links
        self.maximum_endpoints = maximum_endpoints

    def plan(
        self,
        company: CompanyWebConfig,
        known_sources: tuple[KnownSourceCoverage, ...] = (),
    ) -> DirectDiscoveryPlan:
        if any(
            source.enabled and source.source_type in {"ATS", "COMPANY_CAREERS"}
            for source in known_sources
        ):
            return DirectDiscoveryPlan(
                probe_urls=(), general_search_recommended=False, reason="known_direct_source"
            )
        if company.careers_url:
            return DirectDiscoveryPlan(
                probe_urls=(canonicalize_url(company.careers_url),),
                general_search_recommended=False,
                reason="configured_careers_url",
            )
        if company.website:
            root = canonicalize_url(company.website)
            return DirectDiscoveryPlan(
                probe_urls=tuple(
                    canonicalize_url(urljoin(root.rstrip("/") + "/", path))
                    for path in _COMMON_PATHS
                ),
                general_search_recommended=False,
                reason="bounded_common_paths",
            )
        return DirectDiscoveryPlan(
            probe_urls=(), general_search_recommended=True, reason="no_direct_seed"
        )

    def discover(
        self, company: CompanyWebConfig, document: FetchedDocument
    ) -> tuple[DirectSourceEndpoint, ...]:
        parser = _LinkParser(self.maximum_links)
        parser.feed(document.body)
        parser.close()
        current = canonicalize_url(document.final_url)
        found: dict[str, DirectSourceEndpoint] = {}
        for href, anchor in parser.links:
            try:
                url = canonicalize_url(urljoin(current, href))
            except UnsafeUrlError:
                continue
            if url == current:
                continue
            parsed = urlsplit(url)
            signal = f"{parsed.netloc} {parsed.path} {anchor}"
            ats = (
                _ats_endpoint(company, url, discovered_from_url=current)
                if _CAREER_SIGNAL.search(signal)
                else None
            )
            if ats is not None:
                found.setdefault(ats.fingerprint, ats)
                if len(found) >= self.maximum_endpoints:
                    break
                continue
            host = parsed.hostname or ""
            if not any(_host_matches(host, domain) for domain in company.domains):
                continue
            if not _CAREER_SIGNAL.search(signal):
                continue
            external_key = candidate_source_key(company.id, url)
            endpoint = DirectSourceEndpoint(
                url=url,
                source_type="COMPANY_CAREERS",
                provider="public_web",
                external_key=external_key,
                name=f"{company.canonical_name} recruiting page",
                discovery_method=SourceDiscoveryMethod.PAGE_LINK,
                confidence=0.92,
                discovered_from_url=current,
                evidence="same_domain_recruiting_link",
                collector_supported=True,
                fingerprint=_fingerprint(
                    company_id=str(company.id),
                    provider="public_web",
                    external_key=external_key,
                    url=url,
                ),
            )
            found.setdefault(endpoint.fingerprint, endpoint)
            if len(found) >= self.maximum_endpoints:
                break
        return tuple(found.values())
