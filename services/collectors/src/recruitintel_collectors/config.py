import os
from dataclasses import dataclass


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
        )
