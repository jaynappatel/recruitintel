from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Any, Protocol
from urllib.parse import quote

import httpx

from recruitintel_collectors.infrastructure.rate_limit import DistributedRateLimiter

from .models import ProviderEvent


class CalendarProviderError(RuntimeError):
    def __init__(self, code: str, *, retryable: bool = True) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class RefreshCredentialInvalidError(CalendarProviderError):
    def __init__(self) -> None:
        super().__init__("REFRESH_CREDENTIAL_INVALID", retryable=False)


class ProviderUnauthorizedError(CalendarProviderError):
    def __init__(self) -> None:
        super().__init__("PROVIDER_UNAUTHORIZED", retryable=False)


class ProviderForbiddenError(CalendarProviderError):
    def __init__(self) -> None:
        super().__init__("PROVIDER_FORBIDDEN", retryable=False)


class ProviderRateLimitedError(CalendarProviderError):
    def __init__(self, retry_after_seconds: int | None = None) -> None:
        super().__init__("PROVIDER_RATE_LIMITED", retryable=True)
        self.retry_after_seconds = retry_after_seconds


class EventAlreadyExistsError(CalendarProviderError):
    def __init__(self) -> None:
        super().__init__("EVENT_ALREADY_EXISTS", retryable=False)


class CalendarProvider(Protocol):
    async def create_event(self, calendar_id: str, event: ProviderEvent) -> str: ...

    async def update_event(
        self, calendar_id: str, external_event_id: str, event: ProviderEvent
    ) -> None: ...

    async def delete_event(self, calendar_id: str, external_event_id: str) -> None: ...

    async def get_event(self, calendar_id: str, external_event_id: str) -> Mapping[str, Any]: ...

    async def aclose(self) -> None: ...


class GoogleTokenRefresher:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        client: httpx.AsyncClient | None = None,
        distributed_limiter: DistributedRateLimiter | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._client = client or httpx.AsyncClient(timeout=20)
        self._owns_client = client is None
        self._distributed_limiter = distributed_limiter

    async def refresh(self, refresh_token: str) -> str:
        if self._distributed_limiter is not None:
            await self._distributed_limiter.wait("PROVIDER", "google-oauth", 0.1)
        response = await self._client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            headers={"accept": "application/json"},
        )
        try:
            payload = response.json()
        except ValueError as error:
            raise CalendarProviderError("TOKEN_ENDPOINT_INVALID_RESPONSE") from error
        if response.status_code == 400 and payload.get("error") == "invalid_grant":
            raise RefreshCredentialInvalidError
        access_token = payload.get("access_token")
        if response.is_error or not isinstance(access_token, str) or not access_token:
            raise CalendarProviderError(
                "TOKEN_REFRESH_FAILED", retryable=response.status_code >= 500
            )
        return access_token

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def _google_event(event: ProviderEvent) -> dict[str, Any]:
    if event.all_day:
        if not event.starts_on:
            raise ValueError("all-day provider event needs starts_on")
        start = datetime.fromisoformat(event.starts_on).date()
        inclusive_end = datetime.fromisoformat(event.ends_on).date() if event.ends_on else start
        end = inclusive_end + timedelta(days=1)
        start_value: dict[str, str] = {"date": start.isoformat()}
        end_value: dict[str, str] = {"date": end.isoformat()}
    else:
        end_at = event.ends_at or event.starts_at + timedelta(minutes=30)
        start_value = {"dateTime": event.starts_at.isoformat(), "timeZone": event.timezone}
        end_value = {"dateTime": end_at.isoformat(), "timeZone": event.timezone}
    return {
        "id": event.external_id,
        "summary": event.title,
        "description": event.description,
        "start": start_value,
        "end": end_value,
        "extendedProperties": {"private": event.private_metadata},
    }


class GoogleCalendarProvider:
    def __init__(
        self,
        access_token: str,
        *,
        client: httpx.AsyncClient | None = None,
        distributed_limiter: DistributedRateLimiter | None = None,
    ) -> None:
        self._client = client or httpx.AsyncClient(timeout=20)
        self._owns_client = client is None
        self._headers = {"authorization": f"Bearer {access_token}", "accept": "application/json"}
        self._distributed_limiter = distributed_limiter

    async def _pace(self) -> None:
        if self._distributed_limiter is not None:
            await self._distributed_limiter.wait("PROVIDER", "google-calendar", 0.1)

    @staticmethod
    def _url(calendar_id: str, event_id: str | None = None) -> str:
        calendar = quote(calendar_id, safe="")
        base = f"https://www.googleapis.com/calendar/v3/calendars/{calendar}/events"
        return f"{base}/{quote(event_id, safe='')}" if event_id else base

    @staticmethod
    def _check(response: httpx.Response, *, create: bool = False, deleting: bool = False) -> None:
        if deleting and response.status_code in (404, 410):
            return
        if create and response.status_code == 409:
            raise EventAlreadyExistsError
        if response.status_code == 401:
            raise ProviderUnauthorizedError
        if response.status_code in (403, 429):
            retry_after: int | None = None
            try:
                retry_after = max(0, int(float(response.headers.get("Retry-After", ""))))
            except ValueError:
                pass
            reasons: set[str] = set()
            try:
                payload = response.json()
                error_payload = payload.get("error") if isinstance(payload, dict) else None
                errors = error_payload.get("errors", []) if isinstance(error_payload, dict) else []
                reasons = {
                    str(item.get("reason"))
                    for item in errors
                    if isinstance(item, dict) and item.get("reason")
                }
            except (TypeError, ValueError):
                pass
            quota_reasons = {
                "rateLimitExceeded",
                "userRateLimitExceeded",
                "quotaExceeded",
                "dailyLimitExceeded",
            }
            if response.status_code == 429 or retry_after is not None or reasons & quota_reasons:
                raise ProviderRateLimitedError(retry_after)
            raise ProviderForbiddenError
        if response.is_error:
            raise CalendarProviderError(
                f"GOOGLE_HTTP_{response.status_code}", retryable=response.status_code >= 429
            )

    async def create_event(self, calendar_id: str, event: ProviderEvent) -> str:
        await self._pace()
        response = await self._client.post(
            self._url(calendar_id),
            params={"sendUpdates": "none"},
            headers={**self._headers, "content-type": "application/json"},
            json=_google_event(event),
        )
        self._check(response, create=True)
        payload = response.json()
        external_id = payload.get("id")
        if not isinstance(external_id, str) or not external_id:
            raise CalendarProviderError("GOOGLE_EVENT_ID_MISSING")
        return external_id

    async def update_event(
        self, calendar_id: str, external_event_id: str, event: ProviderEvent
    ) -> None:
        await self._pace()
        body = _google_event(event)
        body["id"] = external_event_id
        response = await self._client.put(
            self._url(calendar_id, external_event_id),
            params={"sendUpdates": "none"},
            headers={**self._headers, "content-type": "application/json"},
            json=body,
        )
        self._check(response)

    async def delete_event(self, calendar_id: str, external_event_id: str) -> None:
        await self._pace()
        response = await self._client.delete(
            self._url(calendar_id, external_event_id),
            params={"sendUpdates": "none"},
            headers=self._headers,
        )
        self._check(response, deleting=True)

    async def get_event(self, calendar_id: str, external_event_id: str) -> Mapping[str, Any]:
        await self._pace()
        response = await self._client.get(
            self._url(calendar_id, external_event_id), headers=self._headers
        )
        self._check(response)
        payload = response.json()
        if not isinstance(payload, dict):
            raise CalendarProviderError("GOOGLE_EVENT_INVALID_RESPONSE")
        return payload

    async def aclose(self) -> None:
        self._headers.clear()
        if self._owns_client:
            await self._client.aclose()
