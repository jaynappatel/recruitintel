import { notFound } from "next/navigation";

import { getRecruiter } from "@recruitintel/db";

import { WatchButton } from "@/components/personalization/watch-button";

export const dynamic = "force-dynamic";

export default async function RecruiterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recruiter = await getRecruiter(id);
  if (!recruiter) notFound();
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <div className="surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Recruiter intelligence</p>
            <h1 className="mt-2 font-serif text-4xl font-semibold">{recruiter.name}</h1>
            <p className="mt-2 text-[var(--muted)]">
              {recruiter.title} · {recruiter.company.name}
            </p>
          </div>
          <WatchButton entityId={recruiter.id} entityType="RECRUITER" />
        </div>
        <p className="mt-6 text-sm text-[var(--muted)]">
          Public evidence only. Watch this recruiter to receive meaningful recruiting updates in
          your private in-app alert mailbox.
        </p>
      </div>
    </main>
  );
}
