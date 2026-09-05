import { notFound } from "next/navigation";

import { getSchool } from "@recruitintel/db";

import { WatchButton } from "@/components/personalization/watch-button";
import { SchoolTheme } from "@/components/school-theme";

export const dynamic = "force-dynamic";

export default async function SchoolPage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  const school = await getSchool(identifier);
  if (!school) notFound();
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <SchoolTheme schoolName={school.canonicalName} schoolSlug={school.slug}>
        <div className="surface p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Campus intelligence</p>
              <h1 className="mt-2 font-serif text-4xl font-semibold">{school.canonicalName}</h1>
              <p className="mt-2 text-[var(--muted)]">
                {[school.city, school.stateRegion, school.country].filter(Boolean).join(", ") ||
                  "Location not classified"}
              </p>
            </div>
            <WatchButton entityId={school.id} entityType="SCHOOL" />
          </div>
          <p className="mt-6 text-sm text-[var(--muted)]">
            Watch this school to connect relevant campus events and recruiter intelligence to your
            private alert preferences.
          </p>
        </div>
      </SchoolTheme>
    </main>
  );
}
