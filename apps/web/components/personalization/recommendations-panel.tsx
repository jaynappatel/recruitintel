"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { humanizeEnum } from "@recruitintel/shared";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { NoticeBanner } from "@/components/ui/notice-banner";
import { Spinner } from "@/components/ui/spinner";

import { WatchButton } from "./watch-button";

const categoryTone: Record<Recommendation["category"], BadgeTone> = {
  HIGH_PRIORITY: "accent",
  MEDIUM_PRIORITY: "neutral",
  LOW_PRIORITY: "neutral",
  NOT_ELIGIBLE: "danger",
};

type Recommendation = {
  impressionId: string;
  opportunity: {
    id: string;
    title: string;
    company: { id: string; name: string; slug: string };
    location: string;
    workplaceMode: string;
    roleFamily: string;
    isInternship: boolean;
    isNewGrad: boolean;
    deadlineAt: string | null;
  };
  recommendationScore: number | null;
  category: "HIGH_PRIORITY" | "MEDIUM_PRIORITY" | "LOW_PRIORITY" | "NOT_ELIGIBLE";
  eligibility: "ELIGIBLE" | "UNKNOWN" | "NOT_ELIGIBLE";
  evidenceCoverage: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  potentialMismatches: string[];
  hardConstraints: string[];
  algorithmVersion: string;
};

export function RecommendationsPanel({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/recommendations/opportunities?limit=${compact ? 5 : 20}&includeLowPriority=true`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (response.status === 401) throw new Error("Sign in to see private recommendations");
      if (!response.ok) throw new Error("Recommendations are temporarily unavailable");
      const result = (await response.json()) as { data: Recommendation[] };
      setItems(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recommendations are unavailable");
    } finally {
      setLoading(false);
    }
  }, [compact]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function dismiss(item: Recommendation) {
    const response = await fetch(`/api/opportunities/${item.opportunity.id}/dismiss`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reasonCode: "NOT_INTERESTED" }),
    });
    if (!response.ok) {
      setError("Could not dismiss that opportunity");
      return;
    }
    setItems((current) => current.filter((value) => value.opportunity.id !== item.opportunity.id));
    setUndo({ id: item.opportunity.id, title: item.opportunity.title });
  }

  async function restore() {
    if (!undo) return;
    const response = await fetch(`/api/opportunities/${undo.id}/dismiss`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (response.ok) {
      setUndo(null);
      await load();
    }
  }

  function opened(item: Recommendation) {
    void fetch("/api/recommendations/open", {
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ impressionId: item.impressionId }),
    });
  }

  if (loading) {
    return (
      <div className="surface grid min-h-40 place-items-center">
        <Spinner label="Loading recommendations…" />
      </div>
    );
  }
  if (error) {
    return <NoticeBanner tone="error">{error}</NoticeBanner>;
  }

  return (
    <div className="flex flex-col gap-4">
      {undo && (
        <div className="surface flex items-center justify-between gap-4 p-4 text-sm">
          <span>Dismissed {undo.title}. It can resurface after a material change.</span>
          <button
            className="font-bold text-[var(--accent)] underline"
            onClick={restore}
            type="button"
          >
            Undo
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="surface p-6 text-sm text-[var(--muted)]">
          Nothing to review right now. Set your preferences or watch a company to see more
          opportunities here.
        </div>
      ) : (
        items.map((item) => (
          <article className="surface p-5" key={item.impressionId}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="eyebrow mb-1">{item.opportunity.company.name}</div>
                <h2 className="m-0 font-serif text-2xl font-semibold">{item.opportunity.title}</h2>
                <p className="mt-2 mb-0 text-sm text-[var(--muted)]">
                  {item.opportunity.location || "Location not specified"} ·{" "}
                  {humanizeEnum(item.opportunity.workplaceMode)}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <WatchButton entityId={item.opportunity.id} entityType="OPPORTUNITY" />
                <button
                  aria-label={`Dismiss ${item.opportunity.title}`}
                  className="rounded-[var(--radius-sm)] p-2 text-[var(--muted)] hover:bg-[var(--surface-soft)]"
                  onClick={() => dismiss(item)}
                  type="button"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--panel)] px-3 py-1.5 text-xs font-bold text-white">
                Priority score: {item.recommendationScore ?? "Not enough evidence"}
              </span>
              <Badge tone={categoryTone[item.category]}>{humanizeEnum(item.category)}</Badge>
              <span className="text-xs text-[var(--muted)]">
                {humanizeEnum(item.eligibility)} · {item.evidenceCoverage.toLowerCase()} evidence
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center gap-1 text-xs font-bold uppercase">
                  <CheckCircle2 aria-hidden="true" className="size-3.5 text-[var(--success)]" />{" "}
                  Reasons
                </div>
                <ul className="m-0 space-y-1 pl-5 text-sm">
                  {item.reasons.slice(0, compact ? 3 : 8).map((reason) => (
                    <li key={reason}>{humanizeEnum(reason)}</li>
                  ))}
                </ul>
              </div>
              {(item.potentialMismatches.length > 0 || item.hardConstraints.length > 0) && (
                <div>
                  <div className="mb-2 flex items-center gap-1 text-xs font-bold uppercase text-[var(--warning)]">
                    <AlertTriangle aria-hidden="true" className="size-3.5" /> Unknowns or mismatches
                  </div>
                  <ul className="m-0 space-y-1 pl-5 text-sm">
                    {[...item.hardConstraints, ...item.potentialMismatches]
                      .slice(0, compact ? 3 : 8)
                      .map((reason) => (
                        <li key={reason}>{humanizeEnum(reason)}</li>
                      ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end border-t border-[var(--line)] pt-4">
              <Link
                className="inline-flex items-center gap-1 text-sm font-bold text-[var(--accent)]"
                href={`/opportunities/${item.opportunity.id}`}
                onClick={() => opened(item)}
                prefetch={false}
              >
                Review opportunity <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
