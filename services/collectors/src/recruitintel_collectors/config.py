import os
from dataclasses import dataclass


def _environment_boolean(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    normalized = value.strip().casefold()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    user_agent: str
    max_concurrency: int
    requests_per_second: float
    timeout_seconds: float
    max_response_bytes: int
    github_token: str | None
    public_web_static_results_file: str | None
    public_web_max_response_bytes: int
    public_web_requests_per_second: float
    zero_cost_mode: bool
    searxng_base_url: str | None
    google_client_id: str | None
    google_client_secret: str | None
    calendar_token_encryption_key: str | None
    recruitintel_app_url: str | None

    @classmethod
    def from_environment(cls) -> "Settings":
        database_url = os.environ.get("DATABASE_URL", "")
        if not database_url:
            raise ValueError("DATABASE_URL is required")
        return cls(
            database_url=database_url,
            user_agent=os.environ.get(
                "RECRUITINTEL_USER_AGENT",
                "RecruitIntel/0.1 (+https://github.com/example/recruitintel)",
            ),
            max_concurrency=int(os.environ.get("COLLECTOR_MAX_CONCURRENCY", "5")),
            requests_per_second=float(os.environ.get("COLLECTOR_REQUESTS_PER_SECOND", "2")),
            timeout_seconds=float(os.environ.get("COLLECTOR_TIMEOUT_SECONDS", "20")),
            max_response_bytes=int(os.environ.get("COLLECTOR_MAX_RESPONSE_BYTES", "10000000")),
            github_token=os.environ.get("GITHUB_TOKEN") or None,
            public_web_static_results_file=os.environ.get("PUBLIC_WEB_STATIC_RESULTS_FILE") or None,
            public_web_max_response_bytes=int(
                os.environ.get("PUBLIC_WEB_MAX_RESPONSE_BYTES", "5000000")
            ),
            public_web_requests_per_second=float(
                os.environ.get("PUBLIC_WEB_REQUESTS_PER_SECOND", "1")
            ),
            zero_cost_mode=_environment_boolean("ZERO_COST_MODE", True),
            searxng_base_url=os.environ.get("SEARXNG_BASE_URL") or None,
            google_client_id=os.environ.get("GOOGLE_CLIENT_ID") or None,
            google_client_secret=os.environ.get("GOOGLE_CLIENT_SECRET") or None,
            calendar_token_encryption_key=(os.environ.get("CALENDAR_TOKEN_ENCRYPTION_KEY") or None),
            recruitintel_app_url=os.environ.get("RECRUITINTEL_APP_URL") or None,
        )
