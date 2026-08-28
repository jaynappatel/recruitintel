"use client";

import Link from "next/link";
import { useState } from "react";

export function OpportunityActions({ opportunityId }: { opportunityId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  async function addApplication() {
    const response = await fetch("/api/applications", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opportunityId,
        cycleKey: `web-${new Date().toISOString().slice(0, 10)}`,
      }),
    });
    if (response.ok) {
      setMessage("Added to your private application board.");
      return;
    }
    setMessage(
      response.status === 401
        ? "Sign in to track this application."
        : "Could not add this opportunity. It may already be in this cycle.",
    );
  }
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button
        className="rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white"
        onClick={() => void addApplication()}
        type="button"
      >
        Track application
      </button>
      <Link
        className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-bold"
        href="/resumes"
      >
        Review resume match
      </Link>
      {message ? (
        <span aria-live="polite" className="text-sm text-[var(--muted)]">
          {message}
        </span>
      ) : null}
    </div>
  );
}
