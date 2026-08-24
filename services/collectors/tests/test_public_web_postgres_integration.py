import os
from pathlib import Path
from uuid import UUID

import psycopg
import pytest
from psycopg.rows import dict_row
from recruitintel_collectors.infrastructure.public_web_postgres import PostgresPublicWebRepository
from recruitintel_collectors.public_web.models import FetchedDocument, SearchResult
from recruitintel_collectors.public_web.runner import PublicWebWorker
from recruitintel_collectors.public_web.search import StaticSearchProvider

FIXTURES = Path(__file__).parent / "fixtures"
COMPANY_ID = UUID("c1000000-0000-0000-0000-000000000001")
SEARCH_SOURCE_ID = UUID("c2000000-0000-0000-0000-000000000001")
QUERY_ID = UUID("c3000000-0000-0000-0000-000000000001")
SEARCH_REQUEST_ID = UUID("c4000000-0000-0000-0000-000000000001")
QUERY = '"Stripe Integration" internship 2027'


def _database_url() -> str:
    value = os.getenv("TEST_DATABASE_URL")
    if not value:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return value


class SyntheticFetcher:
    def __init__(self) -> None:
        self.official_fixture = "web_official_internship_v1.html"
        self.fetch_count = 0

    async def fetch(self, url: str) -> FetchedDocument:
        self.fetch_count += 1
        fixture = (
            self.official_fixture if "stripe.com" in url else "web_university_career_fair.html"
        )
        return FetchedDocument(
            requested_url=url,
            final_url=url,
            status_code=200,
            content_type="text/html",
            body=(FIXTURES / fixture).read_text(encoding="utf-8"),
        )


async def _reset(database_url: str) -> None:
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        await connection.execute("delete from public.companies where id = %s", (COMPANY_ID,))


async def _seed(database_url: str) -> None:
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        await connection.execute(
            """
            update public.source_policies set
              status = 'ALLOWED_WITH_LIMITS', terms_status = 'REVIEWED',
              reviewed_at = now(), reviewed_by = 'integration-test'
            where provider in ('web_search', 'public_web')
            """
        )
        await connection.execute(
            """
            insert into public.source_policy_host_rules (
              source_policy_id, hostname_suffix, allow_subdomains
            )
            select id, host, false from public.source_policies
            cross join (values ('stripe.com'), ('careerengagement.utexas.edu')) fixture(host)
            where provider = 'public_web'
            on conflict (source_policy_id, hostname_suffix) do nothing
            """
        )
        await connection.execute(
            """
            insert into public.companies (id, canonical_name, slug, website, careers_url)
            values (
              %s, 'Stripe Integration', 'web-integration-stripe',
              'https://stripe.com', 'https://stripe.com/jobs'
            )
            """,
            (COMPANY_ID,),
        )
        await connection.execute(
            "insert into public.company_domains (company_id, domain) values (%s, 'stripe.com')",
            (COMPANY_ID,),
        )
        await connection.execute(
            """
            insert into public.sources (
              id, company_id, source_type, provider, external_key, name, reliability,
              source_policy_id
            ) values (
              %s, %s, 'PUBLIC_WEB', 'web_search',
              'static:web-integration-stripe', 'Synthetic static search', 0.500,
              (select id from public.source_policies where provider = 'web_search')
            )
            """,
            (SEARCH_SOURCE_ID, COMPANY_ID),
        )
        await connection.execute(
            """
            insert into public.public_web_search_queries (
              id, company_id, source_id, provider, template_key, query,
              graduation_year, focus, minimum_interval_seconds, max_results, max_fetches
            ) values (
              %s, %s, %s, 'static', 'internship', %s,
              2027, 'INTERNSHIP', 86400, 10, 5
            )
            """,
            (QUERY_ID, COMPANY_ID, SEARCH_SOURCE_ID, QUERY),
        )
        await connection.execute(
            """
            insert into public.public_web_work_requests (
              id, work_type, company_id, search_query_id, requested_by
            ) values (%s, 'WEB_SEARCH', %s, %s, 'integration-test')
            """,
            (SEARCH_REQUEST_ID, COMPANY_ID, QUERY_ID),
        )


async def _pending_requests(database_url: str, work_type: str) -> list[UUID]:
    async with await psycopg.AsyncConnection.connect(
        database_url, row_factory=dict_row
    ) as connection:
        cursor = await connection.execute(
            """
            select id from public.public_web_work_requests
            where company_id = %s and work_type = %s and status = 'PENDING'
            order by requested_at, id
            """,
            (COMPANY_ID, work_type),
        )
        return [UUID(str(row["id"])) for row in await cursor.fetchall()]


async def _enqueue_fetch(database_url: str, candidate_id: UUID) -> UUID:
    async with await psycopg.AsyncConnection.connect(
        database_url, row_factory=dict_row
    ) as connection:
        cursor = await connection.execute(
            """
            insert into public.public_web_work_requests (
              work_type, company_id, candidate_id, requested_by
            ) values ('WEB_FETCH', %s, %s, 'integration-test')
            returning id
            """,
            (COMPANY_ID, candidate_id),
        )
        row = await cursor.fetchone()
        assert row is not None
        return UUID(str(row["id"]))


async def _retire_domain_test_work(database_url: str, request_id: UUID) -> None:
    """Domain-worker tests do not bypass orchestration in production."""
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        await connection.execute(
            "delete from public.work_items where public_web_work_request_id = %s",
            (request_id,),
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_public_web_end_to_end_change_conflict_and_retry_idempotency() -> None:
    database_url = _database_url()
    await _reset(database_url)
    await _seed(database_url)
    repository = PostgresPublicWebRepository(database_url)
    fetcher = SyntheticFetcher()
    provider = StaticSearchProvider(
        {
            QUERY: [
                SearchResult(
                    url="https://stripe.com/jobs/university/internships?utm_source=one",
                    title="Stripe internships",
                    snippet="Applications open September 1, 2026.",
                    rank=1,
                ),
                SearchResult(
                    url="https://stripe.com/jobs/university/internships?utm_medium=duplicate",
                    title="Duplicate Stripe result",
                    rank=2,
                ),
                SearchResult(
                    url="https://careerengagement.utexas.edu/events/stripe-fair",
                    title="UT Austin career fair",
                    rank=3,
                ),
            ]
        }
    )
    worker = PublicWebWorker(
        repository=repository,
        search_providers={provider.name: provider},
        fetcher=fetcher,
    )
    try:
        search = await worker.run(SEARCH_REQUEST_ID)
        await _retire_domain_test_work(database_url, SEARCH_REQUEST_ID)
        assert search.candidates == 2

        fetch_requests = await _pending_requests(database_url, "WEB_FETCH")
        assert len(fetch_requests) == 2
        for request_id in fetch_requests:
            result = await worker.run(request_id)
            await _retire_domain_test_work(database_url, request_id)
            assert result.fetched == 1
            assert not result.unchanged
        for request_id in await _pending_requests(database_url, "WEB_PROCESS"):
            await worker.run(request_id)
            await _retire_domain_test_work(database_url, request_id)

        async with await psycopg.AsyncConnection.connect(
            database_url, row_factory=dict_row
        ) as connection:
            cursor = await connection.execute(
                """
                select id from public.public_web_candidates
                where company_id = %s and canonical_url like 'https://stripe.com/%%'
                """,
                (COMPANY_ID,),
            )
            official = await cursor.fetchone()
            assert official is not None
            official_id = UUID(str(official["id"]))

        fetcher.official_fixture = "web_official_internship_v2.html"
        changed_fetch = await _enqueue_fetch(database_url, official_id)
        await worker.run(changed_fetch)
        await _retire_domain_test_work(database_url, changed_fetch)
        changed_process = await _pending_requests(database_url, "WEB_PROCESS")
        assert len(changed_process) == 1
        changed = await worker.run(changed_process[0])
        await _retire_domain_test_work(database_url, changed_process[0])
        assert changed.observations_created >= 1
        assert changed.events_created >= 2

        unchanged_fetch = await _enqueue_fetch(database_url, official_id)
        unchanged = await worker.run(unchanged_fetch)
        await _retire_domain_test_work(database_url, unchanged_fetch)
        assert unchanged.unchanged
        assert not await _pending_requests(database_url, "WEB_PROCESS")

        async with await psycopg.AsyncConnection.connect(
            database_url, row_factory=dict_row
        ) as connection:
            cursor = await connection.execute(
                """
                select
                  (select count(*) from public.public_web_candidates
                    where company_id = %s)::int candidates,
                  (select count(*) from public.public_web_documents d
                    join public.public_web_candidates c on c.id = d.candidate_id
                    where c.company_id = %s)::int documents,
                  (select count(*) from public.public_recruiting_observations
                    where company_id = %s)::int observations,
                  (select count(*) from public.recruiting_events
                    where company_id = %s and public_web_candidate_id is not null)::int events
                """,
                (COMPANY_ID, COMPANY_ID, COMPANY_ID, COMPANY_ID),
            )
            counts = await cursor.fetchone()
            assert counts is not None
            assert counts["candidates"] == 2
            assert counts["documents"] == 3
            assert counts["observations"] >= 5
            event_count = counts["events"]

            claims = await connection.execute(
                """
                select status::text, metadata
                from public.public_recruiting_claims
                where company_id = %s and claim_type = 'APPLICATION_DATE'
                """,
                (COMPANY_ID,),
            )
            claim = await claims.fetchone()
            assert claim is not None
            assert claim["status"] == "CONFLICTING"
            assert claim["metadata"]["distinct_date_count"] == 2

            projection = await connection.execute(
                """
                select o.id, o.observation_type::text as type, o.title, o.summary,
                       o.occurred_at, o.date_precision::text as date_precision,
                       o.date_certainty::text as date_certainty, o.confidence,
                       s.name as source_name, s.source_type::text as source_type,
                       o.reliability_level::text as reliability, o.source_url
                from public.public_recruiting_observations o
                join public.sources s on s.id = o.source_id
                where o.company_id = %s
                order by o.last_verified_at desc
                """,
                (COMPANY_ID,),
            )
            api_rows = await projection.fetchall()
            assert api_rows
            assert {"id", "type", "title", "summary", "source_name", "source_url"} <= set(
                api_rows[0]
            )

        second_unchanged = await _enqueue_fetch(database_url, official_id)
        await worker.run(second_unchanged)
        await _retire_domain_test_work(database_url, second_unchanged)
        async with await psycopg.AsyncConnection.connect(
            database_url, row_factory=dict_row
        ) as connection:
            cursor = await connection.execute(
                """
                select count(*)::int events from public.recruiting_events
                where company_id = %s and public_web_candidate_id is not null
                """,
                (COMPANY_ID,),
            )
            final = await cursor.fetchone()
            assert final is not None
            assert final["events"] == event_count
    finally:
        await _reset(database_url)
