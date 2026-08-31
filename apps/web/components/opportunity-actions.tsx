"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";

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
      setMessage("Added to your application board.");
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
      <Button onClick={() => void addApplication()}>Track application</Button>
      <Link className={buttonVariants({ variant: "secondary" })} href="/resumes">
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
