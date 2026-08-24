from datetime import UTC, datetime

import httpx

from recruitintel_collectors.calendar.provider import (
    CalendarProviderError,
    ProviderForbiddenError,
    ProviderRateLimitedError,
    ProviderUnauthorizedError,
    RefreshCredentialInvalidError,
)
from recruitintel_collectors.github.client import GitHubAPIError, GitHubRateLimitError
from recruitintel_collectors.infrastructure.http import ProviderRateLimitError
from recruitintel_collectors.pipeline.memory import RunAlreadyActiveError
from recruitintel_collectors.public_web.fetcher import (
    PublicWebRateLimitedError,
    RestrictedSiteError,
    RobotsDeniedError,
    RobotsUnavailableError,
)
from recruitintel_collectors.public_web.urls import UnsafeUrlError

from .enums import FailureClassification
from .models import WorkFailure


def _seconds_until(value: datetime | None) -> int | None:
    if value is None:
        return None
    return max(0, int((value - datetime.now(UTC)).total_seconds()))


def classify_failure(error: Exception) -> WorkFailure:
    if isinstance(error, PublicWebRateLimitedError):
        return WorkFailure(
            classification=FailureClassification.RATE_LIMITED,
            code="PUBLIC_WEB_RATE_LIMITED",
            retry_after_seconds=error.retry_after_seconds,
        )
    if isinstance(error, ProviderRateLimitError):
        return WorkFailure(
            classification=FailureClassification.RATE_LIMITED,
            code="PROVIDER_RATE_LIMITED",
            retry_after_seconds=error.retry_after_seconds,
        )
    if isinstance(error, (RefreshCredentialInvalidError, ProviderUnauthorizedError)):
        return WorkFailure(
            classification=FailureClassification.AUTH_REQUIRED,
            code=getattr(error, "code", "AUTH_REQUIRED"),
        )
    if isinstance(error, ProviderRateLimitedError):
        return WorkFailure(
            classification=FailureClassification.RATE_LIMITED,
            code=error.code,
            retry_after_seconds=error.retry_after_seconds,
        )
    if isinstance(error, ProviderForbiddenError):
        return WorkFailure(
            classification=FailureClassification.NON_RETRYABLE,
            code=error.code,
        )
    if isinstance(error, CalendarProviderError):
        return WorkFailure(
            classification=(
                FailureClassification.RETRYABLE
                if error.retryable
                else FailureClassification.NON_RETRYABLE
            ),
            code=error.code,
        )
    if isinstance(error, GitHubRateLimitError):
        return WorkFailure(
            classification=FailureClassification.RATE_LIMITED,
            code="GITHUB_RATE_LIMITED",
            retry_after_seconds=_seconds_until(error.rate_limit.reset_at),
        )
    if isinstance(error, GitHubAPIError):
        return WorkFailure(
            classification=(
                FailureClassification.RETRYABLE
                if error.retryable
                else FailureClassification.NON_RETRYABLE
            ),
            code=("GITHUB_RETRYABLE" if error.retryable else "GITHUB_PERMANENT"),
            retry_after_seconds=error.retry_after_seconds,
        )
    if isinstance(error, RobotsUnavailableError):
        return WorkFailure(
            classification=FailureClassification.RETRYABLE,
            code="ROBOTS_UNAVAILABLE",
        )
    if isinstance(error, (UnsafeUrlError, RobotsDeniedError, RestrictedSiteError)):
        return WorkFailure(
            classification=FailureClassification.POLICY_BLOCKED,
            code="SOURCE_POLICY_BLOCKED",
        )
    if isinstance(error, (httpx.TimeoutException, httpx.NetworkError, RunAlreadyActiveError)):
        return WorkFailure(
            classification=FailureClassification.RETRYABLE,
            code="TRANSIENT_EXECUTION_FAILURE",
        )
    if isinstance(error, (KeyError, ValueError)):
        return WorkFailure(
            classification=FailureClassification.NON_RETRYABLE,
            code="INVALID_WORK_CONFIGURATION",
        )
    return WorkFailure(
        classification=FailureClassification.RETRYABLE,
        code="UNEXPECTED_WORK_FAILURE",
    )
