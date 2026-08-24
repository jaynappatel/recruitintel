import base64
from datetime import UTC, datetime

import httpx
import pytest
from recruitintel_collectors.github.client import GitHubRateLimitError, OfficialGitHubClient


async def _no_sleep(_: float) -> None:
    return None


def _rate_headers(remaining: int = 100) -> dict[str, str]:
    return {
        "X-RateLimit-Limit": "5000",
        "X-RateLimit-Remaining": str(remaining),
        "X-RateLimit-Used": str(5000 - remaining),
        "X-RateLimit-Reset": "2000000000",
    }


@pytest.mark.asyncio
async def test_official_client_reads_metadata_commit_comparison_and_file() -> None:
    sha = "a" * 40
    previous = "b" * 40

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/repos/example/questions":
            document = {"default_branch": "main", "archived": False, "disabled": False}
        elif path.endswith("/commits/main"):
            document = {"sha": sha}
        elif f"/compare/{previous}...{sha}" in path:
            document = {"files": [{"filename": "questions.md", "status": "modified"}]}
        elif path.endswith("/contents/questions.md"):
            document = {
                "type": "file",
                "encoding": "base64",
                "content": base64.b64encode(b"| Company | Question |\n|---|---|\n").decode(),
                "sha": "c" * 40,
            }
        else:
            raise AssertionError(f"unexpected GitHub API path: {request.url}")
        return httpx.Response(200, json=document, headers=_rate_headers(), request=request)

    async with OfficialGitHubClient(
        user_agent="RecruitIntel tests",
        requests_per_second=100_000,
        transport=httpx.MockTransport(handler),
        sleep=_no_sleep,
    ) as client:
        metadata = await client.get_repository("example", "questions")
        commit = await client.get_latest_commit_sha("example", "questions", "main")
        comparison = await client.compare_commits("example", "questions", previous, sha)
        file = await client.get_file("example", "questions", "questions.md", sha)

    assert metadata.value.default_branch == "main"
    assert commit.value == sha
    assert comparison.value.files[0].path == "questions.md"
    assert file.value.commit_sha == sha
    assert file.value.source_url.endswith(f"/blob/{sha}/questions.md")


@pytest.mark.asyncio
async def test_rate_limit_exhaustion_stops_before_another_request() -> None:
    requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(
            200,
            json={"default_branch": "main"},
            headers=_rate_headers(remaining=0),
            request=request,
        )

    async with OfficialGitHubClient(
        user_agent="RecruitIntel tests",
        requests_per_second=100_000,
        transport=httpx.MockTransport(handler),
        sleep=_no_sleep,
    ) as client:
        await client.get_repository("example", "questions")
        with pytest.raises(GitHubRateLimitError):
            await client.get_repository("example", "questions")
    assert requests == 1


@pytest.mark.asyncio
async def test_expired_github_reset_timestamp_allows_next_request() -> None:
    requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        headers = _rate_headers(remaining=0 if requests == 1 else 100)
        headers["X-RateLimit-Reset"] = str(int(datetime.now(UTC).timestamp()) - 1)
        return httpx.Response(
            200,
            json={"default_branch": "main", "archived": False, "disabled": False},
            headers=headers,
            request=request,
        )

    async with OfficialGitHubClient(
        user_agent="RecruitIntel tests",
        requests_per_second=100_000,
        transport=httpx.MockTransport(handler),
        sleep=_no_sleep,
    ) as client:
        await client.get_repository("example", "questions")
        await client.get_repository("example", "questions")
    assert requests == 2
