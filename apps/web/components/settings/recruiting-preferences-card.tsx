"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { humanizeEnum } from "@recruitintel/shared";

const roleFamilies = [
  "SOFTWARE_ENGINEERING",
  "AI_ML",
  "DATA_SCIENCE",
  "DATA_ENGINEERING",
  "PRODUCT",
  "DESIGN",
  "SECURITY",
  "CLOUD_DEVOPS",
  "QUANT",
  "HARDWARE",
] as const;
const experienceLevels = [
  "INTERNSHIP",
  "ENTRY_LEVEL",
  "MID_LEVEL",
  "SENIOR",
  "LEADERSHIP",
] as const;
const workplaceModes = ["REMOTE", "HYBRID", "ONSITE"] as const;
const alertTypes = [
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

type Preferences = {
  graduationYear: number | null;
  usWorkAuthorized: boolean | null;
  requiresEmployerSponsorship: boolean | null;
  roleFamilies: string[];
  earlyCareerTracks: string[];
  experienceLevels: string[];
  workplaceModes: string[];
  locations: Array<{ displayLabel: string }>;
  targetSchools: Array<{ id: string }>;
};
type Notifications = { inAppEnabled: boolean; alertTypes: Record<string, boolean> };
type School = { id: string; canonicalName: string };

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function parseLocations(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((displayLabel) => {
      if (/^remote:/i.test(displayLabel)) {
        return {
          kind: "REMOTE_REGION",
          remoteRegion: displayLabel.replace(/^remote:\s*/i, ""),
          displayLabel,
        };
      }
      const parts = displayLabel.split(",").map((part) => part.trim());
      if (parts.length === 1)
        return { kind: "COUNTRY", countryCode: parts[0]?.toUpperCase(), displayLabel };
      if (parts.length === 2)
        return {
          kind: "REGION_COUNTRY",
          region: parts[0],
          countryCode: parts[1]?.toUpperCase(),
          displayLabel,
        };
      return {
        kind: "CITY_REGION_COUNTRY",
        city: parts[0],
        region: parts[1],
        countryCode: parts[2]?.toUpperCase(),
        displayLabel,
      };
    });
}

function MultiChecks({
  values,
  selected,
  onChange,
}: {
  values: readonly string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <label
          className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white/60 px-3 py-2 text-sm"
          key={value}
        >
          <input
            checked={selected.includes(value)}
            onChange={() => onChange(toggle(selected, value))}
            type="checkbox"
          />
          {humanizeEnum(value)}
        </label>
      ))}
    </div>
  );
}

export function RecruitingPreferencesCard() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [notifications, setNotifications] = useState<Notifications | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [locationText, setLocationText] = useState("");
  const [targetSchoolIds, setTargetSchoolIds] = useState<string[]>([]);
  const [status, setStatus] = useState("Loading private settings…");

  useEffect(() => {
    void Promise.all([
      fetch("/api/me/recruiting-preferences", { cache: "no-store" }),
      fetch("/api/notification-preferences", { cache: "no-store" }),
      fetch("/api/schools?limit=100", { cache: "no-store" }),
    ])
      .then(async ([preferenceResponse, notificationResponse, schoolResponse]) => {
        if (preferenceResponse.status === 401)
          throw new Error("Sign in to configure private preferences");
        if (!preferenceResponse.ok || !notificationResponse.ok)
          throw new Error("Settings are temporarily unavailable");
        const preferenceData = ((await preferenceResponse.json()) as { data: Preferences }).data;
        setPreferences(preferenceData);
        setLocationText(preferenceData.locations.map((item) => item.displayLabel).join("\n"));
        setTargetSchoolIds(preferenceData.targetSchools.map((school) => school.id));
        setNotifications(((await notificationResponse.json()) as { data: Notifications }).data);
        if (schoolResponse.ok)
          setSchools(((await schoolResponse.json()) as { data: School[] }).data);
        setStatus("");
      })
      .catch((error: unknown) =>
        setStatus(error instanceof Error ? error.message : "Settings unavailable"),
      );
  }, []);

  if (!preferences || !notifications)
    return (
      <div className="text-sm text-[var(--muted)]">
        <LoaderCircle className="mr-2 inline size-4 animate-spin" />
        {status}
      </div>
    );

  async function savePreferences() {
    setStatus("Saving…");
    const response = await fetch("/api/me/recruiting-preferences", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...preferences,
        locations: parseLocations(locationText),
        targetSchoolIds,
        targetSchools: undefined,
        version: undefined,
        updatedAt: undefined,
      }),
    });
    if (!response.ok)
      return setStatus("Review the location format and selected values, then try again.");
    setPreferences(((await response.json()) as { data: Preferences }).data);
    setStatus("Preferences saved.");
  }

  async function saveNotifications(next: Notifications) {
    setNotifications(next);
    setStatus("Saving…");
    const response = await fetch("/api/notification-preferences", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    setStatus(
      response.ok ? "Notification settings saved." : "Could not save notification settings.",
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          Graduation year
          <input
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2"
            min="2020"
            max="2050"
            onChange={(event) =>
              setPreferences({
                ...preferences,
                graduationYear: event.target.value ? Number(event.target.value) : null,
              })
            }
            placeholder="Unset"
            type="number"
            value={preferences.graduationYear ?? ""}
          />
        </label>
        <label className="text-sm font-semibold">
          US work authorization
          <select
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2"
            onChange={(event) =>
              setPreferences({
                ...preferences,
                usWorkAuthorized:
                  event.target.value === "UNKNOWN" ? null : event.target.value === "YES",
              })
            }
            value={
              preferences.usWorkAuthorized === null
                ? "UNKNOWN"
                : preferences.usWorkAuthorized
                  ? "YES"
                  : "NO"
            }
          >
            <option value="UNKNOWN">Unset / unknown</option>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Requires employer sponsorship
          <select
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2"
            onChange={(event) =>
              setPreferences({
                ...preferences,
                requiresEmployerSponsorship:
                  event.target.value === "UNKNOWN" ? null : event.target.value === "YES",
              })
            }
            value={
              preferences.requiresEmployerSponsorship === null
                ? "UNKNOWN"
                : preferences.requiresEmployerSponsorship
                  ? "YES"
                  : "NO"
            }
          >
            <option value="UNKNOWN">Unset / unknown</option>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Target schools
          <select
            className="mt-1 h-28 w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2"
            multiple
            onChange={(event) =>
              setTargetSchoolIds(Array.from(event.target.selectedOptions, (option) => option.value))
            }
            value={targetSchoolIds}
          >
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.canonicalName}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">Role families</div>
        <MultiChecks
          onChange={(roleFamilies) => setPreferences({ ...preferences, roleFamilies })}
          selected={preferences.roleFamilies}
          values={roleFamilies}
        />
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">Early-career tracks</div>
        <MultiChecks
          onChange={(earlyCareerTracks) => setPreferences({ ...preferences, earlyCareerTracks })}
          selected={preferences.earlyCareerTracks}
          values={["INTERNSHIP", "NEW_GRAD"]}
        />
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">Experience levels</div>
        <MultiChecks
          onChange={(levels) => setPreferences({ ...preferences, experienceLevels: levels })}
          selected={preferences.experienceLevels}
          values={experienceLevels}
        />
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">Workplace modes</div>
        <MultiChecks
          onChange={(modes) => setPreferences({ ...preferences, workplaceModes: modes })}
          selected={preferences.workplaceModes}
          values={workplaceModes}
        />
      </div>
      <label className="text-sm font-semibold">
        Preferred locations
        <textarea
          className="mt-1 min-h-28 w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 font-normal"
          onChange={(event) => setLocationText(event.target.value)}
          placeholder={"US\nAustin, TX, US\nRemote: North America"}
          value={locationText}
        />
        <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
          One per line: country code; region, country; city, region, country; or Remote: region.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button
          className="rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white"
          onClick={savePreferences}
          type="button"
        >
          Save recruiting preferences
        </button>
        <span className="text-xs text-[var(--muted)]">{status}</span>
      </div>

      <div className="border-t border-[var(--line)] pt-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">In-app alerts</div>
            <div className="text-xs text-[var(--muted)]">
              M9 does not send email, SMS, or push notifications.
            </div>
          </div>
          <input
            checked={notifications.inAppEnabled}
            onChange={(event) =>
              void saveNotifications({ ...notifications, inAppEnabled: event.target.checked })
            }
            type="checkbox"
          />
        </div>
        <div className="divide-y divide-[var(--line)]">
          {alertTypes.map((type) => (
            <label className="flex items-center justify-between gap-4 py-2.5 text-sm" key={type}>
              <span>{humanizeEnum(type)}</span>
              <input
                checked={notifications.alertTypes[type] ?? false}
                disabled={!notifications.inAppEnabled}
                onChange={(event) =>
                  void saveNotifications({
                    ...notifications,
                    alertTypes: { ...notifications.alertTypes, [type]: event.target.checked },
                  })
                }
                type="checkbox"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
