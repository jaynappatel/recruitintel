from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from recruitintel_collectors.domain.enums import RecruitingEventType, RoleFamily
from recruitintel_collectors.public_web.enums import ReliabilityLevel
from recruitintel_collectors.recruiter_campus.classification import (
    classify_freshness,
    classify_relationship_strength,
)
from recruitintel_collectors.recruiter_campus.enums import (
    FreshnessStatus,
    RecruiterEvidenceType,
    RelationshipStrength,
    UnresolvedRecruiterReason,
)
from recruitintel_collectors.recruiter_campus.extraction import (
    DeterministicRecruiterCampusExtractor,
)
from recruitintel_collectors.recruiter_campus.fingerprints import (
    campus_event_fingerprint,
    recruiter_event_fingerprint,
    recruiter_evidence_fingerprint,
    unresolved_fingerprint,
)
from recruitintel_collectors.recruiter_campus.models import (
    CampusEventCandidate,
    RecruiterCampusExtraction,
    RecruiterCampusRunStats,
    RecruiterCandidate,
    RecruiterObservationInput,
    RelationshipStrengthInput,
    SchoolReference,
    UnresolvedRecruiterReference,
)
from recruitintel_collectors.recruiter_campus.normalization import normalize_title

_RELIABILITY_ORDER = {
    ReliabilityLevel.UNKNOWN: 0,
    ReliabilityLevel.LOW: 1,
    ReliabilityLevel.MEDIUM: 2,
    ReliabilityLevel.HIGH: 3,
    ReliabilityLevel.OFFICIAL: 4,
}

_SCHOOL_EVIDENCE_AGGREGATE = """
    select count(*)::int evidence_count,
           count(distinct e.source_id)::int source_count,
           max(e.observed_at) last_observed_at,
           max(e.confidence) confidence,
           array_agg(distinct e.reliability::text) reliabilities,
           bool_or(coalesce((e.metadata ->> 'title_match')::boolean, false)) title_match,
           bool_or(
             coalesce((e.metadata ->> 'explicit_relationship')::boolean, false)
           ) explicit_relationship
    from public.recruiter_school_evidence link
    join public.recruiter_evidence e on e.id = link.evidence_id
    where link.relationship_id = %s
"""

_ROLE_EVIDENCE_AGGREGATE = """
    select count(*)::int evidence_count,
           count(distinct e.source_id)::int source_count,
           max(e.observed_at) last_observed_at,
           max(e.confidence) confidence,
           array_agg(distinct e.reliability::text) reliabilities,
           bool_or(coalesce((e.metadata ->> 'title_match')::boolean, false)) title_match,
           bool_or(
             coalesce((e.metadata ->> 'explicit_relationship')::boolean, false)
           ) explicit_relationship
    from public.recruiter_role_evidence link
    join public.recruiter_evidence e on e.id = link.evidence_id
    where link.role_focus_id = %s
"""


class PostgresRecruiterCampusRepository:
    def __init__(
        self,
        database_url: str,
        *,
        extractor: DeterministicRecruiterCampusExtractor | None = None,
    ) -> None:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        self.database_url = database_url
        self._extractor = extractor or DeterministicRecruiterCampusExtractor()

    async def _connect(self) -> psycopg.AsyncConnection[dict[str, Any]]:
        return await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)

    @staticmethod
    async def _load_schools(
        connection: psycopg.AsyncConnection[dict[str, Any]],
    ) -> tuple[SchoolReference, ...]:
        cursor = await connection.execute(
            """
            select s.id, s.canonical_name, s.domains,
                   coalesce(
                     array_agg(sa.alias order by sa.alias)
                       filter (where sa.alias is not null), s.aliases
                   ) aliases
            from public.schools s
            left join public.school_aliases sa on sa.school_id = s.id
            group by s.id
            order by s.canonical_name, s.id
            """
        )
        return tuple(
            SchoolReference(
                id=row["id"],
                canonical_name=row["canonical_name"],
                aliases=tuple(row["aliases"] or ()),
                domains=tuple(row["domains"] or ()),
            )
            for row in await cursor.fetchall()
        )

    @staticmethod
    async def _load_observation(
        connection: psycopg.AsyncConnection[dict[str, Any]], observation_id: UUID
    ) -> RecruiterObservationInput:
        cursor = await connection.execute(
            """
            select o.*, c.canonical_name as company_name
            from public.public_recruiting_observations o
            join public.companies c on c.id = o.company_id
            where o.id = %s
            """,
            (observation_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            raise KeyError(f"public recruiting observation {observation_id} was not found")
        metadata = dict(row["metadata"] or {})
        metadata["observation_type"] = row["observation_type"]
        return RecruiterObservationInput(
            observation_id=row["id"],
            company_id=row["company_id"],
            company_name=row["company_name"],
            source_id=row["source_id"],
            source_url=row["source_url"],
            source_reliability=row["reliability_level"],
            title=row["title"],
            evidence_text=row["evidence_text"],
            observed_at=row["last_verified_at"],
            published_at=row["occurred_at"],
            content_hash=row["content_hash"],
            date_start=row["date_start"],
            date_end=row["date_end"],
            date_precision=row["date_precision"],
            date_certainty=row["date_certainty"],
            linked_school_id=row["school_id"],
            confidence=float(row["confidence"]),
            metadata=metadata,
        )

    async def process_document(self, document_id: UUID) -> RecruiterCampusRunStats:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select id from public.public_recruiting_observations
                where document_id = %s
                order by id
                """,
                (document_id,),
            )
            observation_ids = tuple(UUID(str(row["id"])) for row in await cursor.fetchall())
        stats = RecruiterCampusRunStats()
        for observation_id in observation_ids:
            stats = stats.plus(await self.process_observation(observation_id))
        return stats

    async def process_observation(self, observation_id: UUID) -> RecruiterCampusRunStats:
        async with await self._connect() as connection:
            observation = await self._load_observation(connection, observation_id)
            schools = await self._load_schools(connection)
        extraction = self._extractor.extract(observation, schools=schools)
        return await self._persist(observation, extraction)

    @staticmethod
    def _profile_status(
        observation: RecruiterObservationInput, candidate: RecruiterCandidate
    ) -> str:
        freshness = classify_freshness(observation.observed_at)
        if freshness.status is FreshnessStatus.STALE:
            return "STALE"
        if (
            observation.source_reliability in {ReliabilityLevel.OFFICIAL, ReliabilityLevel.HIGH}
            and candidate.explicit_company_match
        ):
            return "ACTIVE"
        return "UNVERIFIED"

    async def _resolve_profile(
        self,
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        observation: RecruiterObservationInput,
        candidate: RecruiterCandidate,
    ) -> tuple[UUID | None, bool, bool]:
        rows: list[dict[str, Any]] = []
        reusable_person_id: UUID | None = None
        if candidate.public_profile_url:
            await cursor.execute(
                """
                select rp.*, rp.categories::text[] category_values, p.normalized_name
                from public.recruiter_profiles rp
                join public.people p on p.id = rp.person_id
                where lower(rp.public_profile_url) = lower(%s)
                """,
                (candidate.public_profile_url,),
            )
            rows = await cursor.fetchall()
            same_company = [row for row in rows if row["company_id"] == observation.company_id]
            if same_company:
                rows = same_company
            elif rows:
                person_ids = {UUID(str(row["person_id"])) for row in rows}
                if len(person_ids) != 1:
                    return None, False, False
                reusable_person_id = person_ids.pop()
                rows = []
        if not rows:
            await cursor.execute(
                """
                select rp.*, rp.categories::text[] category_values, p.normalized_name
                from public.recruiter_profiles rp
                join public.people p on p.id = rp.person_id
                where rp.company_id = %s and p.normalized_name = %s
                order by rp.id
                limit 2
                """,
                (observation.company_id, candidate.normalized_name),
            )
            rows = await cursor.fetchall()
        if len(rows) > 1:
            return None, False, False
        now_status = self._profile_status(observation, candidate)
        if rows:
            row = rows[0]
            existing_categories = tuple(str(value) for value in row["category_values"])
            categories = tuple(
                dict.fromkeys(
                    (*existing_categories, *(value.value for value in candidate.categories))
                )
            )
            should_replace = observation.confidence >= float(row["confidence"])
            await cursor.execute(
                """
                update public.recruiter_profiles set
                  title = case when %s then %s else title end,
                  normalized_title = case when %s then %s else normalized_title end,
                  categories = %s::public.recruiter_role_category[],
                  location = coalesce(%s, location),
                  public_profile_url = coalesce(%s, public_profile_url),
                  last_seen_at = greatest(last_seen_at, %s),
                  last_verified_at = greatest(last_verified_at, %s),
                  confidence = greatest(confidence, %s),
                  status = case
                    when status = 'INACTIVE' then status
                    when %s = 'ACTIVE' then 'ACTIVE'::public.recruiter_profile_status
                    when %s = 'STALE' and status <> 'ACTIVE'
                      then 'STALE'::public.recruiter_profile_status
                    else status
                  end,
                  metadata = metadata || %s
                where id = %s
                """,
                (
                    should_replace,
                    candidate.title,
                    should_replace,
                    candidate.normalized_title,
                    list(categories),
                    candidate.location,
                    candidate.public_profile_url,
                    observation.observed_at,
                    observation.observed_at,
                    observation.confidence,
                    now_status,
                    now_status,
                    Jsonb(candidate.metadata),
                    row["id"],
                ),
            )
            return UUID(str(row["id"])), False, False

        person_created = reusable_person_id is None
        if reusable_person_id is None:
            await cursor.execute(
                """
                insert into public.people (
                  canonical_name, normalized_name, first_name, last_name
                ) values (%s, %s, %s, %s)
                returning id
                """,
                (
                    candidate.canonical_name,
                    candidate.normalized_name,
                    candidate.first_name,
                    candidate.last_name,
                ),
            )
            person = await cursor.fetchone()
            if person is None:
                raise RuntimeError("person insert returned no row")
            reusable_person_id = UUID(str(person["id"]))
        await cursor.execute(
            """
            insert into public.recruiter_profiles (
              person_id, company_id, title, normalized_title, categories, location,
              public_profile_url, source_id, first_seen_at, last_seen_at,
              last_verified_at, confidence, status, metadata
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                reusable_person_id,
                observation.company_id,
                candidate.title,
                candidate.normalized_title,
                [value.value for value in candidate.categories],
                candidate.location,
                candidate.public_profile_url,
                observation.source_id,
                observation.observed_at,
                observation.observed_at,
                observation.observed_at,
                observation.confidence,
                now_status,
                Jsonb(candidate.metadata),
            ),
        )
        profile = await cursor.fetchone()
        if profile is None:
            raise RuntimeError("recruiter profile insert returned no row")
        return UUID(str(profile["id"])), True, person_created

    @staticmethod
    async def _insert_evidence(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        observation: RecruiterObservationInput,
        candidate: RecruiterCandidate,
        profile_id: UUID,
        evidence_type: RecruiterEvidenceType,
        school_id: UUID | None = None,
        role_family: RoleFamily | None = None,
    ) -> tuple[UUID, bool, str]:
        fingerprint = recruiter_evidence_fingerprint(
            profile_id=profile_id,
            source_id=observation.source_id,
            observation_id=observation.observation_id,
            evidence_type=evidence_type,
            content_hash=observation.content_hash,
            school_id=school_id,
            role_family=role_family,
        )
        await cursor.execute(
            """
            insert into public.recruiter_evidence (
              recruiter_profile_id, source_id, public_recruiting_observation_id,
              school_id, role_family, source_url, evidence_type, evidence_text,
              observed_at, published_at, content_hash, fingerprint, reliability,
              confidence, metadata
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (fingerprint) do nothing
            returning id
            """,
            (
                profile_id,
                observation.source_id,
                observation.observation_id,
                school_id,
                role_family.value if role_family else None,
                observation.source_url,
                evidence_type.value,
                observation.evidence_text,
                observation.observed_at,
                observation.published_at,
                observation.content_hash,
                fingerprint,
                observation.source_reliability.value,
                observation.confidence,
                Jsonb(
                    {
                        **candidate.metadata,
                        "title_match": candidate.title_match,
                        "explicit_relationship": True,
                    }
                ),
            ),
        )
        row = await cursor.fetchone()
        created = row is not None
        if row is None:
            await cursor.execute(
                "select id from public.recruiter_evidence where fingerprint = %s",
                (fingerprint,),
            )
            row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("recruiter evidence resolution failed")
        return UUID(str(row["id"])), created, fingerprint

    @staticmethod
    async def _evidence_strength(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        join_table: str,
        join_id_column: str,
        aggregate_id: UUID,
    ) -> tuple[RelationshipStrength, tuple[str, ...], int, float, datetime]:
        query = {
            ("recruiter_school_evidence", "relationship_id"): _SCHOOL_EVIDENCE_AGGREGATE,
            ("recruiter_role_evidence", "role_focus_id"): _ROLE_EVIDENCE_AGGREGATE,
        }.get((join_table, join_id_column))
        if query is None:
            raise ValueError("unsupported relationship evidence projection")
        await cursor.execute(query, (aggregate_id,))
        row = await cursor.fetchone()
        if row is None or row["last_observed_at"] is None:
            raise RuntimeError("relationship evidence aggregation returned no evidence")
        reliabilities = tuple(ReliabilityLevel(value) for value in row["reliabilities"])
        reliability = max(reliabilities, key=_RELIABILITY_ORDER.__getitem__)
        decision = classify_relationship_strength(
            RelationshipStrengthInput(
                reliability=reliability,
                independent_source_count=row["source_count"],
                last_observed_at=row["last_observed_at"],
                title_match=row["title_match"],
                explicit_relationship=row["explicit_relationship"],
            )
        )
        return (
            decision.strength,
            decision.reasons,
            row["evidence_count"],
            float(row["confidence"]),
            row["last_observed_at"],
        )

    async def _link_school(
        self,
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        profile_id: UUID,
        school_id: UUID,
        evidence_id: UUID,
        observed_at: datetime,
    ) -> bool:
        await cursor.execute(
            """
            insert into public.recruiter_school_relationships (
              recruiter_profile_id, school_id, first_seen_at, last_seen_at,
              confidence, evidence_count
            ) values (%s, %s, %s, %s, 0, 0)
            on conflict (recruiter_profile_id, school_id) do update set
              last_seen_at = greatest(
                public.recruiter_school_relationships.last_seen_at,
                excluded.last_seen_at
              )
            returning id, (xmax = 0) as created
            """,
            (profile_id, school_id, observed_at, observed_at),
        )
        relationship = await cursor.fetchone()
        if relationship is None:
            raise RuntimeError("recruiter-school upsert returned no row")
        relationship_id = UUID(str(relationship["id"]))
        await cursor.execute(
            """
            insert into public.recruiter_school_evidence (relationship_id, evidence_id)
            values (%s, %s) on conflict do nothing
            """,
            (relationship_id, evidence_id),
        )
        strength, reasons, count, confidence, last_seen = await self._evidence_strength(
            cursor,
            join_table="recruiter_school_evidence",
            join_id_column="relationship_id",
            aggregate_id=relationship_id,
        )
        freshness = classify_freshness(last_seen)
        status = (
            "STALE"
            if freshness.status is FreshnessStatus.STALE
            else "ACTIVE"
            if strength in {RelationshipStrength.HIGH, RelationshipStrength.MEDIUM}
            else "UNVERIFIED"
        )
        await cursor.execute(
            """
            update public.recruiter_school_relationships set
              last_seen_at = %s, confidence = %s, evidence_count = %s,
              strength = %s, strength_reasons = %s, status = %s
            where id = %s
            """,
            (last_seen, confidence, count, strength.value, list(reasons), status, relationship_id),
        )
        return bool(relationship["created"])

    async def _link_role(
        self,
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        profile_id: UUID,
        role_family: RoleFamily,
        evidence_id: UUID,
        observed_at: datetime,
    ) -> bool:
        await cursor.execute(
            """
            insert into public.recruiter_role_focus (
              recruiter_profile_id, role_family, first_seen_at, last_seen_at,
              evidence_count, confidence
            ) values (%s, %s, %s, %s, 0, 0)
            on conflict (recruiter_profile_id, role_family) do update set
              last_seen_at = greatest(
                public.recruiter_role_focus.last_seen_at, excluded.last_seen_at
              )
            returning id, (xmax = 0) as created
            """,
            (profile_id, role_family.value, observed_at, observed_at),
        )
        focus = await cursor.fetchone()
        if focus is None:
            raise RuntimeError("recruiter-role upsert returned no row")
        focus_id = UUID(str(focus["id"]))
        await cursor.execute(
            """
            insert into public.recruiter_role_evidence (role_focus_id, evidence_id)
            values (%s, %s) on conflict do nothing
            """,
            (focus_id, evidence_id),
        )
        strength, reasons, count, confidence, last_seen = await self._evidence_strength(
            cursor,
            join_table="recruiter_role_evidence",
            join_id_column="role_focus_id",
            aggregate_id=focus_id,
        )
        await cursor.execute(
            """
            update public.recruiter_role_focus set
              last_seen_at = %s, evidence_count = %s, confidence = %s,
              strength = %s, strength_reasons = %s
            where id = %s
            """,
            (last_seen, count, confidence, strength.value, list(reasons), focus_id),
        )
        return bool(focus["created"])

    @staticmethod
    async def _insert_event(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        observation: RecruiterObservationInput,
        event_type: RecruitingEventType,
        causal_key: str,
        recruiter_profile_id: UUID | None = None,
        school_id: UUID | None = None,
        campus_event_id: UUID | None = None,
        payload: dict[str, Any] | None = None,
    ) -> bool:
        fingerprint = recruiter_event_fingerprint(
            company_id=observation.company_id,
            source_id=observation.source_id,
            event_type=event_type,
            causal_key=causal_key,
        )
        await cursor.execute(
            """
            insert into public.recruiting_events (
              company_id, source_id, event_type, occurred_at, discovered_at,
              source_url, confidence, fingerprint, payload,
              public_recruiting_observation_id, recruiter_profile_id, school_id,
              campus_recruiting_event_id
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (fingerprint) do nothing returning id
            """,
            (
                observation.company_id,
                observation.source_id,
                event_type.value,
                observation.published_at or observation.observed_at,
                observation.observed_at,
                observation.source_url,
                observation.confidence,
                fingerprint,
                Jsonb(payload or {}),
                observation.observation_id,
                recruiter_profile_id,
                school_id,
                campus_event_id,
            ),
        )
        return await cursor.fetchone() is not None

    async def _persist_recruiter(
        self,
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        observation: RecruiterObservationInput,
        candidate: RecruiterCandidate,
    ) -> RecruiterCampusRunStats:
        profile_id, profile_created, person_created = await self._resolve_profile(
            cursor, observation, candidate
        )
        if profile_id is None:
            unresolved = UnresolvedRecruiterReference(
                reason=UnresolvedRecruiterReason.AMBIGUOUS_PERSON,
                raw_person_name=candidate.canonical_name,
                raw_title=candidate.title,
                evidence_text=observation.evidence_text,
            )
            created = await self._persist_unresolved(cursor, observation, unresolved)
            return RecruiterCampusRunStats(unresolved_created=int(created))

        evidence_specs: list[tuple[RecruiterEvidenceType, UUID | None, RoleFamily | None]] = []
        evidence_specs.extend(
            (RecruiterEvidenceType.SCHOOL_CONNECTION, school_id, None)
            for school_id in candidate.school_ids
        )
        evidence_specs.extend(
            (RecruiterEvidenceType.ROLE_FOCUS, None, role_family)
            for role_family in candidate.role_families
        )
        if not evidence_specs:
            evidence_specs.append((candidate.evidence_type, None, None))

        evidence_created = 0
        school_links_created = 0
        role_links_created = 0
        activity_events = 0
        for evidence_type, school_id, role_family in evidence_specs:
            evidence_id, created, evidence_fingerprint = await self._insert_evidence(
                cursor,
                observation=observation,
                candidate=candidate,
                profile_id=profile_id,
                evidence_type=evidence_type,
                school_id=school_id,
                role_family=role_family,
            )
            evidence_created += int(created)
            if school_id is not None:
                school_link_created = await self._link_school(
                    cursor,
                    profile_id=profile_id,
                    school_id=school_id,
                    evidence_id=evidence_id,
                    observed_at=observation.observed_at,
                )
                school_links_created += int(school_link_created)
                if created:
                    activity_events += int(
                        await self._insert_event(
                            cursor,
                            observation=observation,
                            event_type=RecruitingEventType.SCHOOL_RECRUITING_SIGNAL,
                            causal_key=f"school-evidence:{evidence_fingerprint}",
                            recruiter_profile_id=profile_id,
                            school_id=school_id,
                            payload={"evidence_type": evidence_type.value},
                        )
                    )
            if role_family is not None:
                role_links_created += int(
                    await self._link_role(
                        cursor,
                        profile_id=profile_id,
                        role_family=role_family,
                        evidence_id=evidence_id,
                        observed_at=observation.observed_at,
                    )
                )
            if created and not profile_created:
                activity_events += int(
                    await self._insert_event(
                        cursor,
                        observation=observation,
                        event_type=RecruitingEventType.RECRUITER_ACTIVITY,
                        causal_key=f"recruiter-evidence:{evidence_fingerprint}",
                        recruiter_profile_id=profile_id,
                        school_id=school_id,
                        payload={
                            "evidence_type": evidence_type.value,
                            "role_family": role_family.value if role_family else None,
                        },
                    )
                )
        if profile_created:
            activity_events += int(
                await self._insert_event(
                    cursor,
                    observation=observation,
                    event_type=RecruitingEventType.RECRUITER_DISCOVERED,
                    causal_key=f"recruiter-profile:{profile_id}",
                    recruiter_profile_id=profile_id,
                    payload={
                        "categories": [value.value for value in candidate.categories],
                        "title": candidate.title,
                    },
                )
            )
        return RecruiterCampusRunStats(
            people_created=int(person_created),
            recruiters_created=int(profile_created),
            evidence_created=evidence_created,
            school_links_created=school_links_created,
            role_links_created=role_links_created,
            events_created=activity_events,
        )

    async def _persist_campus_event(
        self,
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        observation: RecruiterObservationInput,
        candidate: CampusEventCandidate,
    ) -> tuple[UUID, bool, bool]:
        date_key = (
            candidate.starts_at.isoformat()
            if candidate.starts_at
            else candidate.date_start.isoformat()
            if candidate.date_start
            else None
        )
        fingerprint = campus_event_fingerprint(
            company_id=observation.company_id,
            event_type=candidate.event_type,
            school_id=candidate.school_id,
            date_key=date_key,
            normalized_title=normalize_title(candidate.title),
        )
        await cursor.execute(
            """
            insert into public.campus_recruiting_events (
              company_id, school_id, title, event_type, description, starts_at, ends_at,
              date_start, date_end, date_precision, date_certainty, location, is_virtual,
              registration_url, source_id, public_recruiting_observation_id, source_url,
              first_seen_at, last_verified_at, content_hash, confidence, fingerprint, metadata
            ) values (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s, %s
            )
            on conflict (fingerprint) do update set
              last_verified_at = greatest(
                public.campus_recruiting_events.last_verified_at,
                excluded.last_verified_at
              )
            returning id, (xmax = 0) as created
            """,
            (
                observation.company_id,
                candidate.school_id,
                candidate.title,
                candidate.event_type.value,
                candidate.description,
                candidate.starts_at,
                candidate.ends_at,
                candidate.date_start,
                candidate.date_end,
                candidate.date_precision.value,
                candidate.date_certainty.value,
                candidate.location,
                candidate.is_virtual,
                candidate.registration_url,
                observation.source_id,
                observation.observation_id,
                observation.source_url,
                observation.observed_at,
                observation.observed_at,
                observation.content_hash,
                observation.confidence,
                fingerprint,
                Jsonb(candidate.metadata),
            ),
        )
        row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("campus event upsert returned no row")
        event_id = UUID(str(row["id"]))
        event_created = bool(row["created"])
        await cursor.execute(
            """
            insert into public.campus_recruiting_event_evidence (
              campus_event_id, public_recruiting_observation_id, source_id, observed_at
            ) values (%s, %s, %s, %s)
            on conflict do nothing
            """,
            (
                event_id,
                observation.observation_id,
                observation.source_id,
                observation.observed_at,
            ),
        )
        recruiting_event_created = False
        if event_created:
            recruiting_event_created = await self._insert_event(
                cursor,
                observation=observation,
                event_type=RecruitingEventType.CAMPUS_EVENT_DISCOVERED,
                causal_key=f"campus-event:{fingerprint}",
                school_id=candidate.school_id,
                campus_event_id=event_id,
                payload={
                    "event_type": candidate.event_type.value,
                    "date_precision": candidate.date_precision.value,
                    "date_certainty": candidate.date_certainty.value,
                },
            )
        return event_id, event_created, recruiting_event_created

    @staticmethod
    async def _persist_unresolved(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        observation: RecruiterObservationInput,
        candidate: UnresolvedRecruiterReference,
    ) -> bool:
        identity = "|".join(
            value or ""
            for value in (
                candidate.raw_person_name,
                candidate.raw_company_name,
                candidate.raw_school_name,
                candidate.raw_title,
            )
        )
        fingerprint = unresolved_fingerprint(
            observation_id=observation.observation_id,
            reason=candidate.reason,
            identity=identity,
        )
        await cursor.execute(
            """
            insert into public.unresolved_recruiter_observations (
              company_id, source_id, public_recruiting_observation_id, raw_person_name,
              raw_company_name, raw_school_name, raw_title, reason, source_url,
              evidence_text, observed_at, content_hash, fingerprint, metadata
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (fingerprint) do nothing returning id
            """,
            (
                observation.company_id,
                observation.source_id,
                observation.observation_id,
                candidate.raw_person_name,
                candidate.raw_company_name,
                candidate.raw_school_name,
                candidate.raw_title,
                candidate.reason.value,
                observation.source_url,
                candidate.evidence_text,
                observation.observed_at,
                observation.content_hash,
                fingerprint,
                Jsonb(candidate.metadata),
            ),
        )
        return await cursor.fetchone() is not None

    async def _link_campus_recruiters(
        self,
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        observation: RecruiterObservationInput,
        campus_event_ids: Sequence[UUID],
    ) -> None:
        if not campus_event_ids:
            return
        await cursor.execute(
            """
            select distinct e.id evidence_id, e.recruiter_profile_id
            from public.recruiter_evidence e
            where e.public_recruiting_observation_id = %s
            order by e.id
            """,
            (observation.observation_id,),
        )
        evidence = await cursor.fetchall()
        for campus_event_id in campus_event_ids:
            for row in evidence:
                await cursor.execute(
                    """
                    insert into public.campus_event_recruiters (
                      campus_event_id, recruiter_profile_id, evidence_id
                    ) values (%s, %s, %s)
                    on conflict do nothing
                    """,
                    (campus_event_id, row["recruiter_profile_id"], row["evidence_id"]),
                )

    async def _persist(
        self,
        observation: RecruiterObservationInput,
        extraction: RecruiterCampusExtraction,
    ) -> RecruiterCampusRunStats:
        stats = RecruiterCampusRunStats(observations_processed=1)
        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = connection.cursor()
                await cursor.execute(
                    "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"recruiter-campus-observation:{observation.observation_id}",),
                )
                for recruiter_candidate in extraction.recruiters:
                    stats = stats.plus(
                        await self._persist_recruiter(cursor, observation, recruiter_candidate)
                    )
                campus_event_ids: list[UUID] = []
                for campus_candidate in extraction.campus_events:
                    (
                        event_id,
                        event_created,
                        recruiting_event_created,
                    ) = await self._persist_campus_event(cursor, observation, campus_candidate)
                    campus_event_ids.append(event_id)
                    stats = stats.plus(
                        RecruiterCampusRunStats(
                            campus_events_created=int(event_created),
                            events_created=int(recruiting_event_created),
                        )
                    )
                await self._link_campus_recruiters(cursor, observation, campus_event_ids)
                for unresolved_candidate in extraction.unresolved:
                    created = await self._persist_unresolved(
                        cursor, observation, unresolved_candidate
                    )
                    stats = stats.plus(RecruiterCampusRunStats(unresolved_created=int(created)))
        return stats
