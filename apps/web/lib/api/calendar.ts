"use client";

import { z } from "zod";

import {
  applicationPlanSchema,
  calendarItemSchema,
  calendarSyncRequestSchema,
  companySchema,
  googleCalendarAuthorizeSchema,
  googleCalendarOptionSchema,
  googleCalendarStatusSchema,
  type ApplicationPlan,
  type CalendarItem as CanonicalCalendarItem,
  type CalendarSyncRequest,
  type CreateApplicationPlanRequest,
  type CreateCalendarItemRequest,
  type GoogleCalendarOption,
  type GoogleCalendarStatus,
  type UpdateApplicationPlanRequest,
  type UpdateCalendarItemRequest,
  type UpdateGoogleCalendarRequest,
} from "@recruitintel/types";

import {
  calendarDisplayTypes,
  type CalendarCategory,
  type CalendarItemType,
  type CalendarItemView,
  type Company,
  type CreateApplicationPlanInput,
  type CreateCalendarItemInput,
  type UpdateCalendarItemInput,
} from "../types/calendar";

const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const calendarItemEnvelopeSchema = z.object({ data: calendarItemSchema });
const calendarItemListEnvelopeSchema = z.object({
  data: z.array(calendarItemSchema),
  meta: z.object({ total: z.number().int().nonnegative() }),
});
const applicationPlanEnvelopeSchema = z.object({ data: applicationPlanSchema });
const applicationPlanListEnvelopeSchema = z.object({
  data: z.array(applicationPlanSchema),
  meta: z.object({ total: z.number().int().nonnegative() }),
});
const googleCalendarStatusEnvelopeSchema = z.object({ data: googleCalendarStatusSchema });
const googleCalendarAuthorizeEnvelopeSchema = z.object({ data: googleCalendarAuthorizeSchema });
const googleCalendarListEnvelopeSchema = z.object({
  data: z.array(googleCalendarOptionSchema),
  meta: z.object({ total: z.number().int().nonnegative() }),
});
const calendarSyncRequestEnvelopeSchema = z.object({ data: calendarSyncRequestSchema });
const companyEnvelopeSchema = z.object({ data: companySchema });
const companyListEnvelopeSchema = z.object({
  data: z.array(companySchema),
  meta: z.object({ total: z.number().int().nonnegative() }).passthrough(),
});

type Parser<T> = { parse(value: unknown): T };

export class CalendarApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CalendarApiError";
  }
}

function publicErrorMessage(code: string, status: number): string {
  if (code === "NOT_FOUND") return "The requested calendar record was not found.";
  if (code === "CONFLICT") return "That calendar action conflicts with its current state.";
  if (code === "REAUTH_REQUIRED" || code.includes("TOKEN")) {
    return "Google Calendar needs to be reconnected.";
  }
  if (code === "GOOGLE_OAUTH_NOT_CONFIGURED") {
    return "Google Calendar is not configured for this environment.";
  }
  if (status === 400) return "The calendar request was not valid.";
  if (status === 401 || status === 403) return "This calendar action is not authorized.";
  if (status === 409) return "That calendar action cannot be completed right now.";
  return "The calendar service is unavailable. Please try again.";
}

async function requestData<T>(
  path: string,
  schema: Parser<{ data: T }>,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new CalendarApiError(
      "API_UNAVAILABLE",
      "The calendar service is unavailable. Please try again.",
    );
  }

  if (!response.ok) {
    let code = "API_UNAVAILABLE";
    try {
      const parsed = errorEnvelopeSchema.safeParse(await response.json());
      if (parsed.success) code = parsed.data.error.code;
    } catch {
      // Provider and server response bodies are intentionally not exposed to the UI.
    }
    throw new CalendarApiError(code, publicErrorMessage(code, response.status));
  }

  try {
    return schema.parse(await response.json()).data;
  } catch {
    throw new CalendarApiError(
      "INVALID_RESPONSE",
      "The calendar service returned an unexpected response. Please try again.",
    );
  }
}

async function requestEmpty(path: string, init: RequestInit): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch {
    throw new CalendarApiError(
      "API_UNAVAILABLE",
      "The calendar service is unavailable. Please try again.",
    );
  }
  if (response.ok) return;
  let code = "API_UNAVAILABLE";
  try {
    const parsed = errorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) code = parsed.data.error.code;
  } catch {
    // Keep server/provider details out of browser-visible errors.
  }
  throw new CalendarApiError(code, publicErrorMessage(code, response.status));
}

function queryString(values: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) query.set(key, value);
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function partsInTimezone(iso: string, timezone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(new Date(iso))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function zonedDate(iso: string, timezone: string): string {
  const parts = partsInTimezone(iso, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedTime(iso: string, timezone: string): string {
  const parts = partsInTimezone(iso, timezone);
  return `${parts.hour}:${parts.minute}`;
}

/** Convert a wall-clock time in an IANA timezone to an RFC 3339 instant. */
export function zonedDateTimeToIso(date: string, time: string, timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new CalendarApiError("INVALID_TIMEZONE", "Enter a valid IANA timezone.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    throw new CalendarApiError("INVALID_LOCAL_TIME", "Enter a valid local date and time.");
  }
  const target = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = partsInTimezone(new Date(guess).toISOString(), timezone);
    const rendered = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      0,
    );
    const correction = target - rendered;
    guess += correction;
    if (correction === 0) break;
  }
  const result = new Date(guess).toISOString();
  const roundTrip = partsInTimezone(result, timezone);
  if (
    `${roundTrip.year}-${roundTrip.month}-${roundTrip.day}` !== date ||
    `${roundTrip.hour}:${roundTrip.minute}` !== time
  ) {
    throw new CalendarApiError(
      "INVALID_LOCAL_TIME",
      "That local time does not exist in the selected timezone.",
    );
  }
  return result;
}

const displayTypeSet = new Set<string>(calendarDisplayTypes);

function presentationType(item: CanonicalCalendarItem): CalendarItemType {
  const metadataType = item.metadata.presentationType;
  if (typeof metadataType === "string" && displayTypeSet.has(metadataType)) {
    return metadataType as CalendarItemType;
  }
  const recruitingType = item.recruitingDate?.type;
  return (recruitingType ?? item.type) as CalendarItemType;
}

function presentationCategory(item: CanonicalCalendarItem): CalendarCategory {
  if (item.source === "RECRUITING_INTELLIGENCE" || item.type === "RECRUITING_DATE") {
    return "RECRUITING_DATE";
  }
  if (
    ["LEETCODE", "INTERVIEW_PREP", "SYSTEM_DESIGN", "BEHAVIORAL_PREP", "RESUME_WORK"].includes(
      item.type,
    )
  ) {
    return "PREP_SESSION";
  }
  return "ACTION";
}

function presentationStatus(item: CanonicalCalendarItem): CalendarItemView["status"] {
  const certainty = item.recruitingDate?.dateCertainty;
  return certainty && certainty !== "USER_CREATED" ? certainty : "USER_SCHEDULED";
}

export function toCalendarItemView(item: CanonicalCalendarItem): CalendarItemView {
  const date =
    item.allDay && item.startsOn ? item.startsOn : zonedDate(item.startsAt, item.timezone);
  const timedEndDate = item.endsAt ? zonedDate(item.endsAt, item.timezone) : undefined;
  const endDate = item.allDay
    ? (item.endsOn ?? undefined)
    : timedEndDate && timedEndDate !== date
      ? timedEndDate
      : undefined;
  const sourceName = item.recruitingDate?.source.name ?? item.recruitingDate?.source.kind;
  return {
    id: item.id,
    title: item.title,
    date,
    endDate,
    time: item.allDay ? undefined : zonedTime(item.startsAt, item.timezone),
    endTime: item.allDay || !item.endsAt ? undefined : zonedTime(item.endsAt, item.timezone),
    allDay: item.allDay,
    timezone: item.timezone,
    category: presentationCategory(item),
    type: presentationType(item),
    status: presentationStatus(item),
    domainType: item.type,
    itemStatus: item.status,
    itemSource: item.source,
    companyId: item.company?.id ?? undefined,
    companySlug: item.company?.slug ?? undefined,
    companyName: item.company?.name ?? undefined,
    jobId: item.jobId ?? undefined,
    opportunityId: item.opportunityId ?? undefined,
    resolvedOpportunityId: item.resolvedOpportunity?.id,
    resolutionMismatch: item.resolutionMismatch,
    recruitingDateId: item.recruitingDateId ?? undefined,
    source: sourceName
      ? { name: sourceName, url: item.recruitingDate?.source.url ?? undefined }
      : undefined,
    notes: item.description ?? undefined,
    completed: item.status === "DONE",
    syncEnabled: item.syncEnabled,
    planId: item.applicationPlanId ?? undefined,
  };
}

export interface CalendarItemFilters {
  categories?: CalendarCategory[];
  statuses?: CalendarItemView["status"][];
  type?: CanonicalCalendarItem["type"];
  itemStatus?: CanonicalCalendarItem["status"];
  company?: string;
  from?: string;
  to?: string;
}

export async function getCalendarItems(
  filters: CalendarItemFilters = {},
): Promise<CalendarItemView[]> {
  const response = await requestData(
    `/api/calendar${queryString({
      start: filters.from,
      end: filters.to,
      type: filters.type,
      company: filters.company,
      status: filters.itemStatus,
    })}`,
    calendarItemListEnvelopeSchema,
  );
  let items = response.map(toCalendarItemView);
  if (filters.categories?.length) {
    items = items.filter((item) => filters.categories!.includes(item.category));
  }
  if (filters.statuses?.length) {
    items = items.filter((item) => filters.statuses!.includes(item.status));
  }
  return items.sort((left, right) =>
    `${left.date}T${left.time ?? "00:00"}`.localeCompare(`${right.date}T${right.time ?? "00:00"}`),
  );
}

function toCreateRequest(input: CreateCalendarItemInput): CreateCalendarItemRequest {
  const base = {
    companyId: input.companyId,
    jobId: input.jobId,
    opportunityId: input.opportunityId,
    type: input.type,
    title: input.title,
    description: input.notes,
    timezone: input.timezone,
    status: "TODO" as const,
    syncEnabled: input.syncEnabled ?? false,
    metadata: {},
  };
  if (input.allDay) {
    return {
      ...base,
      allDay: true,
      startsOn: input.date,
      endsOn: input.endDate,
    };
  }
  const startTime = input.time ?? "09:00";
  return {
    ...base,
    allDay: false,
    startsAt: zonedDateTimeToIso(input.date, startTime, input.timezone),
    endsAt: input.endTime
      ? zonedDateTimeToIso(input.endDate ?? input.date, input.endTime, input.timezone)
      : undefined,
  };
}

export async function createCalendarItem(
  input: CreateCalendarItemInput,
): Promise<CalendarItemView> {
  const item = await requestData("/api/calendar", calendarItemEnvelopeSchema, {
    method: "POST",
    body: JSON.stringify(toCreateRequest(input)),
  });
  return toCalendarItemView(item);
}

function toUpdateRequest(input: UpdateCalendarItemInput): UpdateCalendarItemRequest {
  const request: UpdateCalendarItemRequest = {};
  if (input.title !== undefined) request.title = input.title;
  if (input.notes !== undefined) request.description = input.notes;
  if (input.status !== undefined) request.status = input.status;
  if (input.syncEnabled !== undefined) request.syncEnabled = input.syncEnabled;
  if (input.opportunityId !== undefined) request.opportunityId = input.opportunityId;
  if (input.timezone !== undefined) request.timezone = input.timezone;
  if (input.allDay !== undefined) request.allDay = input.allDay;
  if (input.date && input.allDay === true) {
    request.startsOn = input.date;
    request.endsOn = input.endDate ?? null;
  } else if (input.date && input.allDay === false) {
    request.startsAt = zonedDateTimeToIso(
      input.date,
      input.time ?? "09:00",
      input.timezone ?? browserTimezone(),
    );
    request.endsAt = input.endTime
      ? zonedDateTimeToIso(
          input.endDate ?? input.date,
          input.endTime,
          input.timezone ?? browserTimezone(),
        )
      : null;
    request.startsOn = null;
    request.endsOn = null;
  }
  return request;
}

export async function updateCalendarItem(
  id: string,
  patch: UpdateCalendarItemInput,
): Promise<CalendarItemView> {
  const item = await requestData(
    `/api/calendar/${encodeURIComponent(id)}`,
    calendarItemEnvelopeSchema,
    { method: "PATCH", body: JSON.stringify(toUpdateRequest(patch)) },
  );
  return toCalendarItemView(item);
}

export async function completeCalendarItem(id: string): Promise<CalendarItemView> {
  const item = await requestData(
    `/api/calendar/${encodeURIComponent(id)}/complete`,
    calendarItemEnvelopeSchema,
    { method: "POST" },
  );
  return toCalendarItemView(item);
}

export async function deleteCalendarItem(id: string): Promise<void> {
  await requestEmpty(`/api/calendar/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function resolveCompany(input: CreateApplicationPlanInput): Promise<Company> {
  if (input.companyId) {
    return requestData(
      `/api/companies/${encodeURIComponent(input.companyId)}`,
      companyEnvelopeSchema,
    );
  }
  if (!input.companySlug) {
    throw new CalendarApiError("COMPANY_REQUIRED", "Choose a company before creating a plan.");
  }
  return requestData(
    `/api/companies/${encodeURIComponent(input.companySlug)}`,
    companyEnvelopeSchema,
  );
}

export async function createApplicationPlan(
  input: CreateApplicationPlanInput,
): Promise<ApplicationPlan> {
  const company = await resolveCompany(input);
  const request: CreateApplicationPlanRequest = {
    companyId: company.id,
    jobId: input.jobId,
    opportunityId: input.opportunityId,
    recruitingDateId: input.recruitingDateId,
    title: input.targetLabel,
    targetDate: input.targetDate,
    timezone: input.timezone ?? browserTimezone(),
  };
  return requestData("/api/application-plans", applicationPlanEnvelopeSchema, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function listApplicationPlans(
  filters: {
    company?: string;
    status?: ApplicationPlan["status"];
  } = {},
): Promise<ApplicationPlan[]> {
  return requestData(
    `/api/application-plans${queryString(filters)}`,
    applicationPlanListEnvelopeSchema,
  );
}

export async function getApplicationPlan(id: string): Promise<ApplicationPlan> {
  return requestData(
    `/api/application-plans/${encodeURIComponent(id)}`,
    applicationPlanEnvelopeSchema,
  );
}

export async function updateApplicationPlan(
  id: string,
  patch: UpdateApplicationPlanRequest,
): Promise<ApplicationPlan> {
  return requestData(
    `/api/application-plans/${encodeURIComponent(id)}`,
    applicationPlanEnvelopeSchema,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export async function deleteApplicationPlan(id: string): Promise<void> {
  await requestEmpty(`/api/application-plans/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function activateApplicationPlan(id: string, sync = false): Promise<ApplicationPlan> {
  return requestData(
    `/api/application-plans/${encodeURIComponent(id)}/activate`,
    applicationPlanEnvelopeSchema,
    { method: "POST", body: JSON.stringify({ sync }) },
  );
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  return requestData(
    "/api/integrations/google-calendar/status",
    googleCalendarStatusEnvelopeSchema,
  );
}

export async function getGoogleCalendarAuthorizeUrl(): Promise<string> {
  const authorization = await requestData(
    "/api/integrations/google-calendar/authorize",
    googleCalendarAuthorizeEnvelopeSchema,
  );
  return authorization.authorizeUrl;
}

export async function getGoogleCalendars(): Promise<GoogleCalendarOption[]> {
  return requestData(
    "/api/integrations/google-calendar/calendars",
    googleCalendarListEnvelopeSchema,
  );
}

export async function updateGoogleCalendar(
  patch: UpdateGoogleCalendarRequest,
): Promise<GoogleCalendarStatus> {
  return requestData("/api/integrations/google-calendar", googleCalendarStatusEnvelopeSchema, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function syncGoogleCalendar(): Promise<CalendarSyncRequest> {
  return requestData("/api/integrations/google-calendar/sync", calendarSyncRequestEnvelopeSchema, {
    method: "POST",
  });
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarStatus> {
  await requestEmpty("/api/integrations/google-calendar", { method: "DELETE" });
  return getGoogleCalendarStatus();
}

export async function getCompanyOptions(): Promise<Company[]> {
  return requestData("/api/companies?limit=100&offset=0", companyListEnvelopeSchema);
}
