import hashlib
import os
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import dict_row
from recruitintel_collectors.opportunities import PostgresOpportunityResolver


def _database_url() -> str:
    value = os.getenv("TEST_DATABASE_URL")
    if not value:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return value


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def _insert_job(
    cursor: psycopg.AsyncCursor[dict[str, object]],
    *,
    company_id: UUID,
    source_id: UUID,
    external_id: str,
    title: str,
    application_url: str,
    season: str | None = "SUMMER 2027",
    location: str = "San Mateo, CA",
) -> UUID:
    row = await (
        await cursor.execute(
            """
            insert into public.jobs (
              company_id, source_id, external_id, title, description, location,
              employment_type, role_family, experience_level, is_internship,
              season, graduation_years, application_url, source_url, content_hash,
              source_content_hash, source_content_version, derivation_hash,
              derivation_version, raw_payload
            ) values (
              %s, %s, %s, %s, 'Build developer platform systems with Python.',
              %s, 'INTERNSHIP', 'SOFTWARE_ENGINEERING', 'INTERNSHIP', true,
              %s, '{2027}', %s, %s, %s, %s, 2, %s, 1, '{}'
            ) returning id
            """,
            (
                company_id,
                source_id,
                external_id,
                title,
                location,
                season,
                application_url,
                application_url,
                _hash(f"source:{source_id}:{external_id}"),
                _hash(f"source:{source_id}:{external_id}"),
                _hash(f"derivation:{source_id}:{external_id}"),
            ),
        )
    ).fetchone()
    if row is None:
        raise AssertionError("job insert returned no ID")
    return UUID(str(row["id"]))


@pytest.mark.integration
@pytest.mark.asyncio
async def test_exact_graph_resolution_lifecycle_and_candidate_bounds() -> None:
    database_url = _database_url()
    company_id = uuid4()
    other_company_id = uuid4()
    greenhouse_source_id = uuid4()
    other_greenhouse_source_id = uuid4()
    github_source_id = uuid4()
    jsonld_source_id = uuid4()
    suffix = company_id.hex[:12]
    application_url = f"https://boards.greenhouse.io/{suffix}/jobs/123"

    async with await psycopg.AsyncConnection.connect(
        database_url, row_factory=dict_row
    ) as connection:
        cursor = connection.cursor()
        await cursor.execute(
            """
            update public.source_policies set status = 'ALLOWED_WITH_LIMITS',
              terms_status = 'REVIEWED', reviewed_at = now(),
              reviewed_by = 'm8-integration-fixture'
            where provider in ('greenhouse', 'github', 'public_web')
            """
        )
        await cursor.execute(
            """
            insert into public.companies (id, canonical_name, slug, website, careers_url)
            values (%s, %s, %s, %s, %s), (%s, %s, %s, %s, %s)
            """,
            (
                company_id,
                f"M8 Exact Graph {suffix}",
                f"m8-exact-{suffix}",
                f"https://{suffix}.example.test",
                f"https://{suffix}.example.test/careers",
                other_company_id,
                f"M8 Other {suffix}",
                f"m8-other-{suffix}",
                f"https://other-{suffix}.example.test",
                f"https://other-{suffix}.example.test/careers",
            ),
        )
        for source_id, source_type, provider, external_key, reliability in (
            (greenhouse_source_id, "ATS", "greenhouse", suffix, 0.99),
            (github_source_id, "GITHUB", "github", f"m8-list-{suffix}", 0.70),
            (
                jsonld_source_id,
                "COMPANY_CAREERS",
                "public_web",
                f"m8-jsonld-{suffix}",
                0.95,
            ),
            (other_greenhouse_source_id, "ATS", "greenhouse", f"other-{suffix}", 0.99),
        ):
            await cursor.execute(
                """
                insert into public.sources (
                  id, company_id, source_type, provider, external_key, name, base_url,
                  reliability, source_policy_id
                ) values (
                  %s, %s, %s, %s, %s, %s, %s, %s,
                  (select id from public.source_policies where provider = %s)
                )
                """,
                (
                    source_id,
                    other_company_id if source_id == other_greenhouse_source_id else company_id,
                    source_type,
                    provider,
                    external_key,
                    f"M8 {provider} fixture",
                    application_url,
                    reliability,
                    provider,
                ),
            )
        await cursor.execute(
            """
            update public.source_job_capabilities set
              authority = 'OFFICIAL_ATS', reviewed = true, reviewed_at = now(),
              reviewed_by = 'm8-integration-fixture', supports_posting_status = true,
              supports_complete_listing = true, absence_can_close = true,
              validated_application_hosts = '{boards.greenhouse.io}', freshness_seconds = 86400
            where source_id = %s
            """,
            (greenhouse_source_id,),
        )
        await cursor.execute(
            """
            update public.source_job_capabilities set
              authority = 'OFFICIAL_COMPANY', reviewed = true, reviewed_at = now(),
              reviewed_by = 'm8-integration-fixture', supports_posting_status = true,
              supports_complete_listing = true, absence_can_close = true,
              validated_application_hosts = '{boards.greenhouse.io}', freshness_seconds = 86400
            where source_id = %s
            """,
            (jsonld_source_id,),
        )
        await cursor.execute(
            """
            update public.source_job_capabilities set
              authority = 'COMMUNITY', reviewed = true, reviewed_at = now(),
              reviewed_by = 'm8-integration-fixture', freshness_seconds = 86400
            where source_id = %s
            """,
            (github_source_id,),
        )
        greenhouse_job = await _insert_job(
            cursor,
            company_id=company_id,
            source_id=greenhouse_source_id,
            external_id="123",
            title="Software Engineer Intern - Summer 2027",
            application_url=application_url,
        )
        github_job = await _insert_job(
            cursor,
            company_id=company_id,
            source_id=github_source_id,
            external_id="list-line-12",
            title="Roblox SWE Intern 2027",
            application_url=f"{application_url}?utm_source=github",
        )
        jsonld_job = await _insert_job(
            cursor,
            company_id=company_id,
            source_id=jsonld_source_id,
            external_id="jsonld-123",
            title="Software Engineer Intern - Summer 2027",
            application_url=f"{application_url}#apply",
        )

    resolver = PostgresOpportunityResolver(database_url)
    # Exact keys are not fabricated for unresolved peers. The same-title JSON-LD row
    # therefore creates review work until another posting exposes the exact URL key.
    assert (await resolver.resolve_job(greenhouse_job)).outcome == "REVIEW_REQUIRED"
    assert (await resolver.resolve_job(github_job)).outcome == "MATCH"
    assert (await resolver.resolve_job(jsonld_job)).outcome == "MATCH"
    retry = await resolver.resolve_job(jsonld_job)
    assert retry.reason_codes == ("ACTIVE_MEMBERSHIP_ALREADY_RESOLVED",)

    async with await psycopg.AsyncConnection.connect(
        database_url, row_factory=dict_row
    ) as connection:
        cursor = connection.cursor()
        result = await (
            await cursor.execute(
                """
                select opportunity.id, opportunity.canonical_application_url,
                  opportunity.lifecycle_status::text,
                  count(membership.id)::int as sources
                from public.job_opportunities opportunity
                join public.job_opportunity_postings membership
                  on membership.opportunity_id = opportunity.id and membership.valid_to is null
                where opportunity.company_id = %s and opportunity.status = 'ACTIVE'
                group by opportunity.id
                """,
                (company_id,),
            )
        ).fetchall()
        assert len(result) == 1
        opportunity = result[0]
        assert opportunity["sources"] == 3
        assert opportunity["canonical_application_url"] == application_url
        assert opportunity["lifecycle_status"] == "OPEN"

        # Weak disappearance never closes while fresh official evidence remains open.
        await cursor.execute(
            "update public.jobs set closed_at = now() where id = %s", (github_job,)
        )
        await cursor.execute("select public.recompute_job_opportunity(%s)", (opportunity["id"],))
        state = await (
            await cursor.execute(
                "select lifecycle_status::text from public.job_opportunities where id = %s",
                (opportunity["id"],),
            )
        ).fetchone()
        assert state and state["lifecycle_status"] == "OPEN"

        # Complete, reviewed authoritative closure is required for CLOSED.
        for job_id, source_id in (
            (greenhouse_job, greenhouse_source_id),
            (jsonld_job, jsonld_source_id),
        ):
            await cursor.execute(
                "update public.jobs set closed_at = now() where id = %s", (job_id,)
            )
            await cursor.execute(
                """
                insert into public.source_collection_evidence (
                  source_id, coverage, successful, absence_evidence_valid,
                  capability_version, fingerprint
                ) values (%s, 'COMPLETE', true, true, 1, %s)
                """,
                (source_id, _hash(f"complete-close:{source_id}")),
            )
        await cursor.execute("select public.recompute_job_opportunity(%s)", (opportunity["id"],))
        closed = await (
            await cursor.execute(
                "select lifecycle_status::text from public.job_opportunities where id = %s",
                (opportunity["id"],),
            )
        ).fetchone()
        assert closed and closed["lifecycle_status"] == "CLOSED"

        # Stale-only evidence becomes UNKNOWN rather than an assumed closure.
        await cursor.execute(
            """
            update public.jobs set first_seen_at = now() - interval '31 days',
              last_seen_at = now() - interval '30 days'
            where id in (%s, %s, %s)
            """,
            (greenhouse_job, github_job, jsonld_job),
        )
        await cursor.execute("select public.recompute_job_opportunity(%s)", (opportunity["id"],))
        stale = await (
            await cursor.execute(
                "select lifecycle_status::text from public.job_opportunities where id = %s",
                (opportunity["id"],),
            )
        ).fetchone()
        assert stale and stale["lifecycle_status"] == "UNKNOWN"

        # Same title without an exact key is review-only, never an automatic merge.
        separate_one = await _insert_job(
            cursor,
            company_id=company_id,
            source_id=greenhouse_source_id,
            external_id="separate-1",
            title="Software Engineer Intern",
            application_url=f"https://boards.greenhouse.io/{suffix}/jobs/separate-1",
            season="SUMMER 2027",
        )
        separate_two = await _insert_job(
            cursor,
            company_id=company_id,
            source_id=greenhouse_source_id,
            external_id="separate-2",
            title="Software Engineer Intern",
            application_url=f"https://boards.greenhouse.io/{suffix}/jobs/separate-2",
            season="FALL 2027",
        )
        separate_location = await _insert_job(
            cursor,
            company_id=company_id,
            source_id=greenhouse_source_id,
            external_id="separate-location",
            title="Software Engineer Intern",
            application_url=f"https://boards.greenhouse.io/{suffix}/jobs/separate-location",
            season="SUMMER 2027",
            location="New York, NY",
        )
        other_company_job = await _insert_job(
            cursor,
            company_id=other_company_id,
            source_id=other_greenhouse_source_id,
            external_id="separate-1",
            title="Software Engineer Intern",
            application_url=f"https://boards.greenhouse.io/other-{suffix}/jobs/separate-1",
        )

    await resolver.resolve_job(separate_one)
    review_result = await resolver.resolve_job(separate_two)
    assert review_result.outcome == "REVIEW_REQUIRED"
    location_result = await resolver.resolve_job(separate_location)
    assert location_result.outcome == "REVIEW_REQUIRED"
    assert (await resolver.resolve_job(other_company_job)).outcome == "NO_MATCH"

    async with await psycopg.AsyncConnection.connect(
        database_url, row_factory=dict_row
    ) as connection:
        cursor = connection.cursor()
        memberships = await (
            await cursor.execute(
                """
                select count(distinct opportunity_id)::int as count
                from public.job_opportunity_postings
                where job_id in (%s, %s, %s) and valid_to is null
                """,
                (separate_one, separate_two, separate_location),
            )
        ).fetchone()
        assert memberships and memberships["count"] == 3
        await cursor.execute("set enable_seqscan = off")
        comparisons = await (
            await cursor.execute(
                """
                explain (format json, costs off)
                select candidate.job_id
                from public.job_identity_keys own
                join public.job_identity_keys candidate
                  on candidate.company_id = own.company_id
                 and candidate.key_type = own.key_type
                 and candidate.key_hash = own.key_hash
                where own.job_id = %s and own.validated limit 51
                """,
                (separate_two,),
            )
        ).fetchone()
        assert comparisons is not None
        plan = str(comparisons["QUERY PLAN"])
        assert "Index Scan" in plan
        assert "Seq Scan" not in plan
