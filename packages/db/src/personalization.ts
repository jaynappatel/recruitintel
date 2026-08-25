import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";

import { getDatabase } from "./index";
import { recordProductEventWith } from "./instrumentation";
import type { OpportunityRecord } from "./opportunities";
import {
  RECOMMENDATION_ALGORITHM,
  RECOMMENDATION_ALGORITHM_VERSION,
  scoreOpportunityRecommendation,
  type OpportunityLocationFact,
  type PreferredLocation,
  type RecommendationOpportunityFacts,
  type RecruitingPreferenceSnapshot,
} from "./recommendation-scoring";

type QuerySql = Sql | TransactionSql;
type Row = Record<string, unknown>;

export class PersonalizationNotFoundError extends Error {}
export class PersonalizationConflictError extends Error {}

const text = (value: unknown) => String(value);
const nullableText = (value: unknown) =>
  value === null || value === undefined ? null : text(value);
const timestamp = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
const nullableTimestamp = (value: unknown) =>
  value === null || value === undefined ? null : timestamp(value);
const stringArray = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
const numberArray = (value: unknown) => (Array.isArray(value) ? value.map(Number) : []);
const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new PersonalizationConflictError("Cursor is invalid");
  }
}

function recommendationCursorKey(): string {
  return (
    process.env.RECOMMENDATION_CURSOR_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    "recruitintel-local-recommendation-cursor-v1"
  );
}

function encodeRecommendationCursor(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", recommendationCursorKey())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function decodeRecommendationCursor(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const [body, supplied, extra] = value.split(".");
  if (!body || !supplied || extra) throw new PersonalizationConflictError("Cursor is invalid");
  const expected = createHmac("sha256", recommendationCursorKey()).update(body).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(supplied, "base64url");
  } catch {
    throw new PersonalizationConflictError("Cursor is invalid");
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new PersonalizationConflictError("Cursor is invalid");
  }
  return decodeCursor(body);
}

export interface PreferredLocationInput extends PreferredLocation {
  displayLabel: string;
}

export interface RecruitingPreferencesPatch {
  graduationYear?: number | null;
  usWorkAuthorized?: boolean | null;
  requiresEmployerSponsorship?: boolean | null;
  roleFamilies?: string[];
  earlyCareerTracks?: Array<"INTERNSHIP" | "NEW_GRAD">;
  experienceLevels?: string[];
  workplaceModes?: Array<"REMOTE" | "HYBRID" | "ONSITE">;
  locations?: PreferredLocationInput[];
  targetSchoolIds?: string[];
}

export interface RecruitingPreferencesRecord extends RecruitingPreferenceSnapshot {
  locations: Array<PreferredLocationInput & { id: string }>;
  targetSchools: Array<{ id: string; name: string; slug: string }>;
  version: number;
  updatedAt: string;
}

function normalizedLocationKey(location: PreferredLocationInput): string {
  return [
    location.kind,
    location.city ?? "",
    location.region ?? "",
    location.countryCode ?? "",
    location.remoteRegion ?? "",
  ]
    .map((part) => part.trim().toLocaleLowerCase("en-US"))
    .join("|");
}

async function getRecruitingPreferencesWith(
  sql: QuerySql,
  userId: string,
): Promise<RecruitingPreferencesRecord> {
  const [scalar] = await sql`
    select preference.graduation_year, preference.us_work_authorized,
      preference.requires_employer_sponsorship,
      coalesce(preference.preference_version, 1)::int as preference_version,
      coalesce(preference.updated_at, user_row.created_at) as updated_at
    from public.users user_row
    left join public.user_recruiting_preferences preference on preference.user_id = user_row.id
    where user_row.id = ${userId}::uuid
  `;
  if (!scalar) throw new PersonalizationNotFoundError("User was not found");
  const [roles, tracks, levels, modes, locations, schools] = await Promise.all([
    sql`select role_family::text as value from public.user_preferred_role_families
        where user_id = ${userId}::uuid order by role_family::text`,
    sql`select track::text as value from public.user_preferred_early_career_tracks
        where user_id = ${userId}::uuid order by track::text`,
    sql`select experience_level::text as value from public.user_preferred_experience_levels
        where user_id = ${userId}::uuid order by experience_level::text`,
    sql`select workplace_mode::text as value from public.user_preferred_workplace_modes
        where user_id = ${userId}::uuid order by workplace_mode::text`,
    sql`select id, kind::text, city, region, country_code, remote_region, display_label
        from public.user_preferred_locations where user_id = ${userId}::uuid
        order by normalized_key, id`,
    sql`select school.id, school.canonical_name, school.slug
        from public.user_target_schools target join public.schools school on school.id = target.school_id
        where target.user_id = ${userId}::uuid order by school.canonical_name, school.id`,
  ]);
  return {
    graduationYear: scalar.graduation_year === null ? null : Number(scalar.graduation_year),
    usWorkAuthorized:
      scalar.us_work_authorized === null ? null : Boolean(scalar.us_work_authorized),
    requiresEmployerSponsorship:
      scalar.requires_employer_sponsorship === null
        ? null
        : Boolean(scalar.requires_employer_sponsorship),
    roleFamilies: roles.map((row) => text(row.value)),
    earlyCareerTracks: tracks.map((row) => text(row.value)) as Array<"INTERNSHIP" | "NEW_GRAD">,
    experienceLevels: levels.map((row) => text(row.value)),
    workplaceModes: modes.map((row) => text(row.value)) as Array<"REMOTE" | "HYBRID" | "ONSITE">,
    locations: locations.map((row) => ({
      id: text(row.id),
      kind: text(row.kind) as PreferredLocation["kind"],
      city: nullableText(row.city),
      region: nullableText(row.region),
      countryCode: nullableText(row.country_code),
      remoteRegion: nullableText(row.remote_region),
      displayLabel: text(row.display_label),
    })),
    targetSchools: schools.map((row) => ({
      id: text(row.id),
      name: text(row.canonical_name),
      slug: text(row.slug),
    })),
    version: Number(scalar.preference_version),
    updatedAt: timestamp(scalar.updated_at),
  };
}

export async function getRecruitingPreferences(userId: string) {
  return getRecruitingPreferencesWith(getDatabase(), userId);
}

export async function updateRecruitingPreferences(
  userId: string,
  patch: RecruitingPreferencesPatch,
): Promise<RecruitingPreferencesRecord> {
  return getDatabase().begin(async (transaction) => {
    const before = await getRecruitingPreferencesWith(transaction, userId);
    const sameStrings = (left: string[], right: string[]) =>
      JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
    const material =
      (Object.hasOwn(patch, "graduationYear") && patch.graduationYear !== before.graduationYear) ||
      (Object.hasOwn(patch, "usWorkAuthorized") &&
        patch.usWorkAuthorized !== before.usWorkAuthorized) ||
      (Object.hasOwn(patch, "requiresEmployerSponsorship") &&
        patch.requiresEmployerSponsorship !== before.requiresEmployerSponsorship) ||
      (Object.hasOwn(patch, "roleFamilies") &&
        !sameStrings(patch.roleFamilies ?? [], before.roleFamilies)) ||
      (Object.hasOwn(patch, "earlyCareerTracks") &&
        !sameStrings(patch.earlyCareerTracks ?? [], before.earlyCareerTracks)) ||
      (Object.hasOwn(patch, "experienceLevels") &&
        !sameStrings(patch.experienceLevels ?? [], before.experienceLevels)) ||
      (Object.hasOwn(patch, "workplaceModes") &&
        !sameStrings(patch.workplaceModes ?? [], before.workplaceModes)) ||
      (Object.hasOwn(patch, "locations") &&
        !sameStrings(
          (patch.locations ?? []).map(normalizedLocationKey),
          before.locations.map(normalizedLocationKey),
        )) ||
      (Object.hasOwn(patch, "targetSchoolIds") &&
        !sameStrings(
          patch.targetSchoolIds ?? [],
          before.targetSchools.map((school) => school.id),
        ));
    if (!material) return before;
    await transaction`
      insert into public.user_recruiting_preferences (
        user_id, graduation_year, us_work_authorized, requires_employer_sponsorship
      ) values (
        ${userId}::uuid, ${patch.graduationYear ?? null}, ${patch.usWorkAuthorized ?? null},
        ${patch.requiresEmployerSponsorship ?? null}
      ) on conflict (user_id) do update set
        graduation_year = case when ${Object.hasOwn(patch, "graduationYear")}
          then excluded.graduation_year else public.user_recruiting_preferences.graduation_year end,
        us_work_authorized = case when ${Object.hasOwn(patch, "usWorkAuthorized")}
          then excluded.us_work_authorized else public.user_recruiting_preferences.us_work_authorized end,
        requires_employer_sponsorship = case
          when ${Object.hasOwn(patch, "requiresEmployerSponsorship")}
          then excluded.requires_employer_sponsorship
          else public.user_recruiting_preferences.requires_employer_sponsorship end,
        preference_version = public.user_recruiting_preferences.preference_version + 1
    `;

    const replacements: Array<{
      present: boolean;
      table: string;
      column: string;
      values: string[] | undefined;
      cast: string;
    }> = [
      {
        present: Object.hasOwn(patch, "roleFamilies"),
        table: "user_preferred_role_families",
        column: "role_family",
        values: patch.roleFamilies,
        cast: "public.role_family",
      },
      {
        present: Object.hasOwn(patch, "earlyCareerTracks"),
        table: "user_preferred_early_career_tracks",
        column: "track",
        values: patch.earlyCareerTracks,
        cast: "public.early_career_track",
      },
      {
        present: Object.hasOwn(patch, "experienceLevels"),
        table: "user_preferred_experience_levels",
        column: "experience_level",
        values: patch.experienceLevels,
        cast: "public.experience_level",
      },
      {
        present: Object.hasOwn(patch, "workplaceModes"),
        table: "user_preferred_workplace_modes",
        column: "workplace_mode",
        values: patch.workplaceModes,
        cast: "public.workplace_mode",
      },
    ];
    for (const replacement of replacements) {
      if (!replacement.present) continue;
      await transaction.unsafe(`delete from public.${replacement.table} where user_id = $1::uuid`, [
        userId,
      ]);
      for (const value of [...new Set(replacement.values ?? [])].sort()) {
        await transaction.unsafe(
          `insert into public.${replacement.table} (user_id, ${replacement.column})
           values ($1::uuid, $2::${replacement.cast})`,
          [userId, value],
        );
      }
    }

    if (Object.hasOwn(patch, "locations")) {
      await transaction`delete from public.user_preferred_locations where user_id = ${userId}::uuid`;
      const byKey = new Map(
        (patch.locations ?? []).map((value) => [normalizedLocationKey(value), value]),
      );
      for (const [key, location] of [...byKey].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        await transaction`
          insert into public.user_preferred_locations (
            user_id, kind, city, region, country_code, remote_region, normalized_key, display_label
          ) values (
            ${userId}::uuid, ${location.kind}, ${location.city ?? null}, ${location.region ?? null},
            ${location.countryCode ?? null}, ${location.remoteRegion ?? null}, ${key},
            ${location.displayLabel}
          )
        `;
      }
    }
    if (Object.hasOwn(patch, "targetSchoolIds")) {
      const schoolIds = [...new Set(patch.targetSchoolIds ?? [])].sort();
      if (schoolIds.length) {
        const [count] = await transaction`
          select count(*)::int as count from public.schools where id = any(${schoolIds}::uuid[])
        `;
        if (Number(count?.count) !== schoolIds.length) {
          throw new PersonalizationNotFoundError("One or more target schools were not found");
        }
      }
      await transaction`delete from public.user_target_schools where user_id = ${userId}::uuid`;
      for (const schoolId of schoolIds) {
        await transaction`insert into public.user_target_schools (user_id, school_id)
          values (${userId}::uuid, ${schoolId}::uuid)`;
      }
    }
    return getRecruitingPreferencesWith(transaction, userId);
  });
}

export type WatchEntityType = "COMPANY" | "OPPORTUNITY" | "RECRUITER" | "SCHOOL";
export interface WatchlistItemRecord {
  id: string;
  entityType: WatchEntityType;
  entityId: string;
  entityLabel: string;
  entityHref: string;
  state: "ACTIVE" | "REMOVED" | "SUPERSEDED";
  origin: "USER" | "MIGRATED_SOURCE_POSTING" | "SUCCESSOR_FOLLOW";
  reason: string;
  notificationOverride: "INHERIT" | "ENABLED" | "DISABLED";
  successorPolicy: "MANUAL" | "AUTO_FOLLOW_DIRECT";
  resolvedSuccessor: { id: string; label: string; href: string } | null;
  createdAt: string;
  removedAt: string | null;
  supersededAt: string | null;
}

function mapWatch(row: Row): WatchlistItemRecord {
  const type = text(row.item_type) as WatchEntityType;
  const entityId = text(row.entity_id);
  const hrefPrefix = {
    COMPANY: "/companies/",
    OPPORTUNITY: "/opportunities/",
    RECRUITER: "/recruiters/",
    SCHOOL: "/schools/",
  }[type];
  return {
    id: text(row.id),
    entityType: type,
    entityId,
    entityLabel: text(row.entity_label),
    entityHref: `${hrefPrefix}${type === "COMPANY" || type === "SCHOOL" ? text(row.entity_slug) : entityId}`,
    state: text(row.state) as WatchlistItemRecord["state"],
    origin: text(row.origin) as WatchlistItemRecord["origin"],
    reason: text(row.watch_reason),
    notificationOverride: text(
      row.notification_override,
    ) as WatchlistItemRecord["notificationOverride"],
    successorPolicy: text(row.successor_policy) as WatchlistItemRecord["successorPolicy"],
    resolvedSuccessor: row.successor_id
      ? {
          id: text(row.successor_id),
          label: text(row.successor_label),
          href: `/opportunities/${text(row.successor_id)}`,
        }
      : null,
    createdAt: timestamp(row.created_at),
    removedAt: nullableTimestamp(row.removed_at),
    supersededAt: nullableTimestamp(row.superseded_at),
  };
}

const watchSelect = `
  select watch.*, coalesce(watch.company_id, watch.opportunity_id,
      watch.recruiter_profile_id, watch.school_id) as entity_id,
    case watch.item_type
      when 'COMPANY' then company.canonical_name
      when 'OPPORTUNITY' then opportunity.normalized_title
      when 'RECRUITER' then person.canonical_name
      when 'SCHOOL' then school.canonical_name end as entity_label,
    coalesce(company.slug, school.slug, '') as entity_slug,
    case when opportunity.status = 'SUPERSEDED' and final.id <> opportunity.id
      then final.id end as successor_id,
    successor.normalized_title as successor_label
  from public.watchlist_items watch
  left join public.companies company on company.id = watch.company_id
  left join public.job_opportunities opportunity on opportunity.id = watch.opportunity_id
  left join lateral (
    with recursive chain as (
      select opportunity.id, opportunity.superseded_by_id, 0 as depth
      where opportunity.id is not null
      union all
      select next.id, next.superseded_by_id, chain.depth + 1
      from chain join public.job_opportunities next on next.id = chain.superseded_by_id
      where chain.depth < 20
    ) select id from chain order by depth desc limit 1
  ) final on opportunity.status = 'SUPERSEDED'
  left join public.job_opportunities successor on successor.id = final.id and final.id <> opportunity.id
  left join public.recruiter_profiles recruiter on recruiter.id = watch.recruiter_profile_id
  left join public.people person on person.id = recruiter.person_id
  left join public.schools school on school.id = watch.school_id
`;

export async function listWatchlist(
  userId: string,
  options: { state?: string; entityType?: WatchEntityType; limit?: number; cursor?: string } = {},
): Promise<{ items: WatchlistItemRecord[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const cursor = decodeCursor(options.cursor);
  if (cursor && (typeof cursor.at !== "string" || typeof cursor.id !== "string")) {
    throw new PersonalizationConflictError("Watchlist cursor is invalid");
  }
  const cursorAt = cursor && typeof cursor.at === "string" ? cursor.at : null;
  const cursorId = cursor && typeof cursor.id === "string" ? cursor.id : null;
  const rows = await getDatabase().unsafe(
    `${watchSelect}
     where watch.user_id = $1::uuid and ($2::text is null or watch.state::text = $2)
       and ($3::text is null or watch.item_type::text = $3)
       and ($4::timestamptz is null or (watch.created_at, watch.id) < ($4::timestamptz, $5::uuid))
     order by watch.created_at desc, watch.id desc limit $6`,
    [userId, options.state ?? null, options.entityType ?? null, cursorAt, cursorId, limit + 1],
  );
  const page = rows.slice(0, limit).map(mapWatch);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      rows.length > limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}

export async function addWatchlistItem(
  userId: string,
  input: {
    entityType: WatchEntityType;
    entityId: string;
    reason: string;
    notificationOverride: string;
    successorPolicy: string;
  },
): Promise<{ item: WatchlistItemRecord; created: boolean }> {
  return getDatabase().begin(async (transaction) => {
    let inserted: Row[];
    let existing: Row[];
    if (input.entityType === "COMPANY") {
      const [target] =
        await transaction`select id from public.companies where id = ${input.entityId}::uuid`;
      if (!target) throw new PersonalizationNotFoundError("Watch target was not found");
      inserted = await transaction`
        insert into public.watchlist_items (
          user_id, item_type, company_id, watch_reason, notification_override, successor_policy
        ) values (
          ${userId}::uuid, 'COMPANY', ${input.entityId}::uuid, ${input.reason},
          ${input.notificationOverride}, ${input.successorPolicy}
        ) on conflict (user_id, company_id)
          where state = 'ACTIVE' and company_id is not null do nothing returning id
      `;
      existing = await transaction`select id from public.watchlist_items
        where user_id = ${userId}::uuid and company_id = ${input.entityId}::uuid
          and state = 'ACTIVE'`;
    } else if (input.entityType === "OPPORTUNITY") {
      const [target] = await transaction`select id from public.job_opportunities
        where id = ${input.entityId}::uuid`;
      if (!target) throw new PersonalizationNotFoundError("Watch target was not found");
      inserted = await transaction`
        insert into public.watchlist_items (
          user_id, item_type, opportunity_id, watch_reason, notification_override, successor_policy
        ) values (
          ${userId}::uuid, 'OPPORTUNITY', ${input.entityId}::uuid, ${input.reason},
          ${input.notificationOverride}, ${input.successorPolicy}
        ) on conflict (user_id, opportunity_id)
          where state = 'ACTIVE' and opportunity_id is not null do nothing returning id
      `;
      existing = await transaction`select id from public.watchlist_items
        where user_id = ${userId}::uuid and opportunity_id = ${input.entityId}::uuid
          and state = 'ACTIVE'`;
    } else if (input.entityType === "RECRUITER") {
      const [target] = await transaction`select id from public.recruiter_profiles
        where id = ${input.entityId}::uuid`;
      if (!target) throw new PersonalizationNotFoundError("Watch target was not found");
      inserted = await transaction`
        insert into public.watchlist_items (
          user_id, item_type, recruiter_profile_id, watch_reason,
          notification_override, successor_policy
        ) values (
          ${userId}::uuid, 'RECRUITER', ${input.entityId}::uuid, ${input.reason},
          ${input.notificationOverride}, ${input.successorPolicy}
        ) on conflict (user_id, recruiter_profile_id)
          where state = 'ACTIVE' and recruiter_profile_id is not null do nothing returning id
      `;
      existing = await transaction`select id from public.watchlist_items
        where user_id = ${userId}::uuid and recruiter_profile_id = ${input.entityId}::uuid
          and state = 'ACTIVE'`;
    } else {
      const [target] =
        await transaction`select id from public.schools where id = ${input.entityId}::uuid`;
      if (!target) throw new PersonalizationNotFoundError("Watch target was not found");
      inserted = await transaction`
        insert into public.watchlist_items (
          user_id, item_type, school_id, watch_reason, notification_override, successor_policy
        ) values (
          ${userId}::uuid, 'SCHOOL', ${input.entityId}::uuid, ${input.reason},
          ${input.notificationOverride}, ${input.successorPolicy}
        ) on conflict (user_id, school_id)
          where state = 'ACTIVE' and school_id is not null do nothing returning id
      `;
      existing = await transaction`select id from public.watchlist_items
        where user_id = ${userId}::uuid and school_id = ${input.entityId}::uuid
          and state = 'ACTIVE'`;
    }
    const id = inserted[0]?.id ? text(inserted[0].id) : text(existing[0]?.id);
    const [row] = await transaction.unsafe(
      `${watchSelect} where watch.id = $1::uuid and watch.user_id = $2::uuid`,
      [id, userId],
    );
    if (!row) throw new PersonalizationNotFoundError("Watchlist item was not found");
    if (inserted[0]) {
      await recordProductEventWith(transaction, {
        userId,
        eventType: "WATCHLIST_ADDED",
        source: "SERVER",
        entityType: input.entityType,
        entityId: input.entityId,
        deduplicationKey: `watchlist-added:${id}`,
        context: { watchlistItemId: id, reasonCode: input.reason },
      });
      if (input.entityType === "OPPORTUNITY") {
        await recordProductEventWith(transaction, {
          userId,
          eventType: "OPPORTUNITY_SAVED",
          source: "SERVER",
          entityType: "OPPORTUNITY",
          entityId: input.entityId,
          deduplicationKey: `opportunity-saved:${id}`,
        });
      }
    }
    return { item: mapWatch(row), created: Boolean(inserted[0]) };
  });
}

export async function removeWatchlistItem(userId: string, itemId: string): Promise<void> {
  await getDatabase().begin(async (transaction) => {
    const [row] = await transaction`
      update public.watchlist_items set state = 'REMOVED', removed_at = now()
      where id = ${itemId}::uuid and user_id = ${userId}::uuid and state = 'ACTIVE'
      returning id, item_type::text, coalesce(company_id, opportunity_id,
        recruiter_profile_id, school_id) as entity_id
    `;
    if (!row) {
      const [owned] = await transaction`select id from public.watchlist_items
        where id = ${itemId}::uuid and user_id = ${userId}::uuid`;
      if (owned) return;
      throw new PersonalizationNotFoundError("Watchlist item was not found");
    }
    await recordProductEventWith(transaction, {
      userId,
      eventType: "WATCHLIST_REMOVED",
      source: "SERVER",
      entityType: text(row.item_type) as "COMPANY" | "OPPORTUNITY" | "RECRUITER" | "SCHOOL",
      entityId: text(row.entity_id),
      deduplicationKey: `watchlist-removed:${itemId}`,
      context: { watchlistItemId: itemId },
    });
  });
}

export async function updateWatchlistItem(
  userId: string,
  itemId: string,
  patch: { notificationOverride?: string; successorPolicy?: string },
): Promise<WatchlistItemRecord> {
  const [updated] = await getDatabase()`
    update public.watchlist_items set
      notification_override = case when ${Object.hasOwn(patch, "notificationOverride")}
        then ${patch.notificationOverride ?? "INHERIT"}::public.watch_notification_override
        else notification_override end,
      successor_policy = case when ${Object.hasOwn(patch, "successorPolicy")}
        then ${patch.successorPolicy ?? "MANUAL"}::public.watch_successor_policy
        else successor_policy end
    where id = ${itemId}::uuid and user_id = ${userId}::uuid and state = 'ACTIVE'
    returning id
  `;
  if (!updated) throw new PersonalizationNotFoundError("Active watchlist item was not found");
  const [row] = await getDatabase().unsafe(
    `${watchSelect} where watch.id = $1::uuid and watch.user_id = $2::uuid`,
    [itemId, userId],
  );
  if (!row) throw new PersonalizationNotFoundError("Watchlist item was not found");
  return mapWatch(row);
}

function mapOpportunity(row: Row): OpportunityRecord {
  return {
    id: text(row.id),
    company: {
      id: text(row.company_id),
      name: text(row.company_name),
      slug: text(row.company_slug),
    },
    title: text(row.canonical_title),
    normalizedTitle: text(row.normalized_title),
    roleFamily: text(row.role_family),
    experienceLevel: text(row.experience_level),
    employmentType: text(row.employment_type),
    isInternship: Boolean(row.is_internship),
    isNewGrad: Boolean(row.is_new_grad),
    season: nullableText(row.season),
    graduationYears: numberArray(row.graduation_years),
    location: text(row.location_summary),
    workplaceMode: text(row.workplace_mode),
    applicationUrl: nullableText(row.canonical_application_url),
    firstSeenAt: timestamp(row.earliest_first_seen_at),
    lastSeenAt: timestamp(row.latest_last_seen_at),
    publishedAt: nullableTimestamp(row.published_at),
    deadlineAt: nullableTimestamp(row.deadline_at),
    lifecycleStatus: text(row.lifecycle_status) as OpportunityRecord["lifecycleStatus"],
    status: text(row.status) as OpportunityRecord["status"],
    supersededById: nullableText(row.superseded_by_id),
    sourceCount: Number(row.source_count),
    mergeConfidence: Number(row.merge_confidence),
    canonicalizationVersion: Number(row.canonicalization_version),
    lifecycleReason: jsonObject(row.lifecycle_reason),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function opportunityFacts(row: Row): RecommendationOpportunityFacts {
  const locations = Array.isArray(row.locations) ? row.locations : [];
  const constraints = Array.isArray(row.constraints) ? row.constraints : [];
  const hasConstraint = (type: string) =>
    constraints.some((value) => jsonObject(value).type === type) ? true : null;
  return {
    opportunityId: text(row.id),
    companyId: text(row.company_id),
    status: text(row.status) as RecommendationOpportunityFacts["status"],
    lifecycleStatus: text(
      row.lifecycle_status,
    ) as RecommendationOpportunityFacts["lifecycleStatus"],
    roleFamily: text(row.role_family),
    experienceLevel: text(row.experience_level),
    isInternship: Boolean(row.is_internship),
    isNewGrad: Boolean(row.is_new_grad),
    graduationYears: numberArray(row.graduation_years),
    workplaceMode: text(row.workplace_mode) as RecommendationOpportunityFacts["workplaceMode"],
    locations: locations.map((value) => {
      const location = jsonObject(value);
      return {
        city: nullableText(location.city),
        region: nullableText(location.region),
        countryCode: nullableText(location.countryCode),
        remoteRegion: nullableText(location.remoteRegion),
      } satisfies OpportunityLocationFact;
    }),
    effectiveOpenedAt: timestamp(row.effective_opened_at),
    deadlineAt: nullableTimestamp(row.deadline_at),
    deadlineReliable: Boolean(row.deadline_reliable),
    sourceAuthority: text(
      row.source_authority,
    ) as RecommendationOpportunityFacts["sourceAuthority"],
    sourceAuthorityReviewed: Boolean(row.source_authority_reviewed),
    sponsorshipAvailable: hasConstraint("SPONSORSHIP_AVAILABLE"),
    sponsorshipUnavailable: hasConstraint("SPONSORSHIP_UNAVAILABLE"),
    workAuthorizationRequired:
      hasConstraint("WORK_AUTHORIZATION_REQUIRED") ?? hasConstraint("CITIZENSHIP_REQUIRED"),
  };
}

export interface OpportunityRecommendationRecord {
  impressionId: string;
  opportunity: OpportunityRecord;
  recommendationScore: number | null;
  category: string;
  eligibility: string;
  evidenceCoverage: string;
  availableWeight: number;
  reasons: string[];
  potentialMismatches: string[];
  hardConstraints: string[];
  generatedAt: string;
  algorithmVersion: string;
}

type RankedCandidate = {
  row: Row;
  result: ReturnType<typeof scoreOpportunityRecommendation>;
};

function categoryOrder(category: string): number {
  return { HIGH_PRIORITY: 0, MEDIUM_PRIORITY: 1, LOW_PRIORITY: 2, NOT_ELIGIBLE: 3 }[category] ?? 4;
}

function eligibilityOrder(eligibility: string): number {
  return { ELIGIBLE: 0, UNKNOWN: 1, NOT_ELIGIBLE: 2 }[eligibility] ?? 3;
}

export async function listOpportunityRecommendations(
  userId: string,
  options: {
    limit?: number;
    cursor?: string;
    includeLowPriority?: boolean;
    includeIneligible?: boolean;
    company?: string;
    roleFamily?: string;
  } = {},
): Promise<{ items: OpportunityRecommendationRecord[]; nextCursor: string | null }> {
  const cursor = decodeRecommendationCursor(options.cursor);
  const asOfValue = cursor?.asOf;
  if (cursor && (typeof asOfValue !== "string" || Number.isNaN(Date.parse(asOfValue)))) {
    throw new PersonalizationConflictError("Recommendation cursor is invalid");
  }
  const asOf = new Date(typeof asOfValue === "string" ? asOfValue : Date.now());
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  return getDatabase().begin(async (transaction) => {
    const preferences = await getRecruitingPreferencesWith(transaction, userId);
    const filterFingerprint = sha256(
      JSON.stringify({
        company: options.company ?? null,
        roleFamily: options.roleFamily ?? null,
        includeLowPriority: options.includeLowPriority !== false,
        includeIneligible: options.includeIneligible === true,
      }),
    );
    if (
      cursor &&
      (cursor.preferenceVersion !== preferences.version ||
        cursor.algorithmVersion !== RECOMMENDATION_ALGORITHM_VERSION ||
        cursor.filterFingerprint !== filterFingerprint)
    ) {
      throw new PersonalizationConflictError(
        "Recommendation settings changed; start a new ranking request",
      );
    }
    const watchRows = await transaction`
      select company_id, opportunity_id from public.watchlist_items
      where user_id = ${userId}::uuid and state = 'ACTIVE'
        and item_type in ('COMPANY', 'OPPORTUNITY')
    `;
    const watches = {
      watchedCompanyIds: new Set(
        watchRows.map((row) => nullableText(row.company_id)).filter(Boolean) as string[],
      ),
      watchedOpportunityIds: new Set(
        watchRows.map((row) => nullableText(row.opportunity_id)).filter(Boolean) as string[],
      ),
    };

    await transaction`
      update public.opportunity_suppressions suppression set
        released_at = ${asOf}, release_reason = 'MATERIAL_CHANGE'
      from lateral (
        select event.material_fingerprint from public.opportunity_change_events event
        where event.opportunity_id = suppression.opportunity_id
        order by event.change_version desc limit 1
      ) current_event
      where suppression.user_id = ${userId}::uuid and suppression.released_at is null
        and current_event.material_fingerprint <> suppression.basis_material_fingerprint
    `;

    const rows = await transaction.unsafe(
      `with candidates as (
         select opportunity.* from public.job_opportunities opportunity
         join public.companies candidate_company on candidate_company.id = opportunity.company_id
         where opportunity.status = 'ACTIVE'
           and ($1::text is null or opportunity.company_id::text = $1 or candidate_company.slug = $1)
           and ($2::text is null or opportunity.role_family::text = $2)
           and not exists (
             select 1 from public.opportunity_suppressions suppression
             where suppression.user_id = $3::uuid and suppression.opportunity_id = opportunity.id
               and suppression.released_at is null
           )
         order by opportunity.latest_last_seen_at desc, opportunity.id desc limit 500
       ), source_counts as (
         select membership.opportunity_id, count(*)::int as source_count
         from public.job_opportunity_postings membership join candidates on candidates.id = membership.opportunity_id
         where membership.valid_to is null group by membership.opportunity_id
       ), location_facts as (
         select membership.opportunity_id, jsonb_agg(distinct jsonb_build_object(
           'city', location.city, 'region', location.region, 'countryCode', location.country_code,
           'remoteRegion', location.remote_region
         )) as locations
         from public.job_opportunity_postings membership join candidates on candidates.id = membership.opportunity_id
         join public.job_locations location on location.job_id = membership.job_id
         where membership.valid_to is null group by membership.opportunity_id
       ), constraint_facts as (
         select membership.opportunity_id, jsonb_agg(distinct jsonb_build_object(
           'type', constraint_row.constraint_type::text
         )) as constraints
         from public.job_opportunity_postings membership join candidates on candidates.id = membership.opportunity_id
         join public.job_constraints constraint_row on constraint_row.job_id = membership.job_id
         where membership.valid_to is null and constraint_row.explicit
         group by membership.opportunity_id
       )
       select candidate.*, company.canonical_name as company_name, company.slug as company_slug,
         canonical.title as canonical_title, coalesce(source_counts.source_count, 0) as source_count,
         coalesce(location_facts.locations, '[]'::jsonb) as locations,
         coalesce(constraint_facts.constraints, '[]'::jsonb) as constraints,
         coalesce(latest_open.occurred_at, candidate.earliest_first_seen_at)
           as effective_opened_at,
         coalesce(latest_change.change_version, 1)::int as material_change_version,
         (candidate.deadline_at is not null and coalesce(capability.reviewed, false)) as deadline_reliable,
         coalesce(capability.authority::text, 'UNREVIEWED') as source_authority,
         coalesce(capability.reviewed, false) as source_authority_reviewed
       from candidates candidate join public.companies company on company.id = candidate.company_id
       join public.jobs canonical on canonical.id = candidate.canonical_source_posting_id
       left join public.source_job_capabilities capability on capability.source_id = canonical.source_id
       left join lateral (
         select event.occurred_at from public.opportunity_change_events event
         where event.opportunity_id = candidate.id and event.event_type in ('OPENED', 'REOPENED')
         order by event.change_version desc limit 1
       ) latest_open on true
       left join lateral (
         select event.change_version from public.opportunity_change_events event
         where event.opportunity_id = candidate.id order by event.change_version desc limit 1
       ) latest_change on true
       left join source_counts on source_counts.opportunity_id = candidate.id
       left join location_facts on location_facts.opportunity_id = candidate.id
       left join constraint_facts on constraint_facts.opportunity_id = candidate.id`,
      [options.company ?? null, options.roleFamily ?? null, userId],
    );
    let ranked: RankedCandidate[] = rows.map((row) => ({
      row,
      result: scoreOpportunityRecommendation({
        preferences,
        watches,
        opportunity: opportunityFacts(row),
        asOf,
      }),
    }));
    if (options.includeLowPriority === false) {
      ranked = ranked.filter((candidate) =>
        ["HIGH_PRIORITY", "MEDIUM_PRIORITY"].includes(candidate.result.category),
      );
    }
    if (options.includeIneligible !== true) {
      ranked = ranked.filter((candidate) => candidate.result.eligibility !== "NOT_ELIGIBLE");
    }
    ranked.sort(
      (left, right) =>
        eligibilityOrder(left.result.eligibility) - eligibilityOrder(right.result.eligibility) ||
        categoryOrder(left.result.category) - categoryOrder(right.result.category) ||
        (right.result.score ?? -1) - (left.result.score ?? -1) ||
        (left.row.deadline_reliable && left.row.deadline_at
          ? timestamp(left.row.deadline_at)
          : "9999"
        ).localeCompare(
          right.row.deadline_reliable && right.row.deadline_at
            ? timestamp(right.row.deadline_at)
            : "9999",
        ) ||
        timestamp(right.row.effective_opened_at).localeCompare(
          timestamp(left.row.effective_opened_at),
        ) ||
        text(left.row.id).localeCompare(text(right.row.id)),
    );
    const cursorIndex = cursor?.lastId
      ? ranked.findIndex((candidate) => text(candidate.row.id) === cursor.lastId)
      : -1;
    if (cursor?.lastId && cursorIndex < 0) {
      throw new PersonalizationConflictError(
        "Recommendation cursor no longer matches candidate set",
      );
    }
    const visible = ranked.slice(cursorIndex + 1, cursorIndex + 1 + limit);
    const candidateIds = ranked.map((candidate) => ({
      id: text(candidate.row.id),
      version: Number(candidate.row.material_change_version),
    }));
    const candidateSetVersion = sha256(JSON.stringify(candidateIds));
    const inputFingerprint = sha256(
      JSON.stringify({
        userId,
        preferenceVersion: preferences.version,
        asOf: asOf.toISOString(),
        candidateSetVersion,
      }),
    );
    const [decision] = await transaction`
      insert into public.ranking_decisions (
        user_id, surface, candidate_set_version, ranking_algorithm,
        ranking_algorithm_version, input_fingerprint, candidate_count,
        as_of, preference_version, filter_fingerprint
      ) values (
        ${userId}::uuid, 'OPPORTUNITIES', ${candidateSetVersion},
        ${RECOMMENDATION_ALGORITHM}, ${RECOMMENDATION_ALGORITHM_VERSION}, ${inputFingerprint},
        ${ranked.length}, ${asOf}, ${preferences.version}, ${filterFingerprint}
      ) returning id
    `;
    if (!decision) throw new Error("Ranking decision was not created");
    const resultItems: OpportunityRecommendationRecord[] = [];
    for (const candidate of visible) {
      const rank = ranked.indexOf(candidate) + 1;
      const [impression] = await transaction`
        insert into public.recommendation_impressions (
          user_id, ranking_decision_id, item_type, item_id, opportunity_id,
          rank_position, score, eligibility, category, evidence_coverage,
          available_weight, reason_codes, mismatch_codes, hard_constraint_codes,
          factor_values, shown_at
        ) values (
          ${userId}::uuid, ${text(decision.id)}::uuid, 'OPPORTUNITY', ${text(candidate.row.id)}::uuid,
          ${text(candidate.row.id)}::uuid, ${rank}, ${candidate.result.score},
          ${candidate.result.eligibility}, ${candidate.result.category}, ${candidate.result.coverage},
          ${candidate.result.availableWeight}, ${candidate.result.reasonCodes},
          ${candidate.result.mismatchCodes}, ${candidate.result.hardConstraintCodes},
          ${transaction.json(candidate.result.factors as never)}, ${asOf}
        ) returning id
      `;
      if (!impression) continue;
      await recordProductEventWith(transaction, {
        userId,
        eventType: "RECOMMENDATION_SHOWN",
        source: "SERVER",
        entityType: "OPPORTUNITY",
        entityId: text(candidate.row.id),
        deduplicationKey: `recommendation-shown:${text(impression.id)}`,
        context: { impressionId: text(impression.id), rankingDecisionId: text(decision.id) },
      });
      resultItems.push({
        impressionId: text(impression.id),
        opportunity: mapOpportunity(candidate.row),
        recommendationScore: candidate.result.score,
        category: candidate.result.category,
        eligibility: candidate.result.eligibility,
        evidenceCoverage: candidate.result.coverage,
        availableWeight: candidate.result.availableWeight,
        reasons: candidate.result.reasonCodes,
        potentialMismatches: candidate.result.mismatchCodes,
        hardConstraints: candidate.result.hardConstraintCodes,
        generatedAt: asOf.toISOString(),
        algorithmVersion: candidate.result.algorithmVersion,
      });
    }
    const last = visible.at(-1);
    return {
      items: resultItems,
      nextCursor:
        last && cursorIndex + 1 + visible.length < ranked.length
          ? encodeRecommendationCursor({
              asOf: asOf.toISOString(),
              lastId: text(last.row.id),
              preferenceVersion: preferences.version,
              algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
              filterFingerprint,
            })
          : null,
    };
  });
}

export async function dismissOpportunity(
  userId: string,
  opportunityId: string,
  reasonCode?: string,
): Promise<void> {
  await getDatabase().begin(async (transaction) => {
    const [basis] = await transaction`
      select opportunity.id, event.change_version, event.material_fingerprint
      from public.job_opportunities opportunity
      join lateral (
        select change_version, material_fingerprint from public.opportunity_change_events
        where opportunity_id = opportunity.id order by change_version desc limit 1
      ) event on true where opportunity.id = ${opportunityId}::uuid
    `;
    if (!basis) throw new PersonalizationNotFoundError("Opportunity was not found");
    const [suppression] = await transaction`
      insert into public.opportunity_suppressions (
        user_id, opportunity_id, basis_change_version, basis_material_fingerprint, reason_code
      ) values (
        ${userId}::uuid, ${opportunityId}::uuid, ${Number(basis.change_version)},
        ${text(basis.material_fingerprint)}, ${reasonCode ?? null}
      ) on conflict (user_id, opportunity_id) where released_at is null do update set
        basis_change_version = excluded.basis_change_version,
        basis_material_fingerprint = excluded.basis_material_fingerprint,
        reason_code = excluded.reason_code, dismissed_at = now()
      returning id
    `;
    await recordProductEventWith(transaction, {
      userId,
      eventType: "OPPORTUNITY_DISMISSED",
      source: "SERVER",
      entityType: "OPPORTUNITY",
      entityId: opportunityId,
      deduplicationKey: `opportunity-dismissed:${text(suppression?.id)}`,
      context: { suppressionRuleVersion: "material-change-suppression-v1" },
    });
  });
}

export async function restoreDismissedOpportunity(
  userId: string,
  opportunityId: string,
): Promise<void> {
  const [released] = await getDatabase()`
    update public.opportunity_suppressions set
      released_at = now(), release_reason = 'USER_RESTORED'
    where user_id = ${userId}::uuid and opportunity_id = ${opportunityId}::uuid
      and released_at is null returning id
  `;
  if (!released) {
    const [opportunity] = await getDatabase()`select id from public.job_opportunities
      where id = ${opportunityId}::uuid`;
    if (!opportunity) throw new PersonalizationNotFoundError("Opportunity was not found");
  }
}

export async function openRecommendation(userId: string, impressionId: string): Promise<void> {
  await getDatabase().begin(async (transaction) => {
    const [impression] = await transaction`
      select impression.id, impression.opportunity_id
      from public.recommendation_impressions impression
      where impression.id = ${impressionId}::uuid and impression.user_id = ${userId}::uuid
    `;
    if (!impression) throw new PersonalizationNotFoundError("Recommendation was not found");
    await recordProductEventWith(transaction, {
      userId,
      eventType: "RECOMMENDATION_OPENED",
      source: "SERVER",
      entityType: "OPPORTUNITY",
      entityId: text(impression.opportunity_id),
      deduplicationKey: `recommendation-opened:${impressionId}`,
      context: { impressionId },
    });
  });
}

export const ALERT_TYPES = [
  "WATCHED_COMPANY_OPPORTUNITY_OPENED",
  "RECOMMENDED_OPPORTUNITY_OPENED",
  "APPLICATION_DEADLINE_APPROACHING",
  "OPENING_WINDOW_STARTED",
  "WATCHED_RECRUITER_DISCOVERED",
  "WATCHED_RECRUITER_ACTIVITY",
  "CAMPUS_EVENT_DISCOVERED",
  "INTERVIEW_INTELLIGENCE_UPDATED",
  "CALENDAR_ACTION_DUE",
] as const;

export interface NotificationPreferencesRecord {
  channel: "IN_APP";
  inAppEnabled: boolean;
  alertTypes: Record<(typeof ALERT_TYPES)[number], boolean>;
  settingsVersion: number;
  updatedAt: string;
}

async function getNotificationPreferencesWith(
  sql: QuerySql,
  userId: string,
): Promise<NotificationPreferencesRecord> {
  const [master] = await sql`
    select coalesce(preference.in_app_enabled, true) as in_app_enabled,
      coalesce(preference.settings_version, 1)::int as settings_version,
      coalesce(preference.updated_at, user_row.created_at) as updated_at
    from public.users user_row left join public.user_notification_preferences preference
      on preference.user_id = user_row.id where user_row.id = ${userId}::uuid
  `;
  if (!master) throw new PersonalizationNotFoundError("User was not found");
  const overrides =
    await sql`select alert_type::text, enabled from public.user_alert_type_preferences
    where user_id = ${userId}::uuid`;
  const map = new Map(overrides.map((row) => [text(row.alert_type), Boolean(row.enabled)]));
  return {
    channel: "IN_APP",
    inAppEnabled: Boolean(master.in_app_enabled),
    alertTypes: Object.fromEntries(
      ALERT_TYPES.map((type) => [type, map.get(type) ?? type !== "RECOMMENDED_OPPORTUNITY_OPENED"]),
    ) as NotificationPreferencesRecord["alertTypes"],
    settingsVersion: Number(master.settings_version),
    updatedAt: timestamp(master.updated_at),
  };
}

export async function getNotificationPreferences(userId: string) {
  return getNotificationPreferencesWith(getDatabase(), userId);
}

export async function updateNotificationPreferences(
  userId: string,
  patch: {
    inAppEnabled?: boolean;
    alertTypes?: Partial<Record<(typeof ALERT_TYPES)[number], boolean>>;
  },
): Promise<NotificationPreferencesRecord> {
  return getDatabase().begin(async (transaction) => {
    await transaction`
      insert into public.user_notification_preferences (user_id, in_app_enabled)
      values (${userId}::uuid, ${patch.inAppEnabled ?? true})
      on conflict (user_id) do update set
        in_app_enabled = case when ${Object.hasOwn(patch, "inAppEnabled")}
          then excluded.in_app_enabled else public.user_notification_preferences.in_app_enabled end,
        settings_version = public.user_notification_preferences.settings_version + 1
    `;
    for (const [type, enabled] of Object.entries(patch.alertTypes ?? {})) {
      await transaction`
        insert into public.user_alert_type_preferences (user_id, alert_type, enabled)
        values (${userId}::uuid, ${type}, ${Boolean(enabled)})
        on conflict (user_id, alert_type) do update set enabled = excluded.enabled
      `;
    }
    return getNotificationPreferencesWith(transaction, userId);
  });
}

export interface AlertRecord {
  id: string;
  type: (typeof ALERT_TYPES)[number];
  title: string;
  body: string;
  reasonCodes: string[];
  state: "UNREAD" | "READ" | "DISMISSED" | "EXPIRED";
  entity: { type: string; id: string; href: string } | null;
  reminderWindow: string;
  occurredAt: string;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  expiresAt: string | null;
}

function mapAlert(row: Row): AlertRecord {
  const state = row.dismissed_at
    ? "DISMISSED"
    : row.superseded_by_alert_id ||
        (row.expires_at && Date.parse(timestamp(row.expires_at)) <= Date.now())
      ? "EXPIRED"
      : row.read_at
        ? "READ"
        : "UNREAD";
  const subject = [
    ["OPPORTUNITY", row.opportunity_id, "/opportunities/"],
    ["RECRUITER", row.recruiter_profile_id, "/recruiters/"],
    ["SCHOOL", row.school_id, "/schools/"],
    ["CALENDAR_ITEM", row.calendar_item_id, "/calendar?item="],
    ["COMPANY", row.company_id, "/companies/"],
  ].find(([, id]) => id);
  return {
    id: text(row.id),
    type: text(row.alert_type) as AlertRecord["type"],
    title: text(row.title),
    body: text(row.body),
    reasonCodes: stringArray(row.reason_codes),
    state,
    entity: subject
      ? {
          type: text(subject[0]),
          id: text(subject[1]),
          href: `${text(subject[2])}${text(subject[1])}`,
        }
      : null,
    reminderWindow: text(row.reminder_window),
    occurredAt: timestamp(row.occurred_at),
    createdAt: timestamp(row.created_at),
    readAt: nullableTimestamp(row.read_at),
    dismissedAt: nullableTimestamp(row.dismissed_at),
    expiresAt: nullableTimestamp(row.expires_at),
  };
}

export async function listAlerts(
  userId: string,
  options: { state?: string; type?: string; limit?: number; cursor?: string } = {},
): Promise<{ items: AlertRecord[]; nextCursor: string | null }> {
  const cursor = decodeCursor(options.cursor);
  if (cursor && (typeof cursor.at !== "string" || typeof cursor.id !== "string")) {
    throw new PersonalizationConflictError("Alert cursor is invalid");
  }
  const cursorAt = cursor && typeof cursor.at === "string" ? cursor.at : null;
  const cursorId = cursor && typeof cursor.id === "string" ? cursor.id : null;
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const rows = await getDatabase().unsafe(
    `select alert.* from public.alerts alert where alert.user_id = $1::uuid
       and ($2::text is null or case
         when alert.dismissed_at is not null then 'DISMISSED'
         when alert.superseded_by_alert_id is not null or alert.expires_at <= now() then 'EXPIRED'
         when alert.read_at is not null then 'READ' else 'UNREAD' end = $2)
       and ($3::text is null or alert.alert_type::text = $3)
       and ($4::timestamptz is null or (alert.created_at, alert.id) < ($4::timestamptz, $5::uuid))
     order by alert.created_at desc, alert.id desc limit $6`,
    [userId, options.state ?? null, options.type ?? null, cursorAt, cursorId, limit + 1],
  );
  const items = rows.slice(0, limit).map(mapAlert);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}

export async function getAlert(userId: string, alertId: string): Promise<AlertRecord> {
  const [row] = await getDatabase()`select * from public.alerts
    where id = ${alertId}::uuid and user_id = ${userId}::uuid`;
  if (!row) throw new PersonalizationNotFoundError("Alert was not found");
  return mapAlert(row);
}

export async function updateAlert(
  userId: string,
  alertId: string,
  read: boolean,
): Promise<AlertRecord> {
  const [row] = await getDatabase()`
    update public.alerts set read_at = case when ${read} then coalesce(read_at, now()) else null end
    where id = ${alertId}::uuid and user_id = ${userId}::uuid returning *
  `;
  if (!row) throw new PersonalizationNotFoundError("Alert was not found");
  return mapAlert(row);
}

export async function openAlert(userId: string, alertId: string): Promise<AlertRecord> {
  return getDatabase().begin(async (transaction) => {
    const [row] = await transaction`
      update public.alerts set opened_at = coalesce(opened_at, now()),
        read_at = coalesce(read_at, now())
      where id = ${alertId}::uuid and user_id = ${userId}::uuid returning *
    `;
    if (!row) throw new PersonalizationNotFoundError("Alert was not found");
    await recordProductEventWith(transaction, {
      userId,
      eventType: "ALERT_OPENED",
      source: "SERVER",
      entityType: "ALERT",
      entityId: alertId,
      deduplicationKey: `alert-opened:${alertId}`,
      context: { alertType: text(row.alert_type) },
    });
    return mapAlert(row);
  });
}

export async function markAlertsShown(userId: string, alertIds: string[]): Promise<number> {
  return getDatabase().begin(async (transaction) => {
    const rows = await transaction`
      update public.alerts set shown_at = coalesce(shown_at, now())
      where user_id = ${userId}::uuid and id = any(${[...new Set(alertIds)]}::uuid[])
      returning id, alert_type::text
    `;
    for (const row of rows) {
      await recordProductEventWith(transaction, {
        userId,
        eventType: "ALERT_SHOWN",
        source: "SERVER",
        entityType: "ALERT",
        entityId: text(row.id),
        deduplicationKey: `alert-shown:${text(row.id)}`,
        context: { alertType: text(row.alert_type) },
      });
    }
    return rows.length;
  });
}

export async function dismissAlert(userId: string, alertId: string): Promise<AlertRecord> {
  const [row] = await getDatabase()`
    update public.alerts set read_at = coalesce(read_at, now()), dismissed_at = coalesce(dismissed_at, now())
    where id = ${alertId}::uuid and user_id = ${userId}::uuid returning *
  `;
  if (!row) throw new PersonalizationNotFoundError("Alert was not found");
  return mapAlert(row);
}

export async function markAllAlertsRead(userId: string): Promise<number> {
  const rows = await getDatabase()`
    update public.alerts set read_at = now() where user_id = ${userId}::uuid
      and read_at is null and dismissed_at is null and superseded_by_alert_id is null
      and (expires_at is null or expires_at > now()) returning id
  `;
  return rows.length;
}
