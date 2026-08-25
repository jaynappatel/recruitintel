from datetime import UTC, datetime

from recruitintel_collectors.personalization.scoring import (
    WEIGHTS,
    score_opportunity,
)

AS_OF = datetime(2026, 8, 25, 12, tzinfo=UTC)
PREFERENCES = {
    "graduationYear": 2027,
    "usWorkAuthorized": True,
    "requiresEmployerSponsorship": False,
    "roleFamilies": ["SOFTWARE_ENGINEERING"],
    "earlyCareerTracks": ["INTERNSHIP"],
    "experienceLevels": ["INTERNSHIP"],
    "workplaceModes": ["REMOTE", "HYBRID"],
    "locations": [
        {"kind": "CITY_REGION_COUNTRY", "city": "Austin", "region": "TX", "countryCode": "US"}
    ],
}
OPPORTUNITY = {
    "opportunityId": "opportunity-1",
    "companyId": "company-1",
    "status": "ACTIVE",
    "lifecycleStatus": "OPEN",
    "roleFamily": "SOFTWARE_ENGINEERING",
    "experienceLevel": "INTERNSHIP",
    "isInternship": True,
    "isNewGrad": False,
    "graduationYears": [2027, 2028],
    "workplaceMode": "HYBRID",
    "locations": [{"city": "Austin", "region": "TX", "countryCode": "US"}],
    "effectiveOpenedAt": "2026-08-24T12:00:00+00:00",
    "deadlineAt": "2026-08-31T12:00:00+00:00",
    "deadlineReliable": True,
    "sourceAuthority": "OFFICIAL_ATS",
    "sourceAuthorityReviewed": True,
    "sponsorshipAvailable": None,
    "sponsorshipUnavailable": None,
    "workAuthorizationRequired": None,
}


def watches(company: bool = False) -> dict[str, set[str]]:
    return {
        "companies": {"company-1"} if company else set(),
        "opportunities": set(),
        "recruiters": set(),
        "schools": set(),
    }


def test_weights_are_small_and_versioned() -> None:
    assert sum(WEIGHTS.values()) == 100
    assert len(WEIGHTS) == 9


def test_same_input_is_deterministic_and_watched_company_is_explainable() -> None:
    first = score_opportunity(PREFERENCES, watches(True), OPPORTUNITY, as_of=AS_OF)
    second = score_opportunity(PREFERENCES, watches(True), OPPORTUNITY, as_of=AS_OF)
    assert first == second
    assert first["eligibility"] == "ELIGIBLE"
    assert "WATCHED_COMPANY" in first["reasonCodes"]


def test_explicit_hard_mismatch_is_not_weighted() -> None:
    result = score_opportunity(
        {**PREFERENCES, "graduationYear": 2030}, watches(True), OPPORTUNITY, as_of=AS_OF
    )
    assert result["eligibility"] == "NOT_ELIGIBLE"
    assert result["score"] is None
    assert "GRADUATION_YEAR_INELIGIBLE" in result["hardConstraintCodes"]


def test_unknown_evidence_is_neutral() -> None:
    result = score_opportunity(
        PREFERENCES,
        watches(),
        {
            **OPPORTUNITY,
            "lifecycleStatus": "UNKNOWN",
            "roleFamily": "OTHER",
            "experienceLevel": "UNKNOWN",
            "graduationYears": [],
            "workplaceMode": "UNKNOWN",
            "locations": [],
            "deadlineAt": None,
            "deadlineReliable": False,
        },
        as_of=AS_OF,
    )
    assert result["eligibility"] == "UNKNOWN"
    assert result["category"] == "LOW_PRIORITY"
    assert all(
        item["earnedWeight"] == 0 and item["availableWeight"] == 0
        for item in result["factors"]
        if item["state"] == "UNKNOWN"
    )


def test_watched_company_does_not_rescue_closed_or_work_auth_mismatch() -> None:
    closed = score_opportunity(
        PREFERENCES, watches(True), {**OPPORTUNITY, "lifecycleStatus": "CLOSED"}, as_of=AS_OF
    )
    auth = score_opportunity(
        {**PREFERENCES, "usWorkAuthorized": False},
        watches(True),
        {**OPPORTUNITY, "workAuthorizationRequired": True},
        as_of=AS_OF,
    )
    assert closed["eligibility"] == "NOT_ELIGIBLE"
    assert auth["eligibility"] == "NOT_ELIGIBLE"
