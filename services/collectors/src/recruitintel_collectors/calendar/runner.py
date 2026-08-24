import hashlib
import json
import re
from collections.abc import Callable
from time import monotonic
from uuid import UUID

from recruitintel_collectors.infrastructure.calendar_postgres import (
    PostgresCalendarSyncRepository,
)

from .encryption import CredentialCipher
from .models import (
    CalendarConnection,
    CalendarSyncItem,
    CalendarSyncStats,
    ExternalSyncStatus,
    ProviderEvent,
)
from .provider import (
    CalendarProvider,
    CalendarProviderError,
    EventAlreadyExistsError,
    GoogleTokenRefresher,
    ProviderRateLimitedError,
    ProviderUnauthorizedError,
    RefreshCredentialInvalidError,
)

_CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class CalendarSyncPartialFailureError(RuntimeError):
    pass


def _bounded(value: str, limit: int) -> str:
    return _CONTROL_CHARACTERS.sub("", value).strip()[:limit]


def deterministic_external_event_id(connection_id: UUID, item_id: UUID) -> str:
    # Google accepts lowercase hex event IDs. Supplying our own ID closes the
    # create-succeeded/local-write-failed duplication window.
    digest = hashlib.sha256(f"recruitintel:{connection_id}:{item_id}".encode()).hexdigest()
    return f"ri{digest}"


def provider_event_for(
    connection: CalendarConnection,
    item: CalendarSyncItem,
    *,
    app_url: str | None,
) -> ProviderEvent:
    prefixes = {
        "APPLICATION_TASK": "Apply",
        "LEETCODE": "LeetCode Prep",
        "RECRUITER_OUTREACH": "Recruiter Outreach",
        "RESUME_WORK": "Resume Work",
    }
    label = prefixes.get(item.type)
    title = f"RecruitIntel: {label} — {item.title}" if label else f"RecruitIntel: {item.title}"
    description_parts = []
    if item.company_name:
        description_parts.append(f"Company: {item.company_name}")
    if item.job_title:
        description_parts.append(f"Job: {item.job_title}")
    if item.description:
        description_parts.append(f"Reason: {_bounded(item.description, 1000)}")
    if item.date_certainty:
        description_parts.append(f"Intelligence certainty: {item.date_certainty}")
    if item.application_url:
        description_parts.append(f"Job URL: {item.application_url}")
    if item.source_url:
        description_parts.append(f"Source: {item.source_url}")
    if app_url:
        description_parts.append(f"RecruitIntel: {app_url.rstrip('/')}/calendar?item={item.id}")
    return ProviderEvent(
        external_id=deterministic_external_event_id(connection.id, item.id),
        title=_bounded(title, 300),
        description=_bounded("\n".join(description_parts), 5000),
        starts_at=item.starts_at,
        ends_at=item.ends_at,
        starts_on=item.starts_on,
        ends_on=item.ends_on,
        all_day=item.all_day,
        timezone=item.timezone,
        private_metadata={
            "recruitintelCalendarItemId": str(item.id),
            "recruitintelManaged": "true",
        },
    )


def provider_event_hash(event: ProviderEvent) -> str:
    canonical = event.model_dump(mode="json", exclude={"external_id"})
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class CalendarSyncWorker:
    def __init__(
        self,
        *,
        repository: PostgresCalendarSyncRepository,
        cipher: CredentialCipher,
        token_refresher: GoogleTokenRefresher,
        provider_factory: Callable[[str], CalendarProvider],
        app_url: str | None = None,
    ) -> None:
        self._repository = repository
        self._cipher = cipher
        self._token_refresher = token_refresher
        self._provider_factory = provider_factory
        self._app_url = app_url

    async def run(self, request_id: UUID) -> CalendarSyncStats:
        started = monotonic()
        connection, run_id = await self._repository.claim(request_id)
        stats = CalendarSyncStats(request_id=request_id, run_id=run_id)
        provider: CalendarProvider | None = None
        try:
            refresh_token = self._cipher.decrypt(connection.encrypted_refresh_token)
            access_token = await self._token_refresher.refresh(refresh_token)
            provider = self._provider_factory(access_token)
            items = await self._repository.list_items(connection.id)
            for item in items:
                stats.attempted_items += 1
                try:
                    await self._sync_item(provider, connection, item, stats)
                except (ProviderUnauthorizedError, ProviderRateLimitedError):
                    raise
                except CalendarProviderError as error:
                    if not error.retryable:
                        raise
                    stats.failed += 1
                    stats.errors.append({"itemId": str(item.id), "code": error.code})
                    if item.mapping:
                        await self._repository.mark_mapping(
                            item.mapping.id,
                            ExternalSyncStatus.ERROR,
                            error_code=error.code,
                        )
                except Exception:
                    stats.failed += 1
                    stats.errors.append({"itemId": str(item.id), "code": "ITEM_SYNC_FAILED"})
            stats.duration_ms = int((monotonic() - started) * 1000)
            if stats.failed:
                await self._repository.fail(
                    stats,
                    error_code="PARTIAL_PROVIDER_FAILURE",
                    reconnect_required=False,
                    retryable=True,
                    attempt_count=connection.attempt_count,
                    max_attempts=connection.max_attempts,
                )
                raise CalendarSyncPartialFailureError("one or more calendar items failed")
            await self._repository.complete(stats)
            return stats
        except (RefreshCredentialInvalidError, ProviderUnauthorizedError) as error:
            stats.duration_ms = int((monotonic() - started) * 1000)
            stats.errors.append({"code": error.code})
            await self._repository.fail(
                stats,
                error_code=error.code,
                reconnect_required=True,
                retryable=False,
                attempt_count=connection.attempt_count,
                max_attempts=connection.max_attempts,
            )
            raise
        except ProviderRateLimitedError as error:
            stats.duration_ms = int((monotonic() - started) * 1000)
            stats.errors.append({"code": error.code})
            await self._repository.fail(
                stats,
                error_code=error.code,
                reconnect_required=False,
                retryable=True,
                attempt_count=connection.attempt_count,
                max_attempts=connection.max_attempts,
            )
            raise
        except CalendarProviderError as error:
            stats.duration_ms = int((monotonic() - started) * 1000)
            stats.errors.append({"code": error.code})
            await self._repository.fail(
                stats,
                error_code=error.code,
                reconnect_required=False,
                retryable=error.retryable,
                attempt_count=connection.attempt_count,
                max_attempts=connection.max_attempts,
            )
            raise
        except CalendarSyncPartialFailureError:
            raise
        except Exception:
            stats.duration_ms = int((monotonic() - started) * 1000)
            stats.errors.append({"code": "CALENDAR_SYNC_FAILED"})
            await self._repository.fail(
                stats,
                error_code="CALENDAR_SYNC_FAILED",
                reconnect_required=False,
                retryable=True,
                attempt_count=connection.attempt_count,
                max_attempts=connection.max_attempts,
            )
            raise
        finally:
            if provider is not None:
                await provider.aclose()

    async def _sync_item(
        self,
        provider: CalendarProvider,
        connection: CalendarConnection,
        item: CalendarSyncItem,
        stats: CalendarSyncStats,
    ) -> None:
        mapping = item.mapping
        if not item.should_sync:
            if mapping and mapping.sync_status.value != "DELETED":
                await provider.delete_event(mapping.external_calendar_id, mapping.external_event_id)
                await self._repository.mark_mapping(mapping.id, ExternalSyncStatus.DELETED)
                stats.deleted += 1
            else:
                stats.unchanged += 1
            return
        event = provider_event_for(connection, item, app_url=self._app_url)
        content_hash = provider_event_hash(event)
        if mapping and mapping.last_synced_hash == content_hash:
            await self._repository.mark_mapping(
                mapping.id, ExternalSyncStatus.UNCHANGED, content_hash=content_hash
            )
            stats.unchanged += 1
            return
        if mapping:
            await provider.update_event(
                mapping.external_calendar_id, mapping.external_event_id, event
            )
            await self._repository.save_mapping(
                item_id=item.id,
                connection_id=connection.id,
                calendar_id=mapping.external_calendar_id,
                external_event_id=mapping.external_event_id,
                content_hash=content_hash,
            )
            stats.updated += 1
            return
        try:
            external_id = await provider.create_event(connection.selected_calendar_id, event)
        except EventAlreadyExistsError:
            await provider.get_event(connection.selected_calendar_id, event.external_id)
            external_id = event.external_id
        await self._repository.save_mapping(
            item_id=item.id,
            connection_id=connection.id,
            calendar_id=connection.selected_calendar_id,
            external_event_id=external_id,
            content_hash=content_hash,
            metadata={"idempotencyStrategy": "DETERMINISTIC_PROVIDER_EVENT_ID"},
        )
        stats.created += 1
