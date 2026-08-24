from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from recruitintel_collectors.public_web.search import (
    SearchProviderBudgetExceededError,
    SearchProviderPermanentError,
)


class PostgresSearchUsageBudget:
    """Atomically reserves billable calls before they can reach a provider."""

    def __init__(self, database_url: str) -> None:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        self.database_url = database_url

    async def reserve(
        self,
        *,
        provider: str,
        credential_slot: str,
        provider_calls: int,
        estimated_cost_micros: int,
    ) -> None:
        try:
            async with await psycopg.AsyncConnection.connect(
                self.database_url, row_factory=dict_row
            ) as connection:
                cursor = await connection.execute(
                    """
                    select * from public.reserve_search_provider_usage(%s, %s, %s, %s)
                    """,
                    (provider, credential_slot, provider_calls, estimated_cost_micros),
                )
                row: dict[str, Any] | None = await cursor.fetchone()
        except psycopg.errors.RaiseException as exc:
            raise SearchProviderPermanentError("SEARCH_PROVIDER_BUDGET_NOT_CONFIGURED") from exc
        if row is None:
            raise RuntimeError("search provider budget reservation returned no result")
        if row["reserved"]:
            return
        retry_at = row["retry_at"]
        if not isinstance(retry_at, datetime):
            raise RuntimeError("search provider budget denial omitted retry time")
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=UTC)
        retry_after_seconds = max(
            1,
            min(int((retry_at.astimezone(UTC) - datetime.now(UTC)).total_seconds()), 604_800),
        )
        period = "MONTHLY" if row["denial_reason"] == "MONTHLY_COST_LIMIT" else "DAILY"
        raise SearchProviderBudgetExceededError(retry_after_seconds, period=period)
