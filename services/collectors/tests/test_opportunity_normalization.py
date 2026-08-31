from datetime import UTC, datetime

from recruitintel_collectors.domain.enums import ExperienceLevel, RoleFamily
from recruitintel_collectors.opportunities.identity import (
    official_application_url_key,
    provider_native_key,
)
from recruitintel_collectors.opportunities.jsonld import normalize_json_ld_job_posting
from recruitintel_collectors.opportunities.structured import derive_structured_job_facts
from recruitintel_collectors.public_web.extraction import DeterministicHtmlExtractor
from recruitintel_collectors.public_web.models import FetchedDocument


def test_identity_keys_are_exact_and_official_url_requires_validated_host() -> None:
    native = provider_native_key(provider="greenhouse", board="roblox", external_id="123")
    assert native.key_type == "PROVIDER_NATIVE_ID"
    assert native.safe_value_hint == "greenhouse:roblox:123"

    url = "https://boards.greenhouse.io/roblox/jobs/123?gh_src=campaign#apply"
    assert official_application_url_key(url, validated_hosts=frozenset()) is None
    official = official_application_url_key(
        url, validated_hosts=frozenset({"boards.greenhouse.io"})
    )
    assert official is not None
    assert official.key_type == "OFFICIAL_APPLICATION_URL"
    assert "gh_src" not in official.safe_value_hint


def test_json_ld_job_posting_is_bounded_normalized_and_explicit() -> None:
    html = """
      <html><head><title>Roblox Careers</title>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":["Thing","JobPosting"],
       "identifier":{"value":"R-123"},
       "title":"Software Engineer Intern — Summer 2027",
       "description":"<p>Requires 2-3 years of Python. No visa sponsorship.</p>",
       "employmentType":["INTERN","FULL_TIME"],
       "datePosted":"2026-08-20T09:00:00Z",
       "validThrough":"2026-09-01T23:59:59Z",
       "url":"https://careers.roblox.com/jobs/R-123?utm_source=test",
       "hiringOrganization":{"name":"Roblox"},
       "jobLocation":{"address":{"addressLocality":"San Mateo",
         "addressRegion":"CA","addressCountry":"US"}}}
      </script></head><body><main>Early career jobs</main></body></html>
    """
    extracted = DeterministicHtmlExtractor().extract(
        FetchedDocument(
            requested_url="https://careers.roblox.com/jobs",
            final_url="https://careers.roblox.com/jobs",
            status_code=200,
            content_type="text/html",
            body=html,
        )
    )
    postings = extracted.structured_metadata["job_postings"]
    assert len(postings) == 1
    assert postings[0]["employment_type"] == "INTERN; FULL_TIME"
    normalized = normalize_json_ld_job_posting(
        postings[0],
        company_id="10000000-0000-0000-0000-000000000001",
        company_names=frozenset({"roblox"}),
        document_url=extracted.final_url,
    )
    assert normalized is not None
    fingerprinted, deadline = normalized
    assert fingerprinted.job.role_family is RoleFamily.SOFTWARE_ENGINEERING
    assert fingerprinted.job.experience_level is ExperienceLevel.INTERNSHIP
    assert fingerprinted.job.application_url == "https://careers.roblox.com/jobs/R-123"
    assert fingerprinted.job.published_at == datetime(2026, 8, 20, 9, tzinfo=UTC)
    assert deadline == datetime(2026, 9, 1, 23, 59, 59, tzinfo=UTC)


def test_json_ld_rejects_explicit_different_hiring_organization() -> None:
    assert (
        normalize_json_ld_job_posting(
            {
                "title": "Software Engineer Intern",
                "description": "Intern role",
                "url": "https://example.com/jobs/1",
                "hiring_organization_name": "Different Company",
            },
            company_id="10000000-0000-0000-0000-000000000001",
            company_names=frozenset({"roblox"}),
            document_url="https://careers.roblox.com/jobs",
        )
        is None
    )


def test_structured_requirements_preserve_only_explicit_constraints() -> None:
    facts = derive_structured_job_facts(
        description=(
            "Requires 3-5 years of Python and PostgreSQL. We do not offer sponsorship. "
            "Candidates must be authorized to work in the U.S."
        ),
        location="San Mateo, CA; Remote - United States",
        graduation_years=(2027,),
        raw_payload={"skills": ["React.js", "Unreviewed Specialty Tool"]},
    )
    assert {item.canonical_name for item in facts.skills} >= {
        "Python",
        "PostgreSQL",
        "React",
        None,
    }
    assert {item.constraint_type for item in facts.constraints} == {
        "SPONSORSHIP_UNAVAILABLE",
        "WORK_AUTHORIZATION_REQUIRED",
        "GRADUATION_ELIGIBILITY",
    }
    assert facts.requirements[0].value == {"minimum": 3, "maximum": 5}
    assert {item.workplace_mode for item in facts.locations} == {"ONSITE", "REMOTE"}
