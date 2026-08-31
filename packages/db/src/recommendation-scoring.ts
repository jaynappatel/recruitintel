export const RECOMMENDATION_ALGORITHM = "deterministic-opportunity-priority";
export const RECOMMENDATION_ALGORITHM_VERSION = "v1";

export const RECOMMENDATION_WEIGHTS = Object.freeze({
  COMPANY_PREFERENCE: 18,
  ROLE_MATCH: 20,
  EARLY_CAREER_TRACK: 14,
  EXPERIENCE_LEVEL: 12,
  LOCATION_MATCH: 14,
  WORKPLACE_MODE: 8,
  FRESHNESS: 6,
  DEADLINE_URGENCY: 4,
  SOURCE_CONFIDENCE: 4,
} as const);

export type RecommendationFactorCode = keyof typeof RECOMMENDATION_WEIGHTS;
export type RecommendationFactorState =
  | "MATCH"
  | "PARTIAL"
  | "MISMATCH"
  | "UNKNOWN"
  | "NOT_APPLICABLE";
export type EligibilityStatus = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
export type RecommendationCategory =
  | "HIGH_PRIORITY"
  | "MEDIUM_PRIORITY"
  | "LOW_PRIORITY"
  | "NOT_ELIGIBLE";
export type EvidenceCoverage = "HIGH" | "MEDIUM" | "LOW";

export interface PreferredLocation {
  kind: "CITY_REGION_COUNTRY" | "REGION_COUNTRY" | "COUNTRY" | "REMOTE_REGION";
  city?: string | null;
  region?: string | null;
  countryCode?: string | null;
  remoteRegion?: string | null;
}

export interface OpportunityLocationFact {
  city: string | null;
  region: string | null;
  countryCode: string | null;
  remoteRegion: string | null;
}

export interface RecruitingPreferenceSnapshot {
  graduationYear: number | null;
  usWorkAuthorized: boolean | null;
  requiresEmployerSponsorship: boolean | null;
  roleFamilies: string[];
  earlyCareerTracks: Array<"INTERNSHIP" | "NEW_GRAD">;
  experienceLevels: string[];
  workplaceModes: Array<"REMOTE" | "HYBRID" | "ONSITE">;
  locations: PreferredLocation[];
}

export interface RecommendationOpportunityFacts {
  opportunityId: string;
  companyId: string;
  status: "ACTIVE" | "SUPERSEDED";
  lifecycleStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  roleFamily: string;
  experienceLevel: string;
  isInternship: boolean;
  isNewGrad: boolean;
  graduationYears: number[];
  workplaceMode: "REMOTE" | "HYBRID" | "ONSITE" | "MIXED" | "UNKNOWN";
  locations: OpportunityLocationFact[];
  effectiveOpenedAt: string;
  deadlineAt: string | null;
  deadlineReliable: boolean;
  sourceAuthority:
    | "OFFICIAL_ATS"
    | "OFFICIAL_COMPANY"
    | "REVIEWED_DIRECT"
    | "COMMUNITY"
    | "UNREVIEWED";
  sourceAuthorityReviewed: boolean;
  sponsorshipAvailable: boolean | null;
  sponsorshipUnavailable: boolean | null;
  workAuthorizationRequired: boolean | null;
}

export interface RecommendationWatchSnapshot {
  watchedCompanyIds: ReadonlySet<string>;
  watchedOpportunityIds: ReadonlySet<string>;
}

export interface RecommendationFactorResult {
  code: RecommendationFactorCode;
  state: RecommendationFactorState;
  earnedWeight: number;
  availableWeight: number;
  reasonCode: string;
}

export interface RecommendationResult {
  algorithm: typeof RECOMMENDATION_ALGORITHM;
  algorithmVersion: typeof RECOMMENDATION_ALGORITHM_VERSION;
  eligibility: EligibilityStatus;
  category: RecommendationCategory;
  score: number | null;
  coverage: EvidenceCoverage;
  availableWeight: number;
  factors: RecommendationFactorResult[];
  reasonCodes: string[];
  mismatchCodes: string[];
  hardConstraintCodes: string[];
}

const DAY_MS = 86_400_000;

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return result || null;
}

function factor(
  code: RecommendationFactorCode,
  state: RecommendationFactorState,
  earnedWeight: number,
  reasonCode: string,
): RecommendationFactorResult {
  return {
    code,
    state,
    earnedWeight,
    availableWeight:
      state === "UNKNOWN" || state === "NOT_APPLICABLE" ? 0 : RECOMMENDATION_WEIGHTS[code],
    reasonCode,
  };
}

function hardEligibility(
  preferences: RecruitingPreferenceSnapshot,
  opportunity: RecommendationOpportunityFacts,
  asOf: Date,
): { status: EligibilityStatus; reasons: string[] } {
  const failures: string[] = [];
  const unknowns: string[] = [];

  if (opportunity.status === "SUPERSEDED") failures.push("OPPORTUNITY_SUPERSEDED");
  if (opportunity.lifecycleStatus === "CLOSED") failures.push("OPPORTUNITY_CLOSED");
  if (opportunity.lifecycleStatus === "UNKNOWN") unknowns.push("OPPORTUNITY_LIFECYCLE_UNKNOWN");

  if (
    opportunity.deadlineAt &&
    opportunity.deadlineReliable &&
    Date.parse(opportunity.deadlineAt) < asOf.getTime()
  ) {
    failures.push("DEADLINE_PASSED_CONFIRMED");
  }

  if (preferences.experienceLevels.length > 0) {
    if (opportunity.experienceLevel === "UNKNOWN") {
      unknowns.push("EXPERIENCE_LEVEL_UNKNOWN");
    } else if (!preferences.experienceLevels.includes(opportunity.experienceLevel)) {
      failures.push("EXPLICIT_SENIORITY_MISMATCH");
    }
  }

  if (preferences.graduationYear !== null) {
    if (opportunity.graduationYears.length === 0) {
      unknowns.push("GRADUATION_REQUIREMENT_UNKNOWN");
    } else if (!opportunity.graduationYears.includes(preferences.graduationYear)) {
      failures.push("GRADUATION_YEAR_INELIGIBLE");
    }
  }

  if (preferences.requiresEmployerSponsorship === true) {
    if (opportunity.sponsorshipUnavailable === true) {
      failures.push("SPONSORSHIP_UNAVAILABLE");
    } else if (opportunity.sponsorshipAvailable !== true) {
      unknowns.push("SPONSORSHIP_ELIGIBILITY_UNKNOWN");
    }
  }

  if (preferences.usWorkAuthorized === false) {
    if (opportunity.workAuthorizationRequired === true) {
      failures.push("WORK_AUTHORIZATION_REQUIRED");
    } else if (opportunity.workAuthorizationRequired === null) {
      unknowns.push("WORK_AUTHORIZATION_UNKNOWN");
    }
  }

  if (failures.length > 0) return { status: "NOT_ELIGIBLE", reasons: failures };
  if (unknowns.length > 0) return { status: "UNKNOWN", reasons: unknowns };
  return { status: "ELIGIBLE", reasons: ["NO_KNOWN_HARD_BLOCKER"] };
}

function companyPreferenceFactor(
  watches: RecommendationWatchSnapshot,
  opportunity: RecommendationOpportunityFacts,
): RecommendationFactorResult {
  if (watches.watchedOpportunityIds.has(opportunity.opportunityId)) {
    return factor("COMPANY_PREFERENCE", "MATCH", 18, "WATCHED_OPPORTUNITY");
  }
  if (watches.watchedCompanyIds.has(opportunity.companyId)) {
    return factor("COMPANY_PREFERENCE", "MATCH", 18, "WATCHED_COMPANY");
  }
  if (watches.watchedCompanyIds.size + watches.watchedOpportunityIds.size === 0) {
    return factor("COMPANY_PREFERENCE", "NOT_APPLICABLE", 0, "NO_WATCH_PREFERENCE");
  }
  return factor("COMPANY_PREFERENCE", "MISMATCH", 0, "COMPANY_NOT_WATCHED");
}

function roleFactor(
  preferences: RecruitingPreferenceSnapshot,
  opportunity: RecommendationOpportunityFacts,
): RecommendationFactorResult {
  if (preferences.roleFamilies.length === 0) {
    return factor("ROLE_MATCH", "NOT_APPLICABLE", 0, "NO_ROLE_PREFERENCE");
  }
  if (opportunity.roleFamily === "OTHER") {
    return factor("ROLE_MATCH", "UNKNOWN", 0, "ROLE_FAMILY_UNKNOWN");
  }
  return preferences.roleFamilies.includes(opportunity.roleFamily)
    ? factor("ROLE_MATCH", "MATCH", 20, "ROLE_FAMILY_MATCH")
    : factor("ROLE_MATCH", "MISMATCH", 0, "ROLE_FAMILY_MISMATCH");
}

function trackFactor(
  preferences: RecruitingPreferenceSnapshot,
  opportunity: RecommendationOpportunityFacts,
): RecommendationFactorResult {
  if (preferences.earlyCareerTracks.length === 0) {
    return factor("EARLY_CAREER_TRACK", "NOT_APPLICABLE", 0, "NO_EARLY_CAREER_PREFERENCE");
  }
  const opportunityTracks = [
    ...(opportunity.isInternship ? (["INTERNSHIP"] as const) : []),
    ...(opportunity.isNewGrad ? (["NEW_GRAD"] as const) : []),
  ];
  if (opportunityTracks.length === 0) {
    return opportunity.experienceLevel === "UNKNOWN"
      ? factor("EARLY_CAREER_TRACK", "UNKNOWN", 0, "EARLY_CAREER_TRACK_UNKNOWN")
      : factor("EARLY_CAREER_TRACK", "MISMATCH", 0, "EARLY_CAREER_TRACK_MISMATCH");
  }
  const matched = opportunityTracks.some((value) => preferences.earlyCareerTracks.includes(value));
  if (!matched) {
    return factor("EARLY_CAREER_TRACK", "MISMATCH", 0, "EARLY_CAREER_TRACK_MISMATCH");
  }
  if (opportunityTracks.length > 1 && preferences.earlyCareerTracks.length === 1) {
    return factor("EARLY_CAREER_TRACK", "PARTIAL", 12, "EARLY_CAREER_TRACK_PARTIAL");
  }
  return factor("EARLY_CAREER_TRACK", "MATCH", 14, "EARLY_CAREER_TRACK_MATCH");
}

function experienceFactor(
  preferences: RecruitingPreferenceSnapshot,
  opportunity: RecommendationOpportunityFacts,
): RecommendationFactorResult {
  if (preferences.experienceLevels.length === 0) {
    return factor("EXPERIENCE_LEVEL", "NOT_APPLICABLE", 0, "NO_EXPERIENCE_PREFERENCE");
  }
  if (opportunity.experienceLevel === "UNKNOWN") {
    return factor("EXPERIENCE_LEVEL", "UNKNOWN", 0, "EXPERIENCE_LEVEL_UNKNOWN");
  }
  return preferences.experienceLevels.includes(opportunity.experienceLevel)
    ? factor("EXPERIENCE_LEVEL", "MATCH", 12, "EXPERIENCE_LEVEL_MATCH")
    : factor("EXPERIENCE_LEVEL", "MISMATCH", 0, "EXPLICIT_SENIORITY_MISMATCH");
}

function locationPoints(preference: PreferredLocation, location: OpportunityLocationFact): number {
  const city = normalized(location.city);
  const region = normalized(location.region);
  const country = normalized(location.countryCode);
  const remoteRegion = normalized(location.remoteRegion);
  const preferredCity = normalized(preference.city);
  const preferredRegion = normalized(preference.region);
  const preferredCountry = normalized(preference.countryCode);
  const preferredRemote = normalized(preference.remoteRegion);

  if (
    preference.kind === "CITY_REGION_COUNTRY" &&
    city &&
    region &&
    country &&
    city === preferredCity &&
    region === preferredRegion &&
    country === preferredCountry
  ) {
    return 14;
  }
  if (
    preference.kind === "REGION_COUNTRY" &&
    region &&
    country &&
    region === preferredRegion &&
    country === preferredCountry
  ) {
    return 12;
  }
  if (preference.kind === "COUNTRY" && country && country === preferredCountry) return 7;
  if (preference.kind === "REMOTE_REGION" && remoteRegion && remoteRegion === preferredRemote) {
    return 12;
  }
  return 0;
}

function locationFactor(
  preferences: RecruitingPreferenceSnapshot,
  opportunity: RecommendationOpportunityFacts,
): RecommendationFactorResult {
  if (preferences.locations.length === 0) {
    return factor("LOCATION_MATCH", "NOT_APPLICABLE", 0, "NO_LOCATION_PREFERENCE");
  }
  const known = opportunity.locations.filter(
    (location) => location.city || location.region || location.countryCode || location.remoteRegion,
  );
  if (known.length === 0) {
    return factor("LOCATION_MATCH", "UNKNOWN", 0, "LOCATION_UNKNOWN");
  }
  const points = Math.max(
    0,
    ...preferences.locations.flatMap((preference) =>
      known.map((location) => locationPoints(preference, location)),
    ),
  );
  if (points === 14) return factor("LOCATION_MATCH", "MATCH", points, "LOCATION_EXACT_MATCH");
  if (points > 0) return factor("LOCATION_MATCH", "PARTIAL", points, "LOCATION_PARTIAL_MATCH");
  return factor("LOCATION_MATCH", "MISMATCH", 0, "LOCATION_MISMATCH");
}

function workplaceFactor(
  preferences: RecruitingPreferenceSnapshot,
  opportunity: RecommendationOpportunityFacts,
): RecommendationFactorResult {
  if (preferences.workplaceModes.length === 0) {
    return factor("WORKPLACE_MODE", "NOT_APPLICABLE", 0, "NO_WORKPLACE_PREFERENCE");
  }
  if (opportunity.workplaceMode === "UNKNOWN") {
    return factor("WORKPLACE_MODE", "UNKNOWN", 0, "WORKPLACE_MODE_UNKNOWN");
  }
  if (opportunity.workplaceMode === "MIXED") {
    return factor("WORKPLACE_MODE", "PARTIAL", 6, "WORKPLACE_MODE_MIXED");
  }
  return preferences.workplaceModes.includes(opportunity.workplaceMode)
    ? factor("WORKPLACE_MODE", "MATCH", 8, "WORKPLACE_MODE_MATCH")
    : factor("WORKPLACE_MODE", "MISMATCH", 0, "WORKPLACE_MODE_MISMATCH");
}

function freshnessFactor(
  opportunity: RecommendationOpportunityFacts,
  asOf: Date,
): RecommendationFactorResult {
  const ageDays = Math.max(
    0,
    (asOf.getTime() - Date.parse(opportunity.effectiveOpenedAt)) / DAY_MS,
  );
  if (ageDays <= 1) return factor("FRESHNESS", "MATCH", 6, "NEWLY_OPENED");
  if (ageDays <= 3) return factor("FRESHNESS", "PARTIAL", 5, "OPENED_WITHIN_3_DAYS");
  if (ageDays <= 7) return factor("FRESHNESS", "PARTIAL", 4, "OPENED_WITHIN_7_DAYS");
  if (ageDays <= 14) return factor("FRESHNESS", "PARTIAL", 2, "OPENED_WITHIN_14_DAYS");
  return factor("FRESHNESS", "MISMATCH", 0, "OPPORTUNITY_NOT_FRESH");
}

function deadlineFactor(
  opportunity: RecommendationOpportunityFacts,
  asOf: Date,
): RecommendationFactorResult {
  if (!opportunity.deadlineAt || !opportunity.deadlineReliable) {
    return factor("DEADLINE_URGENCY", "UNKNOWN", 0, "DEADLINE_UNKNOWN");
  }
  const remainingDays = (Date.parse(opportunity.deadlineAt) - asOf.getTime()) / DAY_MS;
  if (remainingDays <= 1) return factor("DEADLINE_URGENCY", "MATCH", 4, "DEADLINE_WITHIN_1_DAY");
  if (remainingDays <= 3) return factor("DEADLINE_URGENCY", "PARTIAL", 3, "DEADLINE_WITHIN_3_DAYS");
  if (remainingDays <= 7) return factor("DEADLINE_URGENCY", "PARTIAL", 2, "DEADLINE_WITHIN_7_DAYS");
  if (remainingDays <= 14)
    return factor("DEADLINE_URGENCY", "PARTIAL", 1, "DEADLINE_WITHIN_14_DAYS");
  return factor("DEADLINE_URGENCY", "MISMATCH", 0, "DEADLINE_NOT_URGENT");
}

function sourceFactor(opportunity: RecommendationOpportunityFacts): RecommendationFactorResult {
  const points = opportunity.sourceAuthorityReviewed
    ? (
        {
          OFFICIAL_ATS: 4,
          OFFICIAL_COMPANY: 3,
          REVIEWED_DIRECT: 2,
          COMMUNITY: 1,
          UNREVIEWED: 0,
        } as const
      )[opportunity.sourceAuthority]
    : 0;
  if (points === 4) return factor("SOURCE_CONFIDENCE", "MATCH", 4, "SOURCE_OFFICIAL_ATS");
  if (points > 0) return factor("SOURCE_CONFIDENCE", "PARTIAL", points, "SOURCE_REVIEWED");
  return factor("SOURCE_CONFIDENCE", "MISMATCH", 0, "SOURCE_UNREVIEWED");
}

export function scoreOpportunityRecommendation(input: {
  preferences: RecruitingPreferenceSnapshot;
  watches: RecommendationWatchSnapshot;
  opportunity: RecommendationOpportunityFacts;
  asOf: Date;
}): RecommendationResult {
  const hard = hardEligibility(input.preferences, input.opportunity, input.asOf);
  const factors = [
    companyPreferenceFactor(input.watches, input.opportunity),
    roleFactor(input.preferences, input.opportunity),
    trackFactor(input.preferences, input.opportunity),
    experienceFactor(input.preferences, input.opportunity),
    locationFactor(input.preferences, input.opportunity),
    workplaceFactor(input.preferences, input.opportunity),
    freshnessFactor(input.opportunity, input.asOf),
    deadlineFactor(input.opportunity, input.asOf),
    sourceFactor(input.opportunity),
  ];
  const availableWeight = factors.reduce((sum, item) => sum + item.availableWeight, 0);
  const earnedWeight = factors.reduce((sum, item) => sum + item.earnedWeight, 0);
  const score =
    hard.status === "NOT_ELIGIBLE" || availableWeight === 0
      ? null
      : Math.round((earnedWeight / availableWeight) * 100);
  const coverage: EvidenceCoverage =
    availableWeight >= 70 ? "HIGH" : availableWeight >= 40 ? "MEDIUM" : "LOW";
  const knownPersonalFactors = factors
    .slice(0, 6)
    .filter((item) => item.state !== "UNKNOWN" && item.state !== "NOT_APPLICABLE").length;

  let category: RecommendationCategory;
  if (hard.status === "NOT_ELIGIBLE") category = "NOT_ELIGIBLE";
  else if (hard.status === "UNKNOWN") category = "LOW_PRIORITY";
  else if (score !== null && score >= 70 && availableWeight >= 50 && knownPersonalFactors >= 2) {
    category = "HIGH_PRIORITY";
  } else if (score !== null && score >= 40 && availableWeight >= 35) {
    category = "MEDIUM_PRIORITY";
  } else category = "LOW_PRIORITY";

  const reasonCodes = [
    ...hard.reasons.filter((reason) => reason === "NO_KNOWN_HARD_BLOCKER"),
    ...(input.preferences.graduationYear !== null &&
    input.opportunity.graduationYears.includes(input.preferences.graduationYear)
      ? ["GRADUATION_YEAR_ELIGIBLE"]
      : []),
    ...(input.preferences.requiresEmployerSponsorship === true &&
    input.opportunity.sponsorshipAvailable === true
      ? ["SPONSORSHIP_AVAILABLE"]
      : []),
    ...factors
      .filter((item) => ["MATCH", "PARTIAL"].includes(item.state))
      .map((item) => item.reasonCode),
  ];
  const mismatchCodes = factors
    .filter((item) => item.state === "MISMATCH" || item.state === "UNKNOWN")
    .map((item) => item.reasonCode);

  return {
    algorithm: RECOMMENDATION_ALGORITHM,
    algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
    eligibility: hard.status,
    category,
    score,
    coverage,
    availableWeight,
    factors,
    reasonCodes: reasonCodes.slice(0, 16),
    mismatchCodes: mismatchCodes.slice(0, 16),
    hardConstraintCodes: hard.reasons
      .filter((reason) => reason !== "NO_KNOWN_HARD_BLOCKER")
      .slice(0, 8),
  };
}
