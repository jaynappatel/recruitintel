import pytest
from recruitintel_collectors.domain.normalization import (
    CompanyResolver,
    normalize_company_name,
    normalize_domain,
    slugify_company_name,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Meta Platforms, Inc.", "meta platforms"),
        ("  Cloudflare   LLC ", "cloudflare"),
        ("AT&T Corporation", "at and t"),
        ("FÍGMA™", "figmatm"),
    ],
)
def test_company_name_normalization(raw: str, expected: str) -> None:
    assert normalize_company_name(raw) == expected


def test_company_slug_is_deterministic() -> None:
    assert slugify_company_name("Cloudflare, Inc.") == "cloudflare"


def test_domain_normalization() -> None:
    assert normalize_domain("https://WWW.Example.com/careers") == "example.com"


@pytest.mark.parametrize("value", ["localhost", "127.0.0.1", "https://user:pass@example.com"])
def test_invalid_company_domains_are_rejected(value: str) -> None:
    with pytest.raises(ValueError):
        normalize_domain(value)


def test_resolver_uses_explicit_aliases_and_domains_without_guessing() -> None:
    resolver = CompanyResolver(
        aliases={"Meta": "company-meta", "Facebook": "company-meta"},
        domains={"meta.com": "company-meta"},
    )
    assert resolver.resolve(name="Facebook, Inc.") == "company-meta"
    assert resolver.resolve(domain="https://www.meta.com/careers") == "company-meta"
    assert resolver.resolve(name="Alphabet") is None
