# ruff: noqa: E501
import asyncio
import hashlib
import os
from dataclasses import replace
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit
from uuid import UUID, uuid4

import psycopg
import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from psycopg import sql as psycopg_sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from recruitintel_collectors.config import Settings
from recruitintel_collectors.orchestration.dispatcher import TypedWorkDispatcher
from recruitintel_collectors.orchestration.enums import WorkClass, WorkType
from recruitintel_collectors.orchestration.failures import M11RetryableError
from recruitintel_collectors.orchestration.handlers import RuntimeWorkHandlers
from recruitintel_collectors.orchestration.models import WorkExecutionResult
from recruitintel_collectors.orchestration.repository import PostgresOrchestrationRepository
from recruitintel_collectors.orchestration.runner import run_worker

OWNER = UUID("b2000000-0000-4000-8000-000000000001")
OTHER_OWNER = UUID("b2000000-0000-4000-8000-000000000002")
WORKER_PRINCIPAL = UUID("b2000000-0000-4000-8000-000000000010")
SCHEDULER_PRINCIPAL = UUID("b2000000-0000-4000-8000-000000000011")
WORKER_ROLE = "m11_runtime_worker"
WORKER_PASSWORD = "m11-runtime-worker"
SCHEDULER_ROLE = "m11_runtime_scheduler"
SCHEDULER_PASSWORD = "m11-runtime-scheduler"


def database_url() -> str:
    value = os.getenv("TEST_DATABASE_URL")
    if not value:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return value


def role_url(url: str, role: str, password: str) -> str:
    parsed = urlsplit(url)
    host = parsed.hostname or "127.0.0.1"
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{quote(role)}:{quote(password)}@{host}{port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


async def reset(url: str) -> None:
    async with await psycopg.AsyncConnection.connect(url) as connection:
        await connection.execute(
            "delete from public.worker_role_bindings where database_role in (%s,%s)",
            (WORKER_ROLE, SCHEDULER_ROLE),
        )
        await connection.execute(
            "delete from public.service_principals where id in (%s,%s)",
            (WORKER_PRINCIPAL, SCHEDULER_PRINCIPAL),
        )
        await connection.execute(
            "delete from public.users where id in (%s,%s)", (OWNER, OTHER_OWNER)
        )


async def provision(url: str) -> tuple[str, str, UUID]:
    await reset(url)
    async with await psycopg.AsyncConnection.connect(url, row_factory=dict_row) as connection:
        for role, password in (
            (WORKER_ROLE, WORKER_PASSWORD),
            (SCHEDULER_ROLE, SCHEDULER_PASSWORD),
        ):
            cursor = await connection.execute(
                "select exists(select 1 from pg_roles where rolname=%s)", (role,)
            )
            exists = await cursor.fetchone()
            if not exists or not exists["exists"]:
                await connection.execute(
                    psycopg_sql.SQL("create role {} login password {}").format(
                        psycopg_sql.Identifier(role), psycopg_sql.Literal(password)
                    )
                )
        await connection.execute(
            psycopg_sql.SQL("grant recruitintel_worker_resume to {}").format(
                psycopg_sql.Identifier(WORKER_ROLE)
            )
        )
        await connection.execute(
            psycopg_sql.SQL("grant recruitintel_scheduler to {}").format(
                psycopg_sql.Identifier(SCHEDULER_ROLE)
            )
        )
        await connection.execute(
            """
            insert into public.users(id,name,email,email_verified,status) values
              (%s,'M11 Runtime Owner','m11-runtime-owner@example.test',true,'ACTIVE'),
              (%s,'M11 Runtime Other','m11-runtime-other@example.test',true,'ACTIVE')
            """,
            (OWNER, OTHER_OWNER),
        )
        await connection.execute(
            """
            insert into public.service_principals(
              id,name,kind,token_prefix,token_hash,scopes,status
            ) values
              (%s,'M11 runtime worker','WORKER','ri_worker_M11Runtime01',
                encode(digest('m11-runtime-worker','sha256'),'hex'),
                array['ORCHESTRATION_MUTATE']::public.service_scope[],'ACTIVE'),
              (%s,'M11 runtime scheduler','WORKER','ri_worker_M11Schedule1',
                encode(digest('m11-runtime-scheduler','sha256'),'hex'),
                array['WORKER_SCHEDULER']::public.service_scope[],'ACTIVE')
            """,
            (WORKER_PRINCIPAL, SCHEDULER_PRINCIPAL),
        )
        await connection.execute(
            """
            insert into public.worker_role_bindings(
              database_role,service_principal_id,allowed_work_classes,can_schedule
            ) values
              (%s,%s,array['RESUME']::public.work_class[],false),
              (%s,%s,array['CONTROL']::public.work_class[],true)
            """,
            (WORKER_ROLE, WORKER_PRINCIPAL, SCHEDULER_ROLE, SCHEDULER_PRINCIPAL),
        )
        cursor = await connection.execute(
            "select id from public.job_opportunities where status='ACTIVE' order by id limit 1"
        )
        opportunity = await cursor.fetchone()
        assert opportunity is not None
        opportunity_id = UUID(str(opportunity["id"]))
        requirement_fingerprint = hashlib.sha256(b"m11-runtime-python-requirement").hexdigest()
        await connection.execute(
            """
            insert into public.job_requirement_sets(
              opportunity_id,version,requirements,source_version,algorithm_version,input_fingerprint
            ) values (
              %s,
              coalesce((select max(version)+1 from public.job_requirement_sets where opportunity_id=%s),1),
              %s,'m11-runtime-fixture','requirements-v2',%s
            ) on conflict (opportunity_id,algorithm_version,input_fingerprint) where input_fingerprint <> 'legacy'
            do nothing
            """,
            (
                opportunity_id,
                opportunity_id,
                Jsonb(
                    {
                        "roleFamily": "SOFTWARE_ENGINEERING",
                        "experienceLevel": "INTERNSHIP",
                        "requirements": [
                            {
                                "type": "SKILL",
                                "normalized_value": {"skill": "Python"},
                                "explicit": True,
                            }
                        ],
                    }
                ),
                requirement_fingerprint,
            ),
        )
    return (
        role_url(url, WORKER_ROLE, WORKER_PASSWORD),
        role_url(url, SCHEDULER_ROLE, SCHEDULER_PASSWORD),
        opportunity_id,
    )


async def create_resume(
    url: str, *, owner: UUID = OWNER, text: str = "Python TypeScript"
) -> tuple[UUID, UUID]:
    document_id = uuid4()
    version_id = uuid4()
    payload = text.encode()
    content_hash = hashlib.sha256(payload).hexdigest()
    key = hashlib.sha256(b"recruitintel-m11-local-resume-storage").digest()
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, payload, f"{owner}:{content_hash}".encode())
    async with await psycopg.AsyncConnection.connect(url) as owner_connection:
        await owner_connection.execute(
            """
            insert into public.resume_documents(
              id,user_id,storage_object_key,original_filename,media_type,byte_size,
              content_hash,status,storage_key,storage_ciphertext,storage_nonce,storage_key_version
            ) values (%s,%s,%s,'runtime.txt','text/plain',%s,%s,'READY',%s,%s,%s,1)
            """,
            (
                document_id,
                owner,
                f"runtime/{document_id}",
                len(payload),
                content_hash,
                hashlib.sha256(str(document_id).encode()).hexdigest()[:48],
                ciphertext,
                nonce,
            ),
        )
        await owner_connection.execute(
            """
            insert into public.resume_versions(
              id,document_id,user_id,version_number,text_hash,parser_version
            ) values (%s,%s,%s,1,%s,1)
            """,
            (version_id, document_id, owner, content_hash),
        )
    return document_id, version_id


async def enqueue(
    url: str,
    work_type: WorkType,
    version_id: UUID,
    *,
    opportunity_id: UUID | None = None,
    max_attempts: int = 3,
) -> UUID:
    work_id = uuid4()
    async with await psycopg.AsyncConnection.connect(url) as owner_connection:
        await owner_connection.execute(
            """
            insert into public.work_items(
              id,work_type,work_class,user_id,resume_version_id,opportunity_id,
              parser_version,algorithm_version,max_attempts,idempotency_fingerprint,
              safe_diagnostics
            ) values (
              %s,%s,'RESUME',%s,%s,%s,
              case when %s='RESUME_PARSE' then 1 else null end,
              case when %s='MATCH_MATERIALIZE' then 'resume-coverage-v1' else null end,
              %s,%s,'{}'
            )
            """,
            (
                work_id,
                work_type.value,
                OWNER,
                version_id,
                opportunity_id,
                work_type.value,
                work_type.value,
                max_attempts,
                hashlib.sha256(str(work_id).encode()).hexdigest(),
            ),
        )
    return work_id


def runtime(worker_url: str) -> tuple[PostgresOrchestrationRepository, RuntimeWorkHandlers]:
    repository = PostgresOrchestrationRepository(worker_url)
    settings = replace(Settings.from_environment(), database_url=worker_url, zero_cost_mode=True)
    return repository, RuntimeWorkHandlers(settings=settings, orchestration=repository)


async def make_available(url: str, work_id: UUID) -> None:
    async with await psycopg.AsyncConnection.connect(url) as owner_connection:
        await owner_connection.execute(
            "update public.work_items set available_at=clock_timestamp() where id=%s", (work_id,)
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_m11_transient_retry_success_and_finite_parse_are_idempotent() -> None:
    url = database_url()
    worker_url, _, _ = await provision(url)
    _, version_id = await create_resume(url)
    work_id = await enqueue(url, WorkType.RESUME_PARSE, version_id)
    repository, handlers = runtime(worker_url)
    failed_once = False
    mapping = dict(handlers.mapping())
    real_parse = mapping[WorkType.RESUME_PARSE]

    async def transient(work: Any) -> Any:
        nonlocal failed_once
        if not failed_once:
            failed_once = True
            raise M11RetryableError("transient local storage fixture")
        return await real_parse(work)

    mapping[WorkType.RESUME_PARSE] = transient
    dispatcher = TypedWorkDispatcher(repository=repository, handlers=mapping, lease_seconds=30)
    first = await run_worker(
        repository=repository,
        dispatcher=dispatcher,
        worker_instance="m11-retry-one",
        classes=(WorkClass.RESUME,),
        batch_size=1,
        lease_seconds=30,
        poll_seconds=0.01,
        once=True,
    )
    assert first == 1
    await make_available(url, work_id)
    second = await run_worker(
        repository=repository,
        dispatcher=dispatcher,
        worker_instance="m11-retry-two",
        classes=(WorkClass.RESUME,),
        batch_size=1,
        lease_seconds=30,
        poll_seconds=0.01,
        once=True,
    )
    assert second == 1
    assert (
        await run_worker(
            repository=repository,
            dispatcher=dispatcher,
            worker_instance="m11-finite-empty",
            classes=(WorkClass.RESUME,),
            batch_size=1,
            lease_seconds=30,
            poll_seconds=0.01,
            once=True,
        )
        == 0
    )
    async with await psycopg.AsyncConnection.connect(
        url, row_factory=dict_row
    ) as verify_connection:
        cursor = await verify_connection.execute(
            """
            select work.status::text,work.attempt_count,
              (select count(*)::int from public.work_attempts where work_item_id=work.id) attempts,
              (select count(*)::int from public.resume_parse_runs where resume_version_id=%s) runs,
              (select count(*)::int from public.candidate_evidence where resume_version_id=%s) evidence
            from public.work_items work where work.id=%s
            """,
            (version_id, version_id, work_id),
        )
        row = await cursor.fetchone()
        assert row == {
            "status": "SUCCEEDED",
            "attempt_count": 2,
            "attempts": 2,
            "runs": 1,
            "evidence": 2,
        }
    await reset(url)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_m11_nonretryable_and_max_attempt_failures_dead_letter_once() -> None:
    url = database_url()
    worker_url, _, _ = await provision(url)
    document_id, malformed_version = await create_resume(url, text="Python")
    malformed_work = await enqueue(url, WorkType.RESUME_PARSE, malformed_version)
    async with await psycopg.AsyncConnection.connect(url) as owner_connection:
        await owner_connection.execute(
            """
            update public.resume_documents set status='DELETED',deleted_at=now(),
              storage_key=null,storage_ciphertext=null,storage_nonce=null where id=%s
            """,
            (document_id,),
        )
    repository, handlers = runtime(worker_url)
    dispatcher = TypedWorkDispatcher(
        repository=repository, handlers=handlers.mapping(), lease_seconds=30
    )
    assert (
        await run_worker(
            repository=repository,
            dispatcher=dispatcher,
            worker_instance="m11-malformed",
            classes=(WorkClass.RESUME,),
            batch_size=1,
            lease_seconds=30,
            poll_seconds=0.01,
            once=True,
        )
        == 1
    )
    _, retry_version = await create_resume(url, text="TypeScript")
    retry_work = await enqueue(url, WorkType.RESUME_PARSE, retry_version, max_attempts=2)

    async def always_transient(work: Any) -> Any:
        del work
        raise M11RetryableError("bounded transient fixture")

    failure_mapping = dict(handlers.mapping())
    failure_mapping[WorkType.RESUME_PARSE] = always_transient
    failure_dispatcher = TypedWorkDispatcher(
        repository=repository, handlers=failure_mapping, lease_seconds=30
    )
    for attempt in range(2):
        assert (
            await run_worker(
                repository=repository,
                dispatcher=failure_dispatcher,
                worker_instance=f"m11-exhaust-{attempt}",
                classes=(WorkClass.RESUME,),
                batch_size=1,
                lease_seconds=30,
                poll_seconds=0.01,
                once=True,
            )
            == 1
        )
        await make_available(url, retry_work)
    async with await psycopg.AsyncConnection.connect(
        url, row_factory=dict_row
    ) as verify_connection:
        cursor = await verify_connection.execute(
            """
            select id,status::text,attempt_count,last_error_classification::text classification,
              last_error_code,(select count(*)::int from public.dead_letters d where d.work_item_id=w.id) dead_letters
            from public.work_items w where id in (%s,%s) order by id
            """,
            (malformed_work, retry_work),
        )
        rows = {UUID(str(row["id"])): row for row in await cursor.fetchall()}
        assert rows[malformed_work]["status"] == "DEAD_LETTERED"
        assert rows[malformed_work]["attempt_count"] == 1
        assert rows[malformed_work]["classification"] == "NON_RETRYABLE"
        assert rows[malformed_work]["dead_letters"] == 1
        assert rows[retry_work]["status"] == "DEAD_LETTERED"
        assert rows[retry_work]["attempt_count"] == 2
        assert rows[retry_work]["classification"] == "RETRYABLE"
        assert rows[retry_work]["dead_letters"] == 1
    await reset(url)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_m11_match_retry_success_exhaustion_and_malformed_target() -> None:
    url = database_url()
    worker_url, _, opportunity_id = await provision(url)
    _, retry_version = await create_resume(url, text="Python")
    retry_work = await enqueue(
        url,
        WorkType.MATCH_MATERIALIZE,
        retry_version,
        opportunity_id=opportunity_id,
    )
    repository, handlers = runtime(worker_url)
    failed_once = False
    retry_mapping = dict(handlers.mapping())
    real_match = retry_mapping[WorkType.MATCH_MATERIALIZE]

    async def transient_match(work: Any) -> Any:
        nonlocal failed_once
        if not failed_once:
            failed_once = True
            raise M11RetryableError("transient match fixture")
        return await real_match(work)

    retry_mapping[WorkType.MATCH_MATERIALIZE] = transient_match
    retry_dispatcher = TypedWorkDispatcher(
        repository=repository, handlers=retry_mapping, lease_seconds=30
    )
    for attempt in range(2):
        assert (
            await run_worker(
                repository=repository,
                dispatcher=retry_dispatcher,
                worker_instance=f"m11-match-retry-{attempt}",
                classes=(WorkClass.RESUME,),
                batch_size=1,
                lease_seconds=30,
                poll_seconds=0.01,
                once=True,
            )
            == 1
        )
        await make_available(url, retry_work)

    _, exhausted_version = await create_resume(url, text="Python exhausted")
    exhausted_work = await enqueue(
        url,
        WorkType.MATCH_MATERIALIZE,
        exhausted_version,
        opportunity_id=opportunity_id,
        max_attempts=2,
    )

    async def always_transient_match(work: Any) -> Any:
        del work
        raise M11RetryableError("bounded match failure")

    exhausted_mapping = dict(handlers.mapping())
    exhausted_mapping[WorkType.MATCH_MATERIALIZE] = always_transient_match
    exhausted_dispatcher = TypedWorkDispatcher(
        repository=repository, handlers=exhausted_mapping, lease_seconds=30
    )
    for attempt in range(2):
        assert (
            await run_worker(
                repository=repository,
                dispatcher=exhausted_dispatcher,
                worker_instance=f"m11-match-exhaust-{attempt}",
                classes=(WorkClass.RESUME,),
                batch_size=1,
                lease_seconds=30,
                poll_seconds=0.01,
                once=True,
            )
            == 1
        )
        await make_available(url, exhausted_work)

    malformed_document, malformed_version = await create_resume(url, text="Python malformed")
    malformed_work = await enqueue(
        url,
        WorkType.MATCH_MATERIALIZE,
        malformed_version,
        opportunity_id=opportunity_id,
    )
    async with await psycopg.AsyncConnection.connect(url) as owner_connection:
        await owner_connection.execute(
            """
            update public.resume_documents set status='DELETED',deleted_at=clock_timestamp(),
              storage_key=null,storage_ciphertext=null,storage_nonce=null where id=%s
            """,
            (malformed_document,),
        )
    real_dispatcher = TypedWorkDispatcher(
        repository=repository, handlers=handlers.mapping(), lease_seconds=30
    )
    assert (
        await run_worker(
            repository=repository,
            dispatcher=real_dispatcher,
            worker_instance="m11-match-malformed",
            classes=(WorkClass.RESUME,),
            batch_size=1,
            lease_seconds=30,
            poll_seconds=0.01,
            once=True,
        )
        == 1
    )
    async with await psycopg.AsyncConnection.connect(
        url, row_factory=dict_row
    ) as verify_connection:
        cursor = await verify_connection.execute(
            """
            select id,status::text,attempt_count,
              last_error_classification::text classification,last_error_code,
              (select count(*)::int from public.work_attempts where work_item_id=work.id) attempts,
              (select count(*)::int from public.dead_letters where work_item_id=work.id) dead_letters
            from public.work_items work where id in (%s,%s,%s)
            """,
            (retry_work, exhausted_work, malformed_work),
        )
        rows = {UUID(str(row["id"])): row for row in await cursor.fetchall()}
        assert rows[retry_work] == {
            "id": retry_work,
            "status": "SUCCEEDED",
            "attempt_count": 2,
            "classification": None,
            "last_error_code": None,
            "attempts": 2,
            "dead_letters": 0,
        }
        assert rows[exhausted_work]["status"] == "DEAD_LETTERED"
        assert rows[exhausted_work]["attempt_count"] == 2
        assert rows[exhausted_work]["classification"] == "RETRYABLE"
        assert rows[exhausted_work]["dead_letters"] == 1
        assert rows[malformed_work]["status"] == "DEAD_LETTERED"
        assert rows[malformed_work]["attempt_count"] == 1
        assert rows[malformed_work]["classification"] == "NON_RETRYABLE"
        assert rows[malformed_work]["last_error_code"] == "M11_INVALID_TARGET"
        assert rows[malformed_work]["dead_letters"] == 1
        cursor = await verify_connection.execute(
            """
            select count(*)::int matches from public.resume_job_matches
            where user_id=%s and resume_version_id=%s and opportunity_id=%s
            """,
            (OWNER, retry_version, opportunity_id),
        )
        assert await cursor.fetchone() == {"matches": 1}
    await reset(url)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_m11_claim_races_concurrency_lease_reaping_and_stale_fencing() -> None:
    url = database_url()
    worker_url, scheduler_url, opportunity_id = await provision(url)
    _, single_version = await create_resume(url, text="Python single claim")
    single_work = await enqueue(url, WorkType.RESUME_PARSE, single_version)
    repository, handlers = runtime(worker_url)
    single_claims = await asyncio.gather(
        repository.claim(
            worker="m11-same-work-a", classes=(WorkClass.RESUME,), limit=1, lease_seconds=30
        ),
        repository.claim(
            worker="m11-same-work-b", classes=(WorkClass.RESUME,), limit=1, lease_seconds=30
        ),
    )
    same_work_claimed = [work for group in single_claims for work in group]
    assert len(same_work_claimed) == 1
    assert same_work_claimed[0].id == single_work
    dispatcher = TypedWorkDispatcher(
        repository=repository, handlers=handlers.mapping(), lease_seconds=30
    )
    await dispatcher.execute(same_work_claimed[0])

    _, first_version = await create_resume(url, text="Python")
    _, second_version = await create_resume(url, text="Python SQL")
    first_work = await enqueue(url, WorkType.RESUME_PARSE, first_version)
    second_work = await enqueue(url, WorkType.RESUME_PARSE, second_version)
    claims = await asyncio.gather(
        repository.claim(
            worker="m11-racer-a", classes=(WorkClass.RESUME,), limit=1, lease_seconds=30
        ),
        repository.claim(
            worker="m11-racer-b", classes=(WorkClass.RESUME,), limit=1, lease_seconds=30
        ),
    )
    claimed = [work for group in claims for work in group]
    assert len(claimed) == 2
    assert {work.id for work in claimed} == {first_work, second_work}
    await asyncio.gather(*(dispatcher.execute(work) for work in claimed))
    match_work = await enqueue(
        url,
        WorkType.MATCH_MATERIALIZE,
        first_version,
        opportunity_id=opportunity_id,
    )
    old_claim = (
        await repository.claim(
            worker="m11-crash-before-finish",
            classes=(WorkClass.RESUME,),
            limit=1,
            lease_seconds=30,
        )
    )[0]
    await repository.start(old_claim)
    await handlers.match_materialize(old_claim)
    async with await psycopg.AsyncConnection.connect(url) as connection:
        await connection.execute(
            "update public.work_items set lease_expires_at=clock_timestamp()-interval '1 second' where id=%s",
            (match_work,),
        )
    scheduler = PostgresOrchestrationRepository(scheduler_url)
    assert await scheduler.reap() == 1
    new_claim = (
        await repository.claim(
            worker="m11-crash-retry",
            classes=(WorkClass.RESUME,),
            limit=1,
            lease_seconds=30,
        )
    )[0]
    assert new_claim.id == match_work
    assert new_claim.lease_generation == old_claim.lease_generation + 1
    async with await psycopg.AsyncConnection.connect(worker_url) as stale:
        with pytest.raises(psycopg.errors.RaiseException, match="STALE_OR_INVALID_LEASE"):
            await stale.execute(
                "select public.m11_materialize_claimed_match(%s,%s)",
                (old_claim.id, old_claim.lease_token),
            )
    with pytest.raises(psycopg.errors.RaiseException, match="STALE_OR_INVALID_LEASE"):
        await repository.finish_success(
            old_claim,
            WorkExecutionResult(processed=1),
        )
    # The deliberately stale call above is fenced before any write; complete the
    # live retry normally and preserve the first domain-side success.
    await repository.start(new_claim)
    result = await handlers.match_materialize(new_claim)
    await repository.finish_success(new_claim, result)
    async with await psycopg.AsyncConnection.connect(url, row_factory=dict_row) as connection:
        cursor = await connection.execute(
            """
            select w.status::text,w.attempt_count,
              (select count(*)::int from public.work_attempts where work_item_id=w.id) attempts,
              (select count(*)::int from public.resume_job_matches where user_id=%s and resume_version_id=%s and opportunity_id=%s) matches,
              (select count(*)::int from public.match_evidence e join public.resume_job_matches m on m.id=e.match_id where m.user_id=%s and m.resume_version_id=%s and m.opportunity_id=%s) citations
            from public.work_items w where w.id=%s
            """,
            (
                OWNER,
                first_version,
                opportunity_id,
                OWNER,
                first_version,
                opportunity_id,
                match_work,
            ),
        )
        row = await cursor.fetchone()
        assert row == {
            "status": "SUCCEEDED",
            "attempt_count": 2,
            "attempts": 2,
            "matches": 1,
            "citations": 1,
        }
    await reset(url)


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize("work_type", [WorkType.RESUME_PARSE, WorkType.MATCH_MATERIALIZE])
async def test_m11_account_delete_racing_worker_never_resurrects_private_data(
    work_type: WorkType,
) -> None:
    url = database_url()
    worker_url, _, opportunity_id = await provision(url)
    _, version_id = await create_resume(url, text="Python delete race")
    work_id = await enqueue(
        url,
        work_type,
        version_id,
        opportunity_id=opportunity_id if work_type == WorkType.MATCH_MATERIALIZE else None,
    )
    repository, handlers = runtime(worker_url)
    work = (
        await repository.claim(
            worker=f"m11-delete-race-{work_type.value.lower()}",
            classes=(WorkClass.RESUME,),
            limit=1,
            lease_seconds=30,
        )
    )[0]
    await repository.start(work)

    async def delete_account() -> None:
        async with await psycopg.AsyncConnection.connect(url) as owner_connection:
            async with owner_connection.transaction():
                await owner_connection.execute(
                    "update public.users set status='DELETION_PENDING' where id=%s",
                    (OWNER,),
                )
                await owner_connection.execute(
                    """
                    update public.work_items set status='CANCELLED',completed_at=clock_timestamp(),
                      cancel_requested_at=coalesce(cancel_requested_at,clock_timestamp()),
                      lease_owner=null,lease_service_principal_id=null,lease_token=null,
                      lease_expires_at=null,heartbeat_at=null
                    where user_id=%s and status in ('READY','RETRY_WAIT','LEASED','RUNNING')
                    """,
                    (OWNER,),
                )
                await owner_connection.execute("delete from public.users where id=%s", (OWNER,))

    handler = handlers.mapping()[work_type]
    outcomes = await asyncio.gather(handler(work), delete_account(), return_exceptions=True)
    assert outcomes[1] is None
    if not isinstance(outcomes[0], BaseException):
        with pytest.raises((psycopg.Error, RuntimeError)):
            await repository.finish_success(work, outcomes[0])
    async with await psycopg.AsyncConnection.connect(
        url, row_factory=dict_row
    ) as verify_connection:
        cursor = await verify_connection.execute(
            """
            select
              (select count(*)::int from public.users where id=%s) owner_rows,
              (select count(*)::int from public.users where id=%s) other_owner_rows,
              (select count(*)::int from public.resume_documents where user_id=%s) documents,
              (select count(*)::int from public.resume_versions where user_id=%s) versions,
              (select count(*)::int from public.resume_parse_runs where user_id=%s) parse_runs,
              (select count(*)::int from public.candidate_evidence where user_id=%s) evidence,
              (select count(*)::int from public.resume_job_matches where user_id=%s) matches,
              (select count(*)::int from public.match_evidence where user_id=%s) citations,
              (select count(*)::int from public.work_items where id=%s) work_items,
              (select count(*)::int from public.job_opportunities where id=%s) shared_opportunity
            """,
            (
                OWNER,
                OTHER_OWNER,
                OWNER,
                OWNER,
                OWNER,
                OWNER,
                OWNER,
                OWNER,
                work_id,
                opportunity_id,
            ),
        )
        assert await cursor.fetchone() == {
            "owner_rows": 0,
            "other_owner_rows": 1,
            "documents": 0,
            "versions": 0,
            "parse_runs": 0,
            "evidence": 0,
            "matches": 0,
            "citations": 0,
            "work_items": 0,
            "shared_opportunity": 1,
        }
    await reset(url)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_m11_worker_role_allows_claimed_targets_and_denies_credentials_and_other_lanes() -> (
    None
):
    url = database_url()
    worker_url, _, opportunity_id = await provision(url)
    _, version_id = await create_resume(url, text="Python bearer secret@example.test")
    parse_work = await enqueue(url, WorkType.RESUME_PARSE, version_id)
    repository, handlers = runtime(worker_url)
    dispatcher = TypedWorkDispatcher(
        repository=repository, handlers=handlers.mapping(), lease_seconds=30
    )
    assert (
        await run_worker(
            repository=repository,
            dispatcher=dispatcher,
            worker_instance="m11-permission-allowed",
            classes=(WorkClass.RESUME,),
            batch_size=1,
            lease_seconds=30,
            poll_seconds=0.01,
            once=True,
        )
        == 1
    )
    match_work = await enqueue(
        url, WorkType.MATCH_MATERIALIZE, version_id, opportunity_id=opportunity_id
    )
    assert (
        await run_worker(
            repository=repository,
            dispatcher=dispatcher,
            worker_instance="m11-permission-match",
            classes=(WorkClass.RESUME,),
            batch_size=1,
            lease_seconds=30,
            poll_seconds=0.01,
            once=True,
        )
        == 1
    )
    denied = [
        "select storage_ciphertext from public.resume_documents limit 1",
        "select encrypted_refresh_token from public.calendar_connections limit 1",
        "select token from public.user_sessions limit 1",
        "select * from public.application_events limit 1",
        "select * from public.applications limit 1",
        "update public.users set name='forbidden' where id='b2000000-0000-4000-8000-000000000002'",
        "insert into public.work_items(work_type,work_class,idempotency_fingerprint,safe_diagnostics) values ('PRIVACY_RETENTION_CLEANUP','PRIVACY','forbidden-privacy','{}')",
    ]
    for statement in denied:
        async with await psycopg.AsyncConnection.connect(worker_url, autocommit=True) as connection:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                await connection.execute(statement)
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="WORK_CLASS_NOT_GRANTED"):
        await repository.claim(
            worker="m11-forbidden-calendar",
            classes=(WorkClass.CALENDAR,),
            limit=1,
            lease_seconds=30,
        )
    async with await psycopg.AsyncConnection.connect(url, row_factory=dict_row) as connection:
        cursor = await connection.execute(
            """
            select
              (select count(*)::int from information_schema.role_table_grants where grantee='recruitintel_worker_resume') direct_table_grants,
              (select count(*)::int from public.candidate_evidence where resume_version_id=%s) evidence,
              (select count(*)::int from public.resume_job_matches where resume_version_id=%s and opportunity_id=%s) matches,
              (select safe_diagnostics::text from public.work_items where id=%s) diagnostics
            """,
            (version_id, version_id, opportunity_id, parse_work),
        )
        row = await cursor.fetchone()
        assert row is not None
        assert row["direct_table_grants"] == 0
        assert row["evidence"] == 1
        assert row["matches"] == 1
        assert "secret@example.test" not in row["diagnostics"]
        assert "bearer" not in row["diagnostics"].lower()
        cursor = await connection.execute(
            "select status::text from public.work_items where id=%s", (match_work,)
        )
        status = await cursor.fetchone()
        assert status is not None
        assert status["status"] == "SUCCEEDED"
    await reset(url)
