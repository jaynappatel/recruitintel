from datetime import UTC, datetime
from pathlib import Path
from time import monotonic

import httpx
import pytest
from recruitintel_collectors.public_web.classification import (
    DeterministicRelevanceClassifier,
    classify_source,
)
from recruitintel_collectors.public_web.dates import extract_date_signals
from recruitintel_collectors.public_web.enums import (
    DateCertainty,
    DatePrecision,
    PublicObservationType,
    RelevanceStatus,
    ReliabilityLevel,
    WebSourceClassification,
)
from recruitintel_collectors.public_web.extraction import (
    DeterministicHtmlExtractor,
    normalized_content_hash,
)
from recruitintel_collectors.public_web.fetcher import (
    HostRateLimiter,
    PublicWebRateLimitedError,
    ResponseTooLargeError,
    RestrictedSiteError,
    RobotsDeniedError,
    SafePublicWebFetcher,
)
from recruitintel_collectors.public_web.information import (
    DeterministicRecruitingInformationExtractor,
)
from recruitintel_collectors.public_web.models import (
    CompanyWebConfig,
    FetchedDocument,
    SearchContext,
)
from recruitintel_collectors.public_web.query_templates import generate_search_queries
from recruitintel_collectors.public_web.search import (
    JsonFileSearchProvider,
    SearchProviderDescriptor,
    SearchProviderRegistry,
    StaticSearchProvider,
)
from recruitintel_collectors.public_web.urls import (
    UnsafeUrlError,
    canonicalize_url,
    validate_public_url,
)

FIXTURES = Path(__file__).parent / "fixtures"


class Resolver:
    def __init__(self, *addresses: str) -> None:
        self.addresses = addresses

    async def resolve(self, hostname: str, port: int) -> tuple[str, ...]:
        del hostname, port
        return self.addresses


class Robots:
    def __init__(self, allowed: bool = True) -> None:
        self.value = allowed
        self.calls: list[str] = []

    async def allowed(self, url: str, user_agent: str) -> bool:
        del user_agent
        self.calls.append(url)
        return self.value


def _company() -> CompanyWebConfig:
    return CompanyWebConfig(
        id="10000000-0000-0000-0000-000000000001",
        canonical_name="Stripe",
        slug="stripe",
        website="https://stripe.com",
        careers_url="https://stripe.com/jobs",
        domains=("stripe.com",),
    )


def _fetched(
    name: str, url: str = "https://stripe.com/jobs/university/internships"
) -> FetchedDocument:
    return FetchedDocument(
        requested_url=url,
        final_url=url,
        status_code=200,
        content_type="text/html",
        body=(FIXTURES / name).read_text(encoding="utf-8"),
        fetched_at=datetime(2026, 8, 17, tzinfo=UTC),
    )


def test_url_canonicalization_removes_tracking_without_collapsing_real_parameters() -> None:
    value = canonicalize_url(
        "HTTPS://Example.COM:443/jobs/../jobs/42/?utm_source=x&team=eng&gclid=y#apply"
    )
    assert value == "https://example.com/jobs/42/?team=eng"
    assert canonicalize_url("https://example.com/jobs?id=1") != canonicalize_url(
        "https://example.com/jobs?id=2"
    )
    with pytest.raises(UnsafeUrlError):
        canonicalize_url("file:///etc/passwd")
    with pytest.raises(UnsafeUrlError):
        canonicalize_url("https://user:secret@example.com/jobs")


@pytest.mark.asyncio
async def test_ssrf_validation_blocks_local_private_and_mixed_dns_destinations() -> None:
    with pytest.raises(UnsafeUrlError):
        await validate_public_url("http://127.0.0.1/admin", Resolver("127.0.0.1"))
    with pytest.raises(UnsafeUrlError):
        await validate_public_url("https://example.com", Resolver("93.184.216.34", "10.0.0.2"))
    assert (
        await validate_public_url("https://example.com/jobs", Resolver("93.184.216.34"))
        == "https://example.com/jobs"
    )


@pytest.mark.asyncio
async def test_fetcher_revalidates_redirects_and_enforces_size_and_robots() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/start":
            return httpx.Response(302, headers={"location": "https://example.com/final"})
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text="<main><h1>Internship</h1><p>Applications are open.</p></main>",
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    robots = Robots()
    async with client:
        async with SafePublicWebFetcher(
            user_agent="RecruitIntelTest/1",
            resolver=Resolver("93.184.216.34"),
            robots_policy=robots,
            client=client,
            requests_per_second=1000,
        ) as fetcher:
            document = await fetcher.fetch("https://example.com/start")
            assert document.final_url == "https://example.com/final"
            assert len(robots.calls) == 2

    oversized = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"content-type": "text/html", "content-length": "100"},
                text="tiny",
                request=request,
            )
        )
    )
    async with oversized:
        async with SafePublicWebFetcher(
            user_agent="RecruitIntelTest/1",
            resolver=Resolver("93.184.216.34"),
            robots_policy=Robots(),
            client=oversized,
            max_response_bytes=10,
            requests_per_second=1000,
        ) as fetcher:
            with pytest.raises(ResponseTooLargeError):
                await fetcher.fetch("https://example.com/large")


@pytest.mark.asyncio
async def test_fetcher_escalates_long_retry_after_to_durable_orchestration() -> None:
    sleeps: list[float] = []

    async def no_sleep(delay: float) -> None:
        sleeps.append(delay)

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                429,
                headers={"Retry-After": "120"},
                request=request,
            )
        )
    )
    async with client:
        async with SafePublicWebFetcher(
            user_agent="RecruitIntelTest/1",
            resolver=Resolver("93.184.216.34"),
            robots_policy=Robots(),
            client=client,
            requests_per_second=1000,
            sleep=no_sleep,
        ) as fetcher:
            with pytest.raises(PublicWebRateLimitedError) as raised:
                await fetcher.fetch("https://example.com/rate-limited")

    assert raised.value.retry_after_seconds == 120
    assert sleeps == []

    denied_client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(500)))
    async with denied_client:
        async with SafePublicWebFetcher(
            user_agent="RecruitIntelTest/1",
            resolver=Resolver("93.184.216.34"),
            robots_policy=Robots(False),
            client=denied_client,
        ) as fetcher:
            with pytest.raises(RobotsDeniedError):
                await fetcher.fetch("https://example.com/private")


@pytest.mark.asyncio
async def test_fetcher_never_requests_linkedin_pages_or_redirect_targets() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if request.url.host == "example.com":
            return httpx.Response(
                302,
                headers={"location": "https://www.linkedin.com/in/jane-smith"},
                request=request,
            )
        raise AssertionError(f"restricted URL was requested: {request.url}")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    async with client:
        async with SafePublicWebFetcher(
            user_agent="RecruitIntelTest/1",
            resolver=Resolver("108.174.10.10"),
            robots_policy=Robots(),
            client=client,
        ) as fetcher:
            with pytest.raises(RestrictedSiteError):
                await fetcher.fetch("https://www.linkedin.com/in/jane-smith")
            with pytest.raises(RestrictedSiteError):
                await fetcher.fetch("https://example.com/profile")
    assert calls == ["https://example.com/profile"]


@pytest.mark.asyncio
async def test_host_rate_limiter_spaces_requests() -> None:
    limiter = HostRateLimiter(50)
    await limiter.wait("example.com")
    started = monotonic()
    await limiter.wait("example.com")
    assert monotonic() - started >= 0.015


def test_html_extraction_removes_boilerplate_and_hashes_normalized_content() -> None:
    extractor = DeterministicHtmlExtractor()
    document = extractor.extract(_fetched("web_official_internship_v1.html"))
    assert document.title == "Stripe University Internships 2027"
    assert "Applications open September 1, 2026" in document.text
    assert "Cookie settings" not in document.text
    assert "Copyright" not in document.text
    assert document.canonical_url == "https://stripe.com/jobs/university/internships"
    same = extractor.extract(
        FetchedDocument(
            requested_url=document.final_url,
            final_url=document.final_url,
            status_code=200,
            content_type="text/html",
            body="<main><h1> Hello </h1><p>Applications open.</p></main><footer>2026</footer>",
        )
    )
    same_again = extractor.extract(
        FetchedDocument(
            requested_url=document.final_url,
            final_url=document.final_url,
            status_code=200,
            content_type="text/html",
            body="<main><h1>Hello</h1> <p> Applications   open. </p></main><footer>2027</footer>",
        )
    )
    assert normalized_content_hash(same) == normalized_content_hash(same_again)
    changed = extractor.extract(_fetched("web_official_internship_v2.html"))
    assert normalized_content_hash(document) != normalized_content_hash(changed)


def test_source_reliability_and_relevance_are_transparent_and_deterministic() -> None:
    official = classify_source("https://stripe.com/jobs/interns", _company())
    assert official.classification is WebSourceClassification.COMPANY_CAREERS
    assert official.reliability_level is ReliabilityLevel.OFFICIAL
    university = classify_source("https://careers.utexas.edu/fair", _company())
    assert university.classification is WebSourceClassification.UNIVERSITY
    forum = classify_source("https://www.reddit.com/r/csMajors/post", _company())
    assert forum.reliability_level is ReliabilityLevel.LOW
    linkedin = classify_source("https://www.linkedin.com/in/jane-smith", _company())
    assert linkedin.classification is WebSourceClassification.RECRUITER_PUBLIC_PAGE
    assert "page_content_not_fetched" in linkedin.reasons

    extractor = DeterministicHtmlExtractor()
    relevance = DeterministicRelevanceClassifier()
    relevant = relevance.classify(extractor.extract(_fetched("web_university_career_fair.html")))
    irrelevant = relevance.classify(extractor.extract(_fetched("web_irrelevant.html")))
    assert relevant.status is RelevanceStatus.RELEVANT
    assert "career_fair" in relevant.signals
    assert irrelevant.status is RelevanceStatus.NOT_RELEVANT
    assert "boilerplate_or_policy_page" in irrelevant.reasons


def test_date_extraction_preserves_precision_certainty_and_ambiguity() -> None:
    exact = extract_date_signals(
        "Applications open September 1, 2026.", reliability=ReliabilityLevel.OFFICIAL
    )
    assert exact[0].start.isoformat() == "2026-09-01"
    assert exact[0].precision is DatePrecision.EXACT
    assert exact[0].certainty is DateCertainty.CONFIRMED
    date_range = extract_date_signals(
        "The fair runs August 20 - September 1, 2026.", reliability=ReliabilityLevel.HIGH
    )
    assert date_range[0].precision is DatePrecision.RANGE
    claimed = extract_date_signals(
        "They usually open in late August 2026.", reliability=ReliabilityLevel.LOW
    )
    assert claimed[0].precision is DatePrecision.APPROXIMATE
    assert claimed[0].certainty is DateCertainty.HISTORICAL
    assert not extract_date_signals("They open sometime soon.", reliability=ReliabilityLevel.LOW)


def test_structured_observations_and_query_templates_are_deterministic() -> None:
    document = DeterministicHtmlExtractor().extract(_fetched("web_official_internship_v1.html"))
    assessment = classify_source(document.final_url, _company())
    relevance = DeterministicRelevanceClassifier().classify(document)
    observations = DeterministicRecruitingInformationExtractor().extract(
        document, assessment=assessment, relevance=relevance
    )
    types = {item.observation_type for item in observations}
    assert PublicObservationType.APPLICATION_DATE in types
    assert PublicObservationType.INTERNSHIP_OPENING_SIGNAL in types
    application = next(
        item
        for item in observations
        if item.observation_type is PublicObservationType.APPLICATION_DATE
    )
    assert application.date_start.isoformat() == "2026-09-01"
    assert application.claim_subject == "application_date:internship"

    queries = generate_search_queries(
        SearchContext(company=_company(), graduation_year=2027, school_name="UT Austin")
    )
    assert any(item.query == '"Stripe" internship 2027' for item in queries)
    assert any("UT Austin" in item.query for item in queries)
    assert len({item.query.casefold() for item in queries}) == len(queries)


def test_information_extraction_keeps_page_title_without_headings() -> None:
    document = DeterministicHtmlExtractor().extract(
        FetchedDocument(
            requested_url="https://stripe.com/jobs/internships",
            final_url="https://stripe.com/jobs/internships",
            status_code=200,
            content_type="text/html",
            body=(
                "<html><head><title>Stripe internship applications</title></head>"
                "<body><main><p>Applications open September 1, 2026 for internships.</p>"
                "</main></body></html>"
            ),
        )
    )
    assessment = classify_source(document.final_url, _company())
    relevance = DeterministicRelevanceClassifier().classify(document)
    observations = DeterministicRecruitingInformationExtractor().extract(
        document, assessment=assessment, relevance=relevance
    )
    assert observations
    assert {item.title for item in observations} == {"Stripe internship applications"}


@pytest.mark.asyncio
async def test_static_search_provider_preserves_independent_results() -> None:
    provider = JsonFileSearchProvider(FIXTURES / "web_static_search_results.json")
    results = await provider.search('"Stripe" internship 2027', max_results=10)
    assert len(results) == 3
    assert results[0].rank == 1


def test_search_registry_requires_an_explicit_descriptor_for_every_provider() -> None:
    provider = StaticSearchProvider({})
    registry = SearchProviderRegistry([provider])
    assert registry.descriptor("static").production_capable is False
    with pytest.raises(ValueError, match="reviewed descriptor"):
        SearchProviderRegistry(
            [provider],
            [
                SearchProviderDescriptor(
                    name="unmatched",
                    production_capable=False,
                    official_api=False,
                    minimum_interval_seconds=60,
                    maximum_daily_queries=0,
                    terms_status="REVIEW_REQUIRED",
                )
            ],
        )
