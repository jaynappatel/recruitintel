"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Preferences = { roleFamilies: string[]; experienceLevels: string[]; locations: unknown[] };

export function OnboardingChecklist() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    void fetch("/api/me/recruiting-preferences", { cache: "no-store" }).then(async (response) =>
      response.ok ? setPreferences((await response.json()).data) : setPreferences(null),
    );
  }, []);
  if (dismissed || !preferences) return null;
  const complete = preferences.roleFamilies.length > 0 && preferences.experienceLevels.length > 0;
  if (complete) return null;
  return (
    <section className="surface mb-8 border-[var(--accent)] p-5" aria-label="Getting started">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Get started</div>
          <h2 className="mt-1 mb-1 font-serif text-2xl">Make your first recommendations useful</h2>
          <p className="m-0 max-w-2xl text-sm text-[var(--muted)]">
            Add role interests and career track first. A resume is optional and every extracted
            claim remains yours to review.
          </p>
        </div>
        <button
          aria-label="Dismiss onboarding reminder"
          className="text-sm font-bold text-[var(--muted)]"
          onClick={() => setDismissed(true)}
          type="button"
        >
          Not now
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          className="rounded-lg bg-[var(--panel)] px-3 py-2 text-sm font-bold text-white"
          href="/settings"
        >
          Set preferences
        </Link>
        <Link
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold"
          href="/resumes"
        >
          Add a resume
        </Link>
      </div>
    </section>
  );
}
