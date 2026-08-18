import httpx
import pytest
from recruitintel_collectors.infrastructure.http import (
    ProviderHttpClient,
    ResponseTooLargeError,
    UnsafeProviderUrlError,
)


async def _no_sleep(_: float) -> None:
    return None


@pytest.mark.parametrize(
    "url",
    [
        "http://api.lever.co/v0/postings/acme",
        "https://user:secret@api.lever.co/v0/postings/acme",
        "https://127.0.0.1/data",
        "https://evil.example/data",
    ],
)
def test_fixed_host_policy_rejects_unsafe_urls(url: str) -> None:
    with pytest.raises(UnsafeProviderUrlError):
        ProviderHttpClient.validate_url(url, frozenset({"api.lever.co"}))


@pytest.mark.asyncio
async def test_retryable_status_is_retried() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, headers={"Retry-After": "0"}, request=request)
        return httpx.Response(200, json={"ok": True}, request=request)

    async with ProviderHttpClient(
        user_agent="RecruitIntel tests",
        requests_per_second=100_000,
        transport=httpx.MockTransport(handler),
        sleep=_no_sleep,
    ) as client:
        result = await client.get_json(
            "https://api.lever.co/example", allowed_hosts=frozenset({"api.lever.co"})
        )
    assert result == {"ok": True}
    assert attempts == 2


@pytest.mark.asyncio
async def test_response_size_is_bounded() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b'{"value":"too large"}', request=request)

    async with ProviderHttpClient(
        user_agent="RecruitIntel tests",
        requests_per_second=100_000,
        max_response_bytes=5,
        transport=httpx.MockTransport(handler),
        sleep=_no_sleep,
    ) as client:
        with pytest.raises(ResponseTooLargeError):
            await client.get_json(
                "https://api.lever.co/example", allowed_hosts=frozenset({"api.lever.co"})
            )
