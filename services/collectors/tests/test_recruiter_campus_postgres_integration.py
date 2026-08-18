import os
from datetime import UTC, datetime
from uuid import UUID

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from recruitintel_collectors.infrastructure.recruiter_campus_postgres import (
    PostgresRecruiterCampusRepository,
)

COMPANY_ID = UUID("d1000000-0000-0000-0000-000000000001")
SCHOOL_ID = UUID("d2000000-0000-0000-0000-000000000001")
OBSERVATION_ONE_ID = UUID("d3000000-0000-0000-0000-000000000001")
OBSERVATION_TWO_ID = UUID("d3000000-0000-0000-0000-000000000002")
OBSERVATION_UNRESOLVED_ID = UUID("d3000000-0000-0000-0000-000000000003")
OBSERVED_AT = datetime(2026, 8, 18, tzinfo=UTC)


def _database_url() -> str:
    value = os.getenv("TEST_DATABASE_URL")
    if not value:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return value


async def _reset(database_url: str) -> None:
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        await connection.execute(
            "delete from public.recruiter_profiles where company_id = %s", (COMPANY_ID,)
        )
        await connection.execute(
            "delete from public.campus_recruiting_events where company_id = %s",
            (COMPANY_ID,),
        )
        await connection.execute(
            "delete from public.unresolved_recruiter_observations where company_id = %s",
            (COMPANY_ID,),
        )
        await connection.execute("delete from public.companies where id = %s", (COMPANY_ID,))
        await connection.execute("delete from public.schools where id = %s", (SCHOOL_ID,))


async def _insert_observation(
    connection: psycopg.AsyncConnection[dict[str, object]],
    *,
    suffix: str,
    observation_id: UUID,
    source_type: str,
    reliability: str,
    title: str,
    evidence: str,
    confidence: float,
) -> None:
    source_id = UUID(f"d4{suffix}00000-0000-0000-0000-000000000001")
    candidate_id = UUID(f"d5{suffix}00000-0000-0000-0000-000000000001")
    document_id = UUID(f"d6{suffix}00000-0000-0000-0000-000000000001")
    source_url = f"https://example{suffix}.edu/events/stripe-expo"
    await connection.execute(
        """
        insert into public.sources (
          id, company_id, source_type, provider, external_key, name, base_url, reliability
        ) values (%s, %s, %s, 'm4_test', %s, %s, %s, %s)
        """,
        (
            source_id,
            COMPANY_ID,
            source_type,
            f"m4-{suffix}",
            f"M4 source {suffix}",
            source_url,
            confidence,
        ),
    )
    await connection.execute(
        """
        insert into public.public_web_candidates (
          id, company_id, source_id, source_provider, original_url, canonical_url,
          fetch_status, content_hash, relevance_status
        ) values (%s, %s, %s, 'm4_test', %s, %s, 'FETCHED', %s, 'RELEVANT')
        """,
        (candidate_id, COMPANY_ID, source_id, source_url, source_url, suffix * 64),
    )
    await connection.execute(
        """
        insert into public.public_web_documents (
          id, candidate_id, content_hash, fetched_at, final_url, http_status,
          content_type, title, extracted_text
        ) values (%s, %s, %s, %s, %s, 200, 'text/html', %s, %s)
        """,
        (document_id, candidate_id, suffix * 64, OBSERVED_AT, source_url, title, evidence),
    )
    await connection.execute(
        """
        insert into public.public_recruiting_observations (
          id, company_id, source_id, candidate_id, document_id, school_id,
          observation_type, title, summary, evidence_text, source_url,
          source_classification, reliability_level, date_start, date_precision,
          date_certainty, discovered_at, last_verified_at, confidence, content_hash,
          metadata, fingerprint
        ) values (
          %s, %s, %s, %s, %s, %s, 'CAREER_FAIR', %s, %s, %s, %s,
          %s, %s, '2026-09-15', 'EXACT', 'CONFIRMED', %s, %s, %s, %s, %s, %s
        )
        """,
        (
            observation_id,
            COMPANY_ID,
            source_id,
            candidate_id,
            document_id,
            SCHOOL_ID if suffix != "3" else None,
            title,
            evidence,
            evidence,
            source_url,
            "UNIVERSITY" if source_type == "UNIVERSITY" else "COMPANY_PUBLIC_PAGE",
            reliability,
            OBSERVED_AT,
            OBSERVED_AT,
            confidence,
            suffix * 64,
            Jsonb({"integration_test": True}),
            ("f" + suffix) * 32,
        ),
    )


async def _seed(database_url: str) -> None:
    async with await psycopg.AsyncConnection.connect(
        database_url, row_factory=dict_row
    ) as connection:
        await connection.execute(
            """
            insert into public.companies (id, canonical_name, slug, website, careers_url)
            values (
              %s, 'Stripe', 'm4-stripe-campus',
              'https://stripe.com', 'https://stripe.com/jobs'
            )
            """,
            (COMPANY_ID,),
        )
        await connection.execute(
            """
            insert into public.schools (
              id, canonical_name, slug, website, domains, aliases, city,
              state_region, country
            ) values (
              %s, 'University of Texas at Austin', 'm4-ut-austin',
              'https://utexas.edu', '{utexas.edu}',
              '{"UT Austin","The University of Texas at Austin"}',
              'Austin', 'Texas', 'US'
            )
            """,
            (SCHOOL_ID,),
        )
        await connection.execute(
            """
            insert into public.school_aliases (school_id, alias, normalized_alias)
            values
              (%s, 'University of Texas at Austin', 'university of texas at austin'),
              (%s, 'UT Austin', 'ut austin')
            """,
            (SCHOOL_ID, SCHOOL_ID),
        )
        await _insert_observation(
            connection,
            suffix="1",
            observation_id=OBSERVATION_ONE_ID,
            source_type="UNIVERSITY",
            reliability="HIGH",
            title="Stripe at Engineering Expo",
            evidence=(
                "Jane Smith, University Recruiter at Stripe, will join UT Austin's "
                "Engineering Expo for software engineering students on September 15, 2026."
            ),
            confidence=0.85,
        )
        await _insert_observation(
            connection,
            suffix="2",
            observation_id=OBSERVATION_TWO_ID,
            source_type="COMPANY_CAREERS",
            reliability="OFFICIAL",
            title="Stripe at Engineering Expo",
            evidence=(
                "Jane Smith, Technical Recruiter at Stripe, will join UT Austin's "
                "Engineering Expo for software engineering students on September 15, 2026."
            ),
            confidence=0.98,
        )
        await _insert_observation(
            connection,
            suffix="3",
            observation_id=OBSERVATION_UNRESOLVED_ID,
            source_type="PUBLIC_WEB",
            reliability="LOW",
            title="Campus recruiting event",
            evidence=(
                "Our recruiting team will visit Example State University for a recruiting event."
            ),
            confidence=0.35,
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_recruiter_campus_observation_graph_and_retry_idempotency() -> None:
    database_url = _database_url()
    await _reset(database_url)
    await _seed(database_url)
    repository = PostgresRecruiterCampusRepository(database_url)
    try:
        first = await repository.process_observation(OBSERVATION_ONE_ID)
        assert first.people_created == 1
        assert first.recruiters_created == 1
        assert first.evidence_created == 2
        assert first.school_links_created == 1
        assert first.role_links_created == 1
        assert first.campus_events_created == 1

        retry = await repository.process_observation(OBSERVATION_ONE_ID)
        assert retry.people_created == 0
        assert retry.recruiters_created == 0
        assert retry.evidence_created == 0
        assert retry.campus_events_created == 0
        assert retry.events_created == 0

        second = await repository.process_observation(OBSERVATION_TWO_ID)
        assert second.people_created == 0
        assert second.recruiters_created == 0
        assert second.evidence_created == 2
        assert second.campus_events_created == 0

        unresolved = await repository.process_observation(OBSERVATION_UNRESOLVED_ID)
        assert unresolved.unresolved_created == 2

        async with await psycopg.AsyncConnection.connect(
            database_url, row_factory=dict_row
        ) as connection:
            cursor = await connection.execute(
                """
                select
                  (select count(*) from public.people p
                    join public.recruiter_profiles rp on rp.person_id = p.id
                    where rp.company_id = %s)::int people,
                  (select count(*) from public.recruiter_profiles
                    where company_id = %s)::int profiles,
                  (select count(*) from public.recruiter_evidence e
                    join public.recruiter_profiles rp on rp.id = e.recruiter_profile_id
                    where rp.company_id = %s)::int evidence,
                  (select count(*) from public.campus_recruiting_events
                    where company_id = %s)::int campus_events,
                  (select count(*) from public.campus_recruiting_event_evidence ce
                    join public.campus_recruiting_events e on e.id = ce.campus_event_id
                    where e.company_id = %s)::int campus_event_sources,
                  (select count(*) from public.unresolved_recruiter_observations
                    where company_id = %s)::int unresolved,
                  (select count(*) from public.recruiting_events
                    where company_id = %s
                      and recruiter_profile_id is not null)::int recruiter_events
                """,
                (COMPANY_ID,) * 7,
            )
            counts = await cursor.fetchone()
            assert counts == {
                "people": 1,
                "profiles": 1,
                "evidence": 4,
                "campus_events": 2,
                "campus_event_sources": 3,
                "unresolved": 2,
                "recruiter_events": 5,
            }
            profile_cursor = await connection.execute(
                """
                select p.canonical_name, rp.title, rp.categories::text[], rp.status::text,
                       rs.strength::text school_strength, rs.evidence_count school_evidence,
                       rf.strength::text role_strength, rf.role_family::text
                from public.recruiter_profiles rp
                join public.people p on p.id = rp.person_id
                join public.recruiter_school_relationships rs
                  on rs.recruiter_profile_id = rp.id
                join public.recruiter_role_focus rf on rf.recruiter_profile_id = rp.id
                where rp.company_id = %s
                """,
                (COMPANY_ID,),
            )
            profile = await profile_cursor.fetchone()
            assert profile is not None
            assert profile["canonical_name"] == "Jane Smith"
            assert profile["title"] == "Technical Recruiter"
            assert set(profile["categories"]) == {
                "UNIVERSITY_RECRUITING",
                "TECHNICAL_RECRUITING",
            }
            assert profile["status"] == "ACTIVE"
            assert profile["school_strength"] == "HIGH"
            assert profile["school_evidence"] == 2
            assert profile["role_strength"] == "HIGH"
            assert profile["role_family"] == "SOFTWARE_ENGINEERING"
    finally:
        await _reset(database_url)
