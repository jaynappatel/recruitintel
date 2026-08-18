from datetime import UTC, datetime, timedelta
from uuid import UUID

from recruitintel_collectors.domain.enums import RoleFamily
from recruitintel_collectors.public_web.enums import (
    DateCertainty,
    DatePrecision,
    ReliabilityLevel,
)
from recruitintel_collectors.public_web.extraction import DeterministicHtmlExtractor
from recruitintel_collectors.public_web.models import FetchedDocument
from recruitintel_collectors.recruiter_campus.classification import (
    classify_freshness,
    classify_recruiter_title,
    classify_relationship_strength,
)
from recruitintel_collectors.recruiter_campus.enums import (
    CampusEventType,
    FreshnessStatus,
    RecruiterRoleCategory,
    RelationshipStrength,
    UnresolvedRecruiterReason,
)
from recruitintel_collectors.recruiter_campus.extraction import (
    DeterministicRecruiterCampusExtractor,
)
from recruitintel_collectors.recruiter_campus.models import (
    RecruiterObservationInput,
    RelationshipStrengthInput,
    SchoolReference,
)
from recruitintel_collectors.recruiter_campus.normalization import (
    normalize_person_name,
    normalize_school_name,
)

OBSERVATION_ID = UUID("91000000-0000-0000-0000-000000000001")
COMPANY_ID = UUID("91000000-0000-0000-0000-000000000002")
SOURCE_ID = UUID("91000000-0000-0000-0000-000000000003")
SCHOOL_ID = UUID("91000000-0000-0000-0000-000000000004")


def _observation(text: str, **metadata: object) -> RecruiterObservationInput:
    return RecruiterObservationInput(
        observation_id=OBSERVATION_ID,
        company_id=COMPANY_ID,
        company_name="Stripe",
        source_id=SOURCE_ID,
        source_url="https://careers.utexas.edu/events/stripe-expo",
        source_reliability=ReliabilityLevel.HIGH,
        title="Stripe at the Engineering Expo",
        evidence_text=text,
        observed_at=datetime(2026, 8, 18, tzinfo=UTC),
        published_at=datetime(2026, 8, 1, tzinfo=UTC),
        content_hash="a" * 64,
        date_start=datetime(2026, 9, 15, tzinfo=UTC).date(),
        date_precision=DatePrecision.EXACT,
        date_certainty=DateCertainty.CONFIRMED,
        confidence=0.85,
        metadata={"observation_type": "CAREER_FAIR", **metadata},
    )


def _schools() -> tuple[SchoolReference, ...]:
    return (
        SchoolReference(
            id=SCHOOL_ID,
            canonical_name="University of Texas at Austin",
            aliases=("UT Austin", "The University of Texas at Austin"),
            domains=("utexas.edu",),
        ),
    )


def test_person_and_school_normalization_is_exact_and_deterministic() -> None:
    assert normalize_person_name("  Jane   O\u2019Smith  ") == "jane o smith"
    assert normalize_school_name("The University of Texas at Austin") == (
        "university of texas at austin"
    )
    assert normalize_school_name("UT Austin") != normalize_school_name("UT Arlington")


def test_recruiter_title_categories_cover_early_career_patterns() -> None:
    assert classify_recruiter_title("University Recruiter") == (
        RecruiterRoleCategory.UNIVERSITY_RECRUITING,
    )
    assert classify_recruiter_title("Early Talent Technical Recruiter") == (
        RecruiterRoleCategory.EARLY_CAREER,
        RecruiterRoleCategory.TECHNICAL_RECRUITING,
    )
    assert classify_recruiter_title("Talent Acquisition Partner") == (
        RecruiterRoleCategory.TALENT_ACQUISITION,
    )
    assert classify_recruiter_title("Sales Director") == (RecruiterRoleCategory.OTHER,)


def test_relationship_strength_exposes_reasons_without_fake_percentages() -> None:
    as_of = datetime(2026, 8, 18, tzinfo=UTC)
    high = classify_relationship_strength(
        RelationshipStrengthInput(
            reliability=ReliabilityLevel.HIGH,
            independent_source_count=2,
            last_observed_at=as_of - timedelta(days=2),
            title_match=True,
            explicit_relationship=True,
        ),
        as_of=as_of,
    )
    assert high.strength is RelationshipStrength.HIGH
    assert "two_independent_sources" in high.reasons
    limited = classify_relationship_strength(
        RelationshipStrengthInput(
            reliability=ReliabilityLevel.LOW,
            independent_source_count=1,
            last_observed_at=as_of - timedelta(days=300),
        ),
        as_of=as_of,
    )
    assert limited.strength is RelationshipStrength.LIMITED_EVIDENCE
    assert "evidence_older_than_180_days" in limited.reasons


def test_freshness_is_current_aging_stale_or_unknown() -> None:
    now = datetime(2026, 8, 18, tzinfo=UTC)
    assert classify_freshness(now - timedelta(days=20), as_of=now).status is (
        FreshnessStatus.CURRENT
    )
    assert classify_freshness(now - timedelta(days=120), as_of=now).status is (
        FreshnessStatus.AGING
    )
    assert classify_freshness(now - timedelta(days=220), as_of=now).status is (
        FreshnessStatus.STALE
    )
    assert classify_freshness(None, as_of=now).status is FreshnessStatus.UNKNOWN


def test_observation_extracts_recruiter_school_role_and_campus_event() -> None:
    extraction = DeterministicRecruiterCampusExtractor().extract(
        _observation(
            "Jane Smith, University Recruiter at Stripe, will join UT Austin's "
            "Engineering Expo for software engineering students on September 15, 2026."
        ),
        schools=_schools(),
    )
    assert len(extraction.recruiters) == 1
    recruiter = extraction.recruiters[0]
    assert recruiter.canonical_name == "Jane Smith"
    assert recruiter.school_ids == (SCHOOL_ID,)
    assert recruiter.role_families == (RoleFamily.SOFTWARE_ENGINEERING,)
    assert recruiter.explicit_company_match
    assert len(extraction.campus_events) == 1
    assert extraction.campus_events[0].event_type is CampusEventType.CAREER_FAIR
    assert extraction.campus_events[0].school_id == SCHOOL_ID
    assert extraction.unresolved == ()


def test_structured_person_metadata_is_used_without_free_text_guessing() -> None:
    html = """
      <html><head><script type="application/ld+json">
      {"@type":"Person","name":"Alex Rivera","jobTitle":"Campus Recruiter",
       "url":"https://www.linkedin.com/in/alex-rivera"}
      </script></head><body><main>
      Join our university recruiting team at UT Austin.
      </main></body></html>
    """
    document = DeterministicHtmlExtractor().extract(
        FetchedDocument(
            requested_url="https://stripe.com/campus",
            final_url="https://stripe.com/campus",
            status_code=200,
            content_type="text/html",
            body=html,
        )
    )
    people = document.structured_metadata["people"]
    assert people == [
        {
            "name": "Alex Rivera",
            "job_title": "Campus Recruiter",
            "url": "https://www.linkedin.com/in/alex-rivera",
        }
    ]
    extraction = DeterministicRecruiterCampusExtractor().extract(
        _observation(
            "Join our university recruiting team at UT Austin.",
            structured_metadata=document.structured_metadata,
        ),
        schools=_schools(),
    )
    assert extraction.recruiters[0].canonical_name == "Alex Rivera"
    assert extraction.recruiters[0].public_profile_url == (
        "https://www.linkedin.com/in/alex-rivera"
    )


def test_ambiguous_text_is_preserved_unresolved() -> None:
    extraction = DeterministicRecruiterCampusExtractor().extract(
        _observation(
            "Our recruiting team will visit Example State University for a recruiting event."
        ),
        schools=_schools(),
    )
    reasons = {item.reason for item in extraction.unresolved}
    assert UnresolvedRecruiterReason.UNKNOWN_PERSON in reasons
    assert UnresolvedRecruiterReason.UNKNOWN_SCHOOL in reasons
