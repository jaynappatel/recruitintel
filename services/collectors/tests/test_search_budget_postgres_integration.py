import asyncio
import os
from uuid import UUID

import psycopg
import pytest
from recruitintel_collectors.infrastructure.search_budget import PostgresSearchUsageBudget
from recruitintel_collectors.public_web.search import (
    SearchProviderBudgetExceededError,
    SearchProviderPermanentError,
)

PRINCIPAL_ID = UUID("97800000-0000-0000-0000-000000000001")
CREDENTIAL_SLOT = "integration"


def database_url() -> str:
    value = os.getenv("TEST_DATABASE_URL")
    if not value:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return value


async def configure(
    url: str,
    *,
    daily_limit: int,
    monthly_limit_micros: int,
) -> None:
    async with await psycopg.AsyncConnection.connect(url) as connection:
        await connection.execute(
            "delete from public.search_provider_usage_daily "
            "where provider = 'you' and credential_slot = %s",
            (CREDENTIAL_SLOT,),
        )
        await connection.execute(
            """
            insert into public.service_principals (
              id, name, kind, token_prefix, token_hash, scopes, status
            ) values (
              %s, 'Search budget integration worker', 'WORKER',
              'ri_worker_SearchTest', encode(digest('search-budget-test', 'sha256'), 'hex'),
              array['WORKER_INGEST', 'WORKER_GLOBAL']::public.service_scope[], 'ACTIVE'
            ) on conflict (id) do update set status = 'ACTIVE', revoked_at = null
            """,
            (PRINCIPAL_ID,),
        )
        await connection.execute(
            """
            insert into public.worker_role_bindings (
              database_role, service_principal_id, allowed_work_classes, can_schedule
            ) values (
              current_user, %s, array['WEB_SEARCH']::public.work_class[], false
            ) on conflict (database_role) do update set
              service_principal_id = excluded.service_principal_id,
              allowed_work_classes = excluded.allowed_work_classes,
              can_schedule = false
            """,
            (PRINCIPAL_ID,),
        )
        await connection.execute(
            """
            insert into public.search_provider_budgets (
              provider, credential_slot, daily_request_limit,
              monthly_estimated_cost_limit_micros,
              estimated_cost_per_call_micros, enabled
            ) values ('you', %s, %s, %s, 5000, true)
            on conflict (provider, credential_slot) do update set
              daily_request_limit = excluded.daily_request_limit,
              monthly_estimated_cost_limit_micros = excluded.monthly_estimated_cost_limit_micros,
              estimated_cost_per_call_micros = excluded.estimated_cost_per_call_micros,
              enabled = true
            """,
            (CREDENTIAL_SLOT, daily_limit, monthly_limit_micros),
        )


async def cleanup(url: str) -> None:
    async with await psycopg.AsyncConnection.connect(url) as connection:
        await connection.execute(
            "delete from public.search_provider_usage_daily "
            "where provider = 'you' and credential_slot = %s",
            (CREDENTIAL_SLOT,),
        )
        await connection.execute(
            "delete from public.search_provider_budgets "
            "where provider = 'you' and credential_slot = %s",
            (CREDENTIAL_SLOT,),
        )
        await connection.execute(
            "delete from public.worker_role_bindings where service_principal_id = %s",
            (PRINCIPAL_ID,),
        )
        await connection.execute(
            "delete from public.service_principals where id = %s",
            (PRINCIPAL_ID,),
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_concurrent_daily_budget_reservation_allows_exactly_one_worker() -> None:
    url = database_url()
    await configure(url, daily_limit=1, monthly_limit_micros=50_000)
    budget = PostgresSearchUsageBudget(url)

    async def reserve() -> object:
        try:
            await budget.reserve(
                provider="you",
                credential_slot=CREDENTIAL_SLOT,
                provider_calls=1,
                estimated_cost_micros=5_000,
            )
            return "reserved"
        except Exception as error:
            return error

    try:
        outcomes = await asyncio.gather(reserve(), reserve())
        assert outcomes.count("reserved") == 1
        denied = next(item for item in outcomes if item != "reserved")
        assert isinstance(denied, SearchProviderBudgetExceededError)
        assert denied.period == "DAILY"
        async with await psycopg.AsyncConnection.connect(url) as connection:
            cursor = await connection.execute(
                """
                select request_count, estimated_cost_micros
                from public.search_provider_usage_daily
                where provider = 'you' and credential_slot = %s
                  and usage_date = (now() at time zone 'UTC')::date
                """,
                (CREDENTIAL_SLOT,),
            )
            row = await cursor.fetchone()
        assert row == (1, 5_000)
    finally:
        await cleanup(url)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_daily_monthly_rollover_and_monthly_cost_limit() -> None:
    url = database_url()
    await configure(url, daily_limit=10, monthly_limit_micros=5_000)
    budget = PostgresSearchUsageBudget(url)
    try:
        async with await psycopg.AsyncConnection.connect(url) as connection:
            await connection.execute(
                """
                insert into public.search_provider_usage_daily (
                  provider, credential_slot, usage_date, request_count,
                  estimated_cost_micros
                ) values
                  ('you', %s, (now() at time zone 'UTC')::date - 1, 999, 0),
                  ('you', %s,
                    (date_trunc('month', now() at time zone 'UTC') - interval '1 day')::date,
                    0, 999999999)
                """,
                (CREDENTIAL_SLOT, CREDENTIAL_SLOT),
            )
        await budget.reserve(
            provider="you",
            credential_slot=CREDENTIAL_SLOT,
            provider_calls=1,
            estimated_cost_micros=5_000,
        )
        with pytest.raises(SearchProviderBudgetExceededError) as caught:
            await budget.reserve(
                provider="you",
                credential_slot=CREDENTIAL_SLOT,
                provider_calls=1,
                estimated_cost_micros=5_000,
            )
        assert caught.value.period == "MONTHLY"
    finally:
        await cleanup(url)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_disabled_or_unknown_budget_fails_closed() -> None:
    url = database_url()
    await configure(url, daily_limit=10, monthly_limit_micros=50_000)
    try:
        async with await psycopg.AsyncConnection.connect(url) as connection:
            await connection.execute(
                """
                update public.search_provider_budgets set enabled = false
                where provider = 'you' and credential_slot = %s
                """,
                (CREDENTIAL_SLOT,),
            )
        with pytest.raises(SearchProviderPermanentError) as caught:
            await PostgresSearchUsageBudget(url).reserve(
                provider="you",
                credential_slot=CREDENTIAL_SLOT,
                provider_calls=1,
                estimated_cost_micros=5_000,
            )
        assert caught.value.code == "SEARCH_PROVIDER_BUDGET_NOT_CONFIGURED"
    finally:
        await cleanup(url)
