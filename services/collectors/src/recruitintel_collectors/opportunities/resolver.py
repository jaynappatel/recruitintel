from dataclasses import dataclass
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .identity import OpportunityIdentityKey, official_application_url_key, provider_native_key
from .structured import STRUCTURED_PARSER_VERSION, StructuredJobFacts, derive_structured_job_facts

RESOLVER_VERSION = 1
_NATIVE_ID_PROVIDERS = frozenset({"greenhouse", "lever"})


@dataclass(frozen=True, slots=True)
class OpportunityResolutionResult:
    job_id: UUID
    outcome: str
    opportunity_id: UUID
    reason_codes: tuple[str, ...]
    comparisons: int


class PostgresOpportunityResolver:
    """Exact-key resolver. Title blocks produce review candidates only, never MATCH."""

    def __init__(self, database_url: str) -> None:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        self.database_url = database_url

    async def _connect(self) -> psycopg.AsyncConnection[dict[str, Any]]:
        return await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)

    @staticmethod
    def _identity_keys(
        job: dict[str, Any], validated_hosts: frozenset[str]
    ) -> tuple[OpportunityIdentityKey, ...]:
        keys: list[OpportunityIdentityKey] = []
        if job["source_type"] == "ATS" and job["provider"] in _NATIVE_ID_PROVIDERS:
            keys.append(
                provider_native_key(
                    provider=job["provider"],
                    board=job["external_key"],
                    external_id=job["external_id"],
                )
            )
        url_key = official_application_url_key(
            job["application_url"], validated_hosts=validated_hosts
        )
        if url_key is not None:
            keys.append(url_key)
        return tuple(keys)

    @staticmethod
    async def _persist_structured_facts(
        cursor: psycopg.AsyncCursor[dict[str, Any]], job: dict[str, Any], facts: StructuredJobFacts
    ) -> None:
        await cursor.execute(
            "select derivation_hash from public.job_structured_derivations where job_id = %s",
            (job["id"],),
        )
        current = await cursor.fetchone()
        if current and current["derivation_hash"] == facts.derivation_hash:
            return
        await cursor.execute("delete from public.job_locations where job_id = %s", (job["id"],))
        await cursor.execute("delete from public.job_skills where job_id = %s", (job["id"],))
        await cursor.execute("delete from public.job_requirements where job_id = %s", (job["id"],))
        await cursor.execute("delete from public.job_constraints where job_id = %s", (job["id"],))
        for location_fact in facts.locations:
            await cursor.execute(
                """
                insert into public.job_locations (
                  job_id, raw_location, city, region, country_code, remote_region,
                  workplace_mode, parser_version, evidence_fingerprint
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    job["id"],
                    location_fact.raw,
                    location_fact.city,
                    location_fact.region,
                    location_fact.country_code,
                    location_fact.remote_region,
                    location_fact.workplace_mode,
                    STRUCTURED_PARSER_VERSION,
                    location_fact.fingerprint,
                ),
            )
        for skill_fact in facts.skills:
            await cursor.execute(
                """
                insert into public.job_skills (
                  job_id, skill_id, raw_mention, requirement, parser_version,
                  evidence_fingerprint, evidence
                ) values (
                  %s, (select id from public.skills where canonical_name = %s),
                  %s, %s, %s, %s, %s
                )
                """,
                (
                    job["id"],
                    skill_fact.canonical_name,
                    skill_fact.raw,
                    skill_fact.requirement,
                    STRUCTURED_PARSER_VERSION,
                    skill_fact.fingerprint,
                    Jsonb({"extractor": "deterministic", "explicit": True}),
                ),
            )
        for requirement_fact in facts.requirements:
            await cursor.execute(
                """
                insert into public.job_requirements (
                  job_id, requirement_type, normalized_value, raw_evidence,
                  parser_version, evidence_fingerprint
                ) values (%s, %s, %s, %s, %s, %s)
                """,
                (
                    job["id"],
                    requirement_fact.requirement_type,
                    Jsonb(requirement_fact.value),
                    requirement_fact.evidence,
                    STRUCTURED_PARSER_VERSION,
                    requirement_fact.fingerprint,
                ),
            )
        for constraint_fact in facts.constraints:
            await cursor.execute(
                """
                insert into public.job_constraints (
                  job_id, constraint_type, value, raw_evidence,
                  parser_version, evidence_fingerprint
                ) values (%s, %s, %s, %s, %s, %s)
                """,
                (
                    job["id"],
                    constraint_fact.constraint_type,
                    Jsonb(constraint_fact.value),
                    constraint_fact.evidence,
                    STRUCTURED_PARSER_VERSION,
                    constraint_fact.fingerprint,
                ),
            )
        await cursor.execute(
            """
            insert into public.job_structured_derivations (
              job_id, parser_version, derivation_hash, evidence_summary
            ) values (%s, %s, %s, %s)
            on conflict (job_id) do update set
              parser_version = excluded.parser_version,
              derivation_hash = excluded.derivation_hash,
              parsed_at = now(), evidence_summary = excluded.evidence_summary
            """,
            (
                job["id"],
                STRUCTURED_PARSER_VERSION,
                facts.derivation_hash,
                Jsonb(
                    {
                        "locations": len(facts.locations),
                        "skills": len(facts.skills),
                        "requirements": len(facts.requirements),
                        "constraints": len(facts.constraints),
                    }
                ),
            ),
        )

    @staticmethod
    async def _decision(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        job: dict[str, Any],
        from_opportunity_id: UUID | None,
        to_opportunity_id: UUID | None,
        outcome: str,
        reason_codes: tuple[str, ...],
        evidence: dict[str, Any],
        idempotency_key: str,
    ) -> UUID:
        await cursor.execute(
            """
            insert into public.job_resolution_decisions (
              company_id, subject_job_id, from_opportunity_id, to_opportunity_id,
              action, outcome, decision_source, algorithm_version, reason_codes,
              evidence, idempotency_key, actor_kind
            ) values (%s, %s, %s, %s, 'AUTO_RESOLUTION', %s, 'SYSTEM', %s, %s, %s, %s, 'SYSTEM')
            on conflict (decision_source, idempotency_key) do nothing
            returning id
            """,
            (
                job["company_id"],
                job["id"],
                from_opportunity_id,
                to_opportunity_id,
                outcome,
                RESOLVER_VERSION,
                list(reason_codes),
                Jsonb(evidence),
                idempotency_key,
            ),
        )
        row = await cursor.fetchone()
        if row is None:
            await cursor.execute(
                """
                select id from public.job_resolution_decisions
                where decision_source = 'SYSTEM' and idempotency_key = %s
                """,
                (idempotency_key,),
            )
            row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("resolution decision did not return an ID")
        return UUID(str(row["id"]))

    async def resolve_job(self, job_id: UUID) -> OpportunityResolutionResult:
        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = connection.cursor()
                await cursor.execute(
                    """
                    select job.*, source.provider, source.external_key, source.source_type::text,
                      membership.opportunity_id, membership.pinned,
                      membership.membership_method::text,
                      opportunity.status::text as opportunity_status
                    from public.jobs job
                    join public.sources source on source.id = job.source_id
                    join public.job_opportunity_postings membership
                      on membership.job_id = job.id and membership.valid_to is null
                    join public.job_opportunities opportunity
                      on opportunity.id = membership.opportunity_id
                    where job.id = %s for update of job, membership, opportunity
                    """,
                    (job_id,),
                )
                job = await cursor.fetchone()
                if job is None:
                    raise KeyError(f"source posting {job_id} was not found")
                await cursor.execute(
                    "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"opportunity-company:{job['company_id']}",),
                )
                await cursor.execute(
                    """
                    select unnest(capability.validated_application_hosts) as hostname
                    from public.source_job_capabilities capability
                    join public.sources source on source.id = capability.source_id
                    where source.company_id = %s and capability.reviewed
                    """,
                    (job["company_id"],),
                )
                validated_hosts = frozenset(
                    str(row["hostname"]).casefold().rstrip(".")
                    for row in await cursor.fetchall()
                    if row["hostname"]
                )
                keys = self._identity_keys(job, validated_hosts)
                for key in keys:
                    await cursor.execute(
                        """
                        insert into public.job_identity_keys (
                          job_id, company_id, key_type, provider, key_hash,
                          safe_value_hint, validator_version, validated, evidence
                        ) values (%s, %s, %s, %s, %s, %s, %s, true, %s)
                        on conflict (job_id, key_type, key_hash, validator_version) do update set
                          validated = true, evidence = excluded.evidence
                        """,
                        (
                            job["id"],
                            job["company_id"],
                            key.key_type,
                            key.provider,
                            key.key_hash,
                            key.safe_value_hint,
                            RESOLVER_VERSION,
                            Jsonb({"reasonCode": key.reason_code}),
                        ),
                    )
                facts = derive_structured_job_facts(
                    description=job["description"],
                    location=job["location"],
                    graduation_years=tuple(job["graduation_years"]),
                    raw_payload=job["raw_payload"] if isinstance(job["raw_payload"], dict) else {},
                )
                await self._persist_structured_facts(cursor, job, facts)

                if job["membership_method"] != "SINGLETON":
                    await cursor.execute(
                        "select public.recompute_job_opportunity(%s)",
                        (job["opportunity_id"],),
                    )
                    return OpportunityResolutionResult(
                        job_id,
                        "MATCH",
                        job["opportunity_id"],
                        ("ACTIVE_MEMBERSHIP_ALREADY_RESOLVED",),
                        0,
                    )

                if not keys:
                    reasons = ("NO_VALIDATED_STRONG_IDENTITY_KEY",)
                    await self._decision(
                        cursor,
                        job=job,
                        from_opportunity_id=job["opportunity_id"],
                        to_opportunity_id=None,
                        outcome="NO_MATCH",
                        reason_codes=reasons,
                        evidence={"resolverVersion": RESOLVER_VERSION},
                        idempotency_key=f"auto:{RESOLVER_VERSION}:no-key:{job_id}",
                    )
                    return OpportunityResolutionResult(
                        job_id, "NO_MATCH", job["opportunity_id"], reasons, 0
                    )

                await cursor.execute(
                    """
                    select distinct candidate.job_id, membership.opportunity_id,
                      membership.pinned, candidate.key_type::text, candidate.key_hash
                    from public.job_identity_keys own
                    join public.job_identity_keys candidate
                      on candidate.company_id = own.company_id
                     and candidate.key_type = own.key_type
                     and candidate.key_hash = own.key_hash
                     and candidate.validated and candidate.job_id <> own.job_id
                    join public.job_opportunity_postings membership
                      on membership.job_id = candidate.job_id and membership.valid_to is null
                    join public.job_opportunities opportunity
                      on opportunity.id = membership.opportunity_id
                     and opportunity.status = 'ACTIVE'
                    where own.job_id = %s and own.validated
                    order by candidate.job_id limit 51
                    """,
                    (job_id,),
                )
                candidates = await cursor.fetchall()
                if len(candidates) > 50:
                    reasons = ("STRONG_IDENTITY_CANDIDATE_CAP_EXCEEDED",)
                    await self._decision(
                        cursor,
                        job=job,
                        from_opportunity_id=job["opportunity_id"],
                        to_opportunity_id=None,
                        outcome="REVIEW_REQUIRED",
                        reason_codes=reasons,
                        evidence={"candidateCountLowerBound": 51},
                        idempotency_key=f"auto:{RESOLVER_VERSION}:candidate-cap:{job_id}",
                    )
                    return OpportunityResolutionResult(
                        job_id, "REVIEW_REQUIRED", job["opportunity_id"], reasons, 50
                    )
                targets = {UUID(str(item["opportunity_id"])) for item in candidates}
                targets.discard(UUID(str(job["opportunity_id"])))
                if len(targets) == 1:
                    target = next(iter(targets))
                    reason_codes = tuple(
                        sorted(
                            {
                                "VALIDATED_PROVIDER_BOARD_NATIVE_ID"
                                if item["key_type"] == "PROVIDER_NATIVE_ID"
                                else "VALIDATED_CANONICAL_OFFICIAL_APPLICATION_URL"
                                for item in candidates
                                if UUID(str(item["opportunity_id"])) == target
                            }
                        )
                    )
                    if job["pinned"]:
                        reasons = ("PINNED_MEMBERSHIP_REQUIRES_MANUAL_REVIEW",)
                        await self._decision(
                            cursor,
                            job=job,
                            from_opportunity_id=job["opportunity_id"],
                            to_opportunity_id=target,
                            outcome="REVIEW_REQUIRED",
                            reason_codes=reasons,
                            evidence={"candidateCount": len(candidates)},
                            idempotency_key=f"auto:{RESOLVER_VERSION}:pinned:{job_id}:{target}",
                        )
                        return OpportunityResolutionResult(
                            job_id,
                            "REVIEW_REQUIRED",
                            job["opportunity_id"],
                            reasons,
                            len(candidates),
                        )
                    await cursor.execute(
                        """
                        select count(*)::int as count from public.job_opportunity_postings
                        where opportunity_id = %s and valid_to is null
                        """,
                        (job["opportunity_id"],),
                    )
                    source_count = int((await cursor.fetchone() or {}).get("count", 0))
                    if source_count != 1:
                        reasons = ("NON_SINGLETON_SOURCE_CLUSTER_REQUIRES_REVIEW",)
                        await self._decision(
                            cursor,
                            job=job,
                            from_opportunity_id=job["opportunity_id"],
                            to_opportunity_id=target,
                            outcome="REVIEW_REQUIRED",
                            reason_codes=reasons,
                            evidence={"sourceMemberships": source_count},
                            idempotency_key=f"auto:{RESOLVER_VERSION}:cluster:{job_id}:{target}",
                        )
                        return OpportunityResolutionResult(
                            job_id,
                            "REVIEW_REQUIRED",
                            job["opportunity_id"],
                            reasons,
                            len(candidates),
                        )
                    matched = next(
                        item for item in candidates if UUID(str(item["opportunity_id"])) == target
                    )
                    decision_id = await self._decision(
                        cursor,
                        job=job,
                        from_opportunity_id=job["opportunity_id"],
                        to_opportunity_id=target,
                        outcome="MATCH",
                        reason_codes=reason_codes,
                        evidence={"keyType": matched["key_type"], "keyHash": matched["key_hash"]},
                        idempotency_key=(
                            f"auto:{RESOLVER_VERSION}:match:{job_id}:{target}:{matched['key_hash']}"
                        ),
                    )
                    await cursor.execute(
                        """
                        update public.job_opportunity_postings set valid_to = now()
                        where job_id = %s and opportunity_id = %s
                          and valid_to is null and not pinned
                        """,
                        (job_id, job["opportunity_id"]),
                    )
                    if cursor.rowcount != 1:
                        raise RuntimeError(
                            "source opportunity membership changed during resolution"
                        )
                    method = (
                        "PROVIDER_NATIVE_ID"
                        if matched["key_type"] == "PROVIDER_NATIVE_ID"
                        else "OFFICIAL_APPLICATION_URL"
                    )
                    await cursor.execute(
                        """
                        insert into public.job_opportunity_postings (
                          opportunity_id, job_id, company_id, decision_id, membership_method
                        ) values (%s, %s, %s, %s, %s)
                        """,
                        (target, job_id, job["company_id"], decision_id, method),
                    )
                    await cursor.execute(
                        """
                        update public.job_opportunities set status = 'SUPERSEDED',
                          superseded_by_id = %s
                        where id = %s and status = 'ACTIVE'
                        """,
                        (target, job["opportunity_id"]),
                    )
                    await cursor.execute("select public.recompute_job_opportunity(%s)", (target,))
                    return OpportunityResolutionResult(
                        job_id, "MATCH", target, reason_codes, len(candidates)
                    )
                if len(targets) > 1:
                    reasons = ("STRONG_KEYS_POINT_TO_MULTIPLE_OPPORTUNITIES",)
                    await self._decision(
                        cursor,
                        job=job,
                        from_opportunity_id=job["opportunity_id"],
                        to_opportunity_id=None,
                        outcome="REVIEW_REQUIRED",
                        reason_codes=reasons,
                        evidence={"targetCount": len(targets)},
                        idempotency_key=f"auto:{RESOLVER_VERSION}:ambiguous:{job_id}",
                    )
                    return OpportunityResolutionResult(
                        job_id,
                        "REVIEW_REQUIRED",
                        job["opportunity_id"],
                        reasons,
                        len(candidates),
                    )

                # Medium evidence is materialized only as review work; it cannot mutate membership.
                await cursor.execute(
                    """
                    select candidate_job.id
                    from public.job_opportunities candidate
                    join public.jobs candidate_job
                      on candidate_job.id = candidate.canonical_source_posting_id
                    where candidate.company_id = %s and candidate.status = 'ACTIVE'
                      and candidate.title_block = public.opportunity_title_block(%s)
                      and candidate.id <> %s
                    order by candidate.id limit 51
                    """,
                    (job["company_id"], job["title"], job["opportunity_id"]),
                )
                review_candidates = await cursor.fetchall()
                for candidate in review_candidates[:50]:
                    left, right = sorted((UUID(str(job_id)), UUID(str(candidate["id"]))))
                    await cursor.execute(
                        """
                        insert into public.job_resolution_reviews (
                          company_id, left_job_id, right_job_id, algorithm_version,
                          reason_codes, evidence
                        ) values (%s, %s, %s, %s, %s, %s)
                        on conflict (left_job_id, right_job_id, algorithm_version)
                          where status = 'PENDING' do nothing
                        """,
                        (
                            job["company_id"],
                            left,
                            right,
                            RESOLVER_VERSION,
                            ["SAME_COMPANY_TITLE_BLOCK_ONLY"],
                            Jsonb({"autoMerge": False}),
                        ),
                    )
                outcome = "REVIEW_REQUIRED" if review_candidates else "NO_MATCH"
                reasons = (
                    ("MEDIUM_EVIDENCE_TITLE_BLOCK_REVIEW_ONLY",)
                    if review_candidates
                    else ("NO_STRONG_IDENTITY_MATCH",)
                )
                await self._decision(
                    cursor,
                    job=job,
                    from_opportunity_id=job["opportunity_id"],
                    to_opportunity_id=None,
                    outcome=outcome,
                    reason_codes=reasons,
                    evidence={"reviewCandidateCount": min(len(review_candidates), 50)},
                    idempotency_key=f"auto:{RESOLVER_VERSION}:{outcome.lower()}:{job_id}",
                )
                return OpportunityResolutionResult(
                    job_id,
                    outcome,
                    job["opportunity_id"],
                    reasons,
                    min(len(review_candidates), 50),
                )

    async def resolve_source(self, source_id: UUID, *, batch_size: int = 500) -> int:
        if batch_size < 1 or batch_size > 1000:
            raise ValueError("batch_size must be between 1 and 1000")
        resolved = 0
        after: UUID | None = None
        while True:
            async with await self._connect() as connection:
                cursor = await connection.execute(
                    """
                    select id from public.jobs
                    where source_id = %s and (%s::uuid is null or id > %s::uuid)
                    order by id limit %s
                    """,
                    (source_id, after, after, batch_size),
                )
                rows = await cursor.fetchall()
            if not rows:
                return resolved
            for row in rows:
                await self.resolve_job(UUID(str(row["id"])))
                resolved += 1
            after = UUID(str(rows[-1]["id"]))
