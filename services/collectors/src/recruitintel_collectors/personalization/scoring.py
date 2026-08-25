from __future__ import annotations

from datetime import UTC, datetime
from math import floor
from typing import Any

ALGORITHM_VERSION = "v1"
WEIGHTS = {
    "COMPANY_PREFERENCE": 18,
    "ROLE_MATCH": 20,
    "EARLY_CAREER_TRACK": 14,
    "EXPERIENCE_LEVEL": 12,
    "LOCATION_MATCH": 14,
    "WORKPLACE_MODE": 8,
    "FRESHNESS": 6,
    "DEADLINE_URGENCY": 4,
    "SOURCE_CONFIDENCE": 4,
}


def _factor(code: str, state: str, earned: int, reason: str) -> dict[str, Any]:
    return {
        "code": code,
        "state": state,
        "earnedWeight": earned,
        "availableWeight": 0 if state in {"UNKNOWN", "NOT_APPLICABLE"} else WEIGHTS[code],
        "reasonCode": reason,
    }


def _normalized(value: object) -> str | None:
    result = str(value).strip().casefold() if value is not None else ""
    return result or None


def _location_points(preference: dict[str, Any], location: dict[str, Any]) -> int:
    kind = preference.get("kind")
    city, region = _normalized(location.get("city")), _normalized(location.get("region"))
    country, remote = (
        _normalized(location.get("countryCode")),
        _normalized(location.get("remoteRegion")),
    )
    if (
        kind == "CITY_REGION_COUNTRY"
        and city == _normalized(preference.get("city"))
        and region == _normalized(preference.get("region"))
        and country == _normalized(preference.get("countryCode"))
        and city
        and region
        and country
    ):
        return 14
    if (
        kind == "REGION_COUNTRY"
        and region == _normalized(preference.get("region"))
        and country == _normalized(preference.get("countryCode"))
        and region
        and country
    ):
        return 12
    if kind == "COUNTRY" and country and country == _normalized(preference.get("countryCode")):
        return 7
    if kind == "REMOTE_REGION" and remote and remote == _normalized(preference.get("remoteRegion")):
        return 12
    return 0


def _parse_time(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(UTC)
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    return None


def score_opportunity(
    preferences: dict[str, Any],
    watches: dict[str, set[str]],
    opportunity: dict[str, Any],
    *,
    as_of: datetime,
) -> dict[str, Any]:
    """Exact worker-side implementation of deterministic recommendation v1."""
    as_of = as_of.astimezone(UTC)
    failures: list[str] = []
    unknowns: list[str] = []
    if opportunity["status"] == "SUPERSEDED":
        failures.append("OPPORTUNITY_SUPERSEDED")
    if opportunity["lifecycleStatus"] == "CLOSED":
        failures.append("OPPORTUNITY_CLOSED")
    elif opportunity["lifecycleStatus"] == "UNKNOWN":
        unknowns.append("OPPORTUNITY_LIFECYCLE_UNKNOWN")
    deadline = _parse_time(opportunity.get("deadlineAt"))
    if deadline and opportunity.get("deadlineReliable") and deadline < as_of:
        failures.append("DEADLINE_PASSED_CONFIRMED")
    levels = preferences.get("experienceLevels", [])
    if levels:
        if opportunity["experienceLevel"] == "UNKNOWN":
            unknowns.append("EXPERIENCE_LEVEL_UNKNOWN")
        elif opportunity["experienceLevel"] not in levels:
            failures.append("EXPLICIT_SENIORITY_MISMATCH")
    graduation_year = preferences.get("graduationYear")
    graduation_years = opportunity.get("graduationYears", [])
    if graduation_year is not None:
        if not graduation_years:
            unknowns.append("GRADUATION_REQUIREMENT_UNKNOWN")
        elif graduation_year not in graduation_years:
            failures.append("GRADUATION_YEAR_INELIGIBLE")
    if preferences.get("requiresEmployerSponsorship") is True:
        if opportunity.get("sponsorshipUnavailable") is True:
            failures.append("SPONSORSHIP_UNAVAILABLE")
        elif opportunity.get("sponsorshipAvailable") is not True:
            unknowns.append("SPONSORSHIP_ELIGIBILITY_UNKNOWN")
    if preferences.get("usWorkAuthorized") is False:
        if opportunity.get("workAuthorizationRequired") is True:
            failures.append("WORK_AUTHORIZATION_REQUIRED")
        elif opportunity.get("workAuthorizationRequired") is None:
            unknowns.append("WORK_AUTHORIZATION_UNKNOWN")
    eligibility = "NOT_ELIGIBLE" if failures else "UNKNOWN" if unknowns else "ELIGIBLE"

    factors: list[dict[str, Any]] = []
    watched_opportunities = watches.get("opportunities", set())
    watched_companies = watches.get("companies", set())
    if opportunity["opportunityId"] in watched_opportunities:
        factors.append(_factor("COMPANY_PREFERENCE", "MATCH", 18, "WATCHED_OPPORTUNITY"))
    elif opportunity["companyId"] in watched_companies:
        factors.append(_factor("COMPANY_PREFERENCE", "MATCH", 18, "WATCHED_COMPANY"))
    elif not watched_opportunities and not watched_companies:
        factors.append(_factor("COMPANY_PREFERENCE", "NOT_APPLICABLE", 0, "NO_WATCH_PREFERENCE"))
    else:
        factors.append(_factor("COMPANY_PREFERENCE", "MISMATCH", 0, "COMPANY_NOT_WATCHED"))

    roles = preferences.get("roleFamilies", [])
    if not roles:
        factors.append(_factor("ROLE_MATCH", "NOT_APPLICABLE", 0, "NO_ROLE_PREFERENCE"))
    elif opportunity["roleFamily"] == "OTHER":
        factors.append(_factor("ROLE_MATCH", "UNKNOWN", 0, "ROLE_FAMILY_UNKNOWN"))
    elif opportunity["roleFamily"] in roles:
        factors.append(_factor("ROLE_MATCH", "MATCH", 20, "ROLE_FAMILY_MATCH"))
    else:
        factors.append(_factor("ROLE_MATCH", "MISMATCH", 0, "ROLE_FAMILY_MISMATCH"))

    preferred_tracks = preferences.get("earlyCareerTracks", [])
    tracks = [
        *(["INTERNSHIP"] if opportunity.get("isInternship") else []),
        *(["NEW_GRAD"] if opportunity.get("isNewGrad") else []),
    ]
    if not preferred_tracks:
        factors.append(
            _factor("EARLY_CAREER_TRACK", "NOT_APPLICABLE", 0, "NO_EARLY_CAREER_PREFERENCE")
        )
    elif not tracks:
        state = "UNKNOWN" if opportunity["experienceLevel"] == "UNKNOWN" else "MISMATCH"
        reason = (
            "EARLY_CAREER_TRACK_UNKNOWN" if state == "UNKNOWN" else "EARLY_CAREER_TRACK_MISMATCH"
        )
        factors.append(_factor("EARLY_CAREER_TRACK", state, 0, reason))
    elif not any(track in preferred_tracks for track in tracks):
        factors.append(_factor("EARLY_CAREER_TRACK", "MISMATCH", 0, "EARLY_CAREER_TRACK_MISMATCH"))
    elif len(tracks) > 1 and len(preferred_tracks) == 1:
        factors.append(_factor("EARLY_CAREER_TRACK", "PARTIAL", 12, "EARLY_CAREER_TRACK_PARTIAL"))
    else:
        factors.append(_factor("EARLY_CAREER_TRACK", "MATCH", 14, "EARLY_CAREER_TRACK_MATCH"))

    if not levels:
        factors.append(_factor("EXPERIENCE_LEVEL", "NOT_APPLICABLE", 0, "NO_EXPERIENCE_PREFERENCE"))
    elif opportunity["experienceLevel"] == "UNKNOWN":
        factors.append(_factor("EXPERIENCE_LEVEL", "UNKNOWN", 0, "EXPERIENCE_LEVEL_UNKNOWN"))
    elif opportunity["experienceLevel"] in levels:
        factors.append(_factor("EXPERIENCE_LEVEL", "MATCH", 12, "EXPERIENCE_LEVEL_MATCH"))
    else:
        factors.append(_factor("EXPERIENCE_LEVEL", "MISMATCH", 0, "EXPLICIT_SENIORITY_MISMATCH"))

    preferred_locations = preferences.get("locations", [])
    locations = [
        item
        for item in opportunity.get("locations", [])
        if any(item.get(field) for field in ("city", "region", "countryCode", "remoteRegion"))
    ]
    if not preferred_locations:
        factors.append(_factor("LOCATION_MATCH", "NOT_APPLICABLE", 0, "NO_LOCATION_PREFERENCE"))
    elif not locations:
        factors.append(_factor("LOCATION_MATCH", "UNKNOWN", 0, "LOCATION_UNKNOWN"))
    else:
        points = max(
            (
                _location_points(preference, location)
                for preference in preferred_locations
                for location in locations
            ),
            default=0,
        )
        if points == 14:
            factors.append(_factor("LOCATION_MATCH", "MATCH", points, "LOCATION_EXACT_MATCH"))
        elif points:
            factors.append(_factor("LOCATION_MATCH", "PARTIAL", points, "LOCATION_PARTIAL_MATCH"))
        else:
            factors.append(_factor("LOCATION_MATCH", "MISMATCH", 0, "LOCATION_MISMATCH"))

    modes = preferences.get("workplaceModes", [])
    mode = opportunity["workplaceMode"]
    if not modes:
        factors.append(_factor("WORKPLACE_MODE", "NOT_APPLICABLE", 0, "NO_WORKPLACE_PREFERENCE"))
    elif mode == "UNKNOWN":
        factors.append(_factor("WORKPLACE_MODE", "UNKNOWN", 0, "WORKPLACE_MODE_UNKNOWN"))
    elif mode == "MIXED":
        factors.append(_factor("WORKPLACE_MODE", "PARTIAL", 6, "WORKPLACE_MODE_MIXED"))
    elif mode in modes:
        factors.append(_factor("WORKPLACE_MODE", "MATCH", 8, "WORKPLACE_MODE_MATCH"))
    else:
        factors.append(_factor("WORKPLACE_MODE", "MISMATCH", 0, "WORKPLACE_MODE_MISMATCH"))

    opened = _parse_time(opportunity["effectiveOpenedAt"]) or as_of
    age = max(0.0, (as_of - opened).total_seconds() / 86400)
    if age <= 1:
        factors.append(_factor("FRESHNESS", "MATCH", 6, "NEWLY_OPENED"))
    elif age <= 3:
        factors.append(_factor("FRESHNESS", "PARTIAL", 5, "OPENED_WITHIN_3_DAYS"))
    elif age <= 7:
        factors.append(_factor("FRESHNESS", "PARTIAL", 4, "OPENED_WITHIN_7_DAYS"))
    elif age <= 14:
        factors.append(_factor("FRESHNESS", "PARTIAL", 2, "OPENED_WITHIN_14_DAYS"))
    else:
        factors.append(_factor("FRESHNESS", "MISMATCH", 0, "OPPORTUNITY_NOT_FRESH"))

    if not deadline or not opportunity.get("deadlineReliable"):
        factors.append(_factor("DEADLINE_URGENCY", "UNKNOWN", 0, "DEADLINE_UNKNOWN"))
    else:
        days = (deadline - as_of).total_seconds() / 86400
        if days <= 1:
            factors.append(_factor("DEADLINE_URGENCY", "MATCH", 4, "DEADLINE_WITHIN_1_DAY"))
        elif days <= 3:
            factors.append(_factor("DEADLINE_URGENCY", "PARTIAL", 3, "DEADLINE_WITHIN_3_DAYS"))
        elif days <= 7:
            factors.append(_factor("DEADLINE_URGENCY", "PARTIAL", 2, "DEADLINE_WITHIN_7_DAYS"))
        elif days <= 14:
            factors.append(_factor("DEADLINE_URGENCY", "PARTIAL", 1, "DEADLINE_WITHIN_14_DAYS"))
        else:
            factors.append(_factor("DEADLINE_URGENCY", "MISMATCH", 0, "DEADLINE_NOT_URGENT"))

    source_authority = str(opportunity.get("sourceAuthority") or "UNREVIEWED")
    authority_points = (
        {"OFFICIAL_ATS": 4, "OFFICIAL_COMPANY": 3, "REVIEWED_DIRECT": 2, "COMMUNITY": 1}.get(
            source_authority, 0
        )
        if opportunity.get("sourceAuthorityReviewed")
        else 0
    )
    if authority_points == 4:
        factors.append(_factor("SOURCE_CONFIDENCE", "MATCH", 4, "SOURCE_OFFICIAL_ATS"))
    elif authority_points:
        factors.append(_factor("SOURCE_CONFIDENCE", "PARTIAL", authority_points, "SOURCE_REVIEWED"))
    else:
        factors.append(_factor("SOURCE_CONFIDENCE", "MISMATCH", 0, "SOURCE_UNREVIEWED"))

    available = sum(item["availableWeight"] for item in factors)
    earned = sum(item["earnedWeight"] for item in factors)
    score = (
        None
        if eligibility == "NOT_ELIGIBLE" or available == 0
        else floor(earned / available * 100 + 0.5)
    )
    known_personal = sum(item["state"] not in {"UNKNOWN", "NOT_APPLICABLE"} for item in factors[:6])
    if eligibility == "NOT_ELIGIBLE":
        category = "NOT_ELIGIBLE"
    elif eligibility == "UNKNOWN":
        category = "LOW_PRIORITY"
    elif score is not None and score >= 70 and available >= 50 and known_personal >= 2:
        category = "HIGH_PRIORITY"
    elif score is not None and score >= 40 and available >= 35:
        category = "MEDIUM_PRIORITY"
    else:
        category = "LOW_PRIORITY"
    return {
        "algorithmVersion": ALGORITHM_VERSION,
        "eligibility": eligibility,
        "category": category,
        "score": score,
        "availableWeight": available,
        "factors": factors,
        "hardConstraintCodes": (failures or unknowns)[:8],
        "reasonCodes": [
            *(["NO_KNOWN_HARD_BLOCKER"] if eligibility == "ELIGIBLE" else []),
            *(
                ["GRADUATION_YEAR_ELIGIBLE"]
                if graduation_year is not None and graduation_year in graduation_years
                else []
            ),
            *[item["reasonCode"] for item in factors if item["state"] in {"MATCH", "PARTIAL"}],
        ][:16],
    }
