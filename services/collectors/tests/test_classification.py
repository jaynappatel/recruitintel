import pytest
from recruitintel_collectors.domain.classification import classify_job
from recruitintel_collectors.domain.enums import EmploymentType, ExperienceLevel, RoleFamily


@pytest.mark.parametrize(
    ("title", "family"),
    [
        ("Software Engineer Intern", RoleFamily.SOFTWARE_ENGINEERING),
        ("Machine Learning Engineer", RoleFamily.AI_ML),
        ("Data Scientist", RoleFamily.DATA_SCIENCE),
        ("Analytics Engineer", RoleFamily.DATA_ENGINEERING),
        ("Security Engineer", RoleFamily.SECURITY),
        ("Product Manager Intern", RoleFamily.PRODUCT),
        ("Quantitative Researcher", RoleFamily.QUANT),
    ],
)
def test_role_family_rules(title: str, family: RoleFamily) -> None:
    assert classify_job(title, "").role_family is family


def test_internship_rule_overrides_provider_full_time_value() -> None:
    result = classify_job(
        "Software Engineering Intern — Summer 2027",
        "For students graduating in 2027.",
        EmploymentType.FULL_TIME,
    )
    assert result.is_internship is True
    assert result.is_new_grad is False
    assert result.experience_level is ExperienceLevel.INTERNSHIP
    assert result.employment_type is EmploymentType.INTERNSHIP
    assert result.season == "SUMMER"
    assert result.graduation_years == (2027,)


def test_unknown_title_stays_unknown() -> None:
    result = classify_job("Customer Happiness Wizard", "Answer customer questions")
    assert result.role_family is RoleFamily.OTHER
    assert result.experience_level is ExperienceLevel.UNKNOWN
