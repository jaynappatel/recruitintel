"use client";

import { useCallback, useEffect, useState } from "react";

import { humanizeEnum } from "@recruitintel/shared";

import { Badge } from "@/components/ui/badge";
import { NoticeBanner } from "@/components/ui/notice-banner";
import { Spinner } from "@/components/ui/spinner";

type Plan = {
  id: string;
  applicationId: string;
  interview: { id: string; type: string; status: string; startsAt: string; timezone: string };
  company: { name: string; description: string | null; website: string | null };
  roleTitle: string | null;
  stage: string;
  requirements: Array<{
    key: string;
    type: string;
    value: Record<string, unknown>;
    status: "CONFIRMED" | "UNKNOWN";
    evidence: string | null;
    action: string;
  }>;
  questionIntelligence: { items: unknown[]; excludedReason: string };
  items: Array<{
    id: string;
    key: string;
    title: string;
    rationale: string;
    kind: string;
    completed: boolean;
    version: number;
  }>;
  progress: { completed: number; total: number };
};

export function InterviewPrepPanel({ interviewId }: { interviewId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/interviews/${interviewId}/prep`, { cache: "no-store" });
    if (response.status === 404) {
      const created = await fetch(`/api/interviews/${interviewId}/prep`, { method: "POST" });
      if (!created.ok) throw new Error("Preparation can't be created for this interview.");
      setPlan((await created.json()).data);
    } else if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Sign in to view preparation."
          : "Preparation is temporarily unavailable.",
      );
    else setPlan((await response.json()).data);
    setLoading(false);
  }, [interviewId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Preparation is unavailable.");
        setLoading(false);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function toggle(item: Plan["items"][number]) {
    if (!plan) return;
    const response = await fetch(`/api/interviews/${interviewId}/prep/items/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: !item.completed, expectedVersion: item.version }),
    });
    if (!response.ok) {
      setError("This checklist item changed elsewhere. Refresh and try again.");
      return;
    }
    setPlan((await response.json()).data);
  }
  if (loading) return <Spinner className="surface p-6" label="Loading interview prep…" />;
  if (!plan)
    return <NoticeBanner tone="error">{error ?? "Preparation is unavailable."}</NoticeBanner>;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.25fr_0.75fr]" aria-live="polite">
      <main className="space-y-6">
        <section className="surface p-6">
          <div className="eyebrow">Application-linked preparation</div>
          <h2 className="mt-1 font-serif text-3xl">
            {plan.company.name} · {plan.roleTitle ?? "Role unknown"}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {humanizeEnum(plan.interview.type)} · Stage:{" "}
            {plan.stage === "NONE" ? "Unknown — general preparation" : humanizeEnum(plan.stage)} ·{" "}
            <time dateTime={plan.interview.startsAt}>
              {new Date(plan.interview.startsAt).toLocaleString()}
            </time>
          </p>
          {plan.company.description ? (
            <p className="text-sm">{plan.company.description}</p>
          ) : (
            <p className="text-sm text-[var(--muted)]">No company description is available.</p>
          )}
          {plan.company.website ? (
            <a
              className="text-sm font-bold underline"
              href={plan.company.website}
              rel="noreferrer"
              target="_blank"
            >
              Company source
            </a>
          ) : null}
        </section>
        <section className="surface p-6">
          <h2 className="mt-0 font-serif text-2xl">Job requirements and what we know</h2>
          {plan.requirements.length ? (
            <ul className="m-0 space-y-3 p-0">
              {plan.requirements.map((requirement) => (
                <li
                  className="list-none rounded-[var(--radius-sm)] border border-[var(--line)] p-3"
                  key={requirement.key}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">{humanizeEnum(requirement.type)}</strong>
                    <Badge tone={requirement.status === "CONFIRMED" ? "success" : "warning"}>
                      {requirement.status === "CONFIRMED" ? "Confirmed" : "Needs evidence"}
                    </Badge>
                  </div>
                  <p
                    className={
                      requirement.status === "CONFIRMED"
                        ? "mt-1 mb-0 text-sm text-[var(--muted)]"
                        : "mt-1 mb-0 text-sm font-medium"
                    }
                  >
                    {requirement.action}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              We don&apos;t have structured requirements for this job yet — preparation stays
              general.
            </p>
          )}
        </section>
        <section className="surface p-6">
          <h2 className="mt-0 font-serif text-2xl">Public question intelligence</h2>
          <NoticeBanner compact tone="info">
            {plan.questionIntelligence.excludedReason}
          </NoticeBanner>
        </section>
      </main>
      <aside className="surface p-6">
        <h2 className="mt-0 font-serif text-2xl">Preparation checklist</h2>
        <p className="text-sm text-[var(--muted)]">
          {plan.progress.completed} / {plan.progress.total} complete
        </p>
        <ul className="m-0 space-y-3 p-0">
          {plan.items.map((item) => (
            <li className="list-none" key={item.id}>
              <label className="flex gap-3">
                <input
                  checked={item.completed}
                  onChange={() => void toggle(item)}
                  type="checkbox"
                />
                <span>
                  <strong>{item.title}</strong>
                  <span className="mt-1 block text-xs text-[var(--muted)]">{item.rationale}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error ? (
          <NoticeBanner className="mt-4" compact tone="error">
            {error}
          </NoticeBanner>
        ) : null}
      </aside>
    </div>
  );
}
