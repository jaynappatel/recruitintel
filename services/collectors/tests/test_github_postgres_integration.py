import os
from pathlib import Path
from uuid import UUID

import psycopg
import pytest
from psycopg.rows import dict_row
from recruitintel_collectors.github.client import GitHubAPIResult
from recruitintel_collectors.github.models import (
    GitHubChangedFile,
    GitHubComparison,
    GitHubFile,
    GitHubRateLimit,
    GitHubRepositoryMetadata,
)
from recruitintel_collectors.github.runner import GitHubSyncRunner
from recruitintel_collectors.infrastructure.github_postgres import PostgresGitHubSyncRepository

FIXTURES = Path(__file__).parent / "fixtures"
COMPANY_ID = UUID("b1000000-0000-0000-0000-000000000001")
SOURCE_ID = UUID("b2000000-0000-0000-0000-000000000001")
REPOSITORY_ID = UUID("b3000000-0000-0000-0000-000000000001")
INITIAL_SHA = "a" * 40
CHANGED_SHA = "b" * 40


def _database_url() -> str:
    value = os.getenv("TEST_DATABASE_URL")
    if not value:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return value


class SyntheticGitHubClient:
    def __init__(self) -> None:
        self.current_sha = INITIAL_SHA
        self.content = (FIXTURES / "github_interview_questions.md").read_text(encoding="utf-8")
        self.rate = GitHubRateLimit(limit=5000, remaining=4990)
        self.file_fetches = 0

    async def get_repository(
        self, owner: str, repository_name: str
    ) -> GitHubAPIResult[GitHubRepositoryMetadata]:
        return GitHubAPIResult(
            GitHubRepositoryMetadata(
                owner=owner,
                repository_name=repository_name,
                repository_url=f"https://github.com/{owner}/{repository_name}",
                default_branch="main",
            ),
            self.rate,
        )

    async def get_latest_commit_sha(
        self, owner: str, repository_name: str, branch: str
    ) -> GitHubAPIResult[str]:
        del owner, repository_name, branch
        return GitHubAPIResult(self.current_sha, self.rate)

    async def compare_commits(
        self, owner: str, repository_name: str, previous_sha: str, current_sha: str
    ) -> GitHubAPIResult[GitHubComparison]:
        del owner, repository_name, previous_sha, current_sha
        return GitHubAPIResult(
            GitHubComparison(files=(GitHubChangedFile(path="questions.md", status="modified"),)),
            self.rate,
        )

    async def list_repository_files(
        self, owner: str, repository_name: str, commit_sha: str
    ) -> GitHubAPIResult[tuple[str, ...]]:
        del owner, repository_name, commit_sha
        return GitHubAPIResult(("questions.md",), self.rate)

    async def get_file(
        self, owner: str, repository_name: str, source_path: str, commit_sha: str
    ) -> GitHubAPIResult[GitHubFile]:
        self.file_fetches += 1
        return GitHubAPIResult(
            GitHubFile(
                path=source_path,
                source_url=(
                    f"https://github.com/{owner}/{repository_name}/blob/{commit_sha}/{source_path}"
                ),
                commit_sha=commit_sha,
                content=self.content,
            ),
            self.rate,
        )


async def _reset(database_url: str) -> None:
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        await connection.execute("delete from public.sources where id = %s", (SOURCE_ID,))
        await connection.execute("delete from public.companies where id = %s", (COMPANY_ID,))
        await connection.execute(
            """
            delete from public.interview_questions iq
            where not exists (
              select 1 from public.company_interview_questions ciq
              where ciq.interview_question_id = iq.id
            )
            """
        )


async def _seed(database_url: str) -> None:
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        await connection.execute(
            """
            insert into public.companies (id, canonical_name, slug)
            values (%s, 'Meta', 'github-integration-meta')
            """,
            (COMPANY_ID,),
        )
        await connection.cursor().executemany(
            """
            insert into public.company_aliases (company_id, alias, normalized_alias)
            values (%s, %s, %s)
            """,
            [
                (COMPANY_ID, "Meta", "meta"),
                (COMPANY_ID, "Facebook", "facebook"),
                (COMPANY_ID, "Meta Platforms", "meta platforms"),
            ],
        )
        await connection.execute(
            """
            insert into public.sources (
              id, source_type, provider, external_key, name, base_url, reliability
            ) values (
              %s, 'GITHUB', 'github', 'recruitintel-tests/synthetic-intelligence',
              'Synthetic GitHub questions',
              'https://github.com/recruitintel-tests/synthetic-intelligence', 0.700
            )
            """,
            (SOURCE_ID,),
        )
        await connection.execute(
            """
            insert into public.github_repositories (
              id, source_id, owner, repository_name, repository_url,
              repository_type, parser_type
            ) values (
              %s, %s, 'recruitintel-tests', 'synthetic-intelligence',
              'https://github.com/recruitintel-tests/synthetic-intelligence',
              'INTERVIEW_QUESTIONS', 'AUTO'
            )
            """,
            (REPOSITORY_ID, SOURCE_ID),
        )
        await connection.execute(
            """
            insert into public.github_repository_company_links (
              company_id, github_repository_id, watched_paths, company_mapping_rules
            ) values (
              %s, %s, array['questions.md'], '{"aliases":["Meta Platforms"]}'::jsonb
            )
            """,
            (COMPANY_ID, REPOSITORY_ID),
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_synthetic_repository_end_to_end_is_idempotent_and_queryable() -> None:
    database_url = _database_url()
    await _reset(database_url)
    await _seed(database_url)
    repository = PostgresGitHubSyncRepository(database_url)
    client = SyntheticGitHubClient()
    runner = GitHubSyncRunner(repository=repository, client=client)

    try:
        initial = await runner.run(REPOSITORY_ID)
        assert initial.new == 3
        assert initial.unresolved == 1
        assert initial.files_inspected == 1
        assert client.file_fetches == 1

        unchanged = await runner.run(REPOSITORY_ID)
        assert unchanged.skipped_unchanged_sha
        assert client.file_fetches == 1

        client.current_sha = CHANGED_SHA
        client.content = """\
| Company | Question | Difficulty | Topics |
| --- | --- | --- | --- |
| Meta | Number of Islands | Medium | Graph, BFS, DFS |
| Meta | 3. Longest Substring Without Repeating Characters | Medium | String |
| Unknown Robotics | 42. Trapping Rain Water | Hard | Array |
"""
        changed = await runner.run(REPOSITORY_ID)
        assert changed.new == 2
        assert changed.updated == 1
        assert changed.unresolved == 1
        assert client.file_fetches == 2

        retry = await runner.run(REPOSITORY_ID)
        assert retry.skipped_unchanged_sha
        assert client.file_fetches == 2

        async with await psycopg.AsyncConnection.connect(
            database_url, row_factory=dict_row
        ) as connection:
            cursor = await connection.execute(
                """
                select
                  (select count(*) from public.interview_questions)::int as questions,
                  (select count(*) from public.company_interview_questions
                    where company_id = %s)::int as associations,
                  (select count(*) from public.interview_question_observations
                    where github_repository_id = %s)::int as observations,
                  (select count(*) from public.unresolved_github_observations
                    where github_repository_id = %s)::int as unresolved,
                  (select count(*) from public.recruiting_events
                    where github_repository_id = %s)::int as events
                """,
                (COMPANY_ID, REPOSITORY_ID, REPOSITORY_ID, REPOSITORY_ID),
            )
            counts = await cursor.fetchone()
            assert counts == {
                "questions": 3,
                "associations": 3,
                "observations": 4,
                "unresolved": 2,
                "events": 5,
            }
            analytics = await connection.execute(
                """
                select canonical_title, observation_count, source_count,
                       last_observed_at
                from public.company_interview_question_analytics
                where company_id = %s
                order by observation_count desc, last_observed_at desc
                """,
                (COMPANY_ID,),
            )
            rows = await analytics.fetchall()
            assert rows[0]["canonical_title"] == "Number of Islands"
            assert rows[0]["observation_count"] == 2
            assert rows[0]["source_count"] == 1
    finally:
        await _reset(database_url)
