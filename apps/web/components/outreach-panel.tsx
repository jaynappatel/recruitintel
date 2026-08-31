"use client";
import { useCallback, useEffect, useState } from "react";

import { humanizeEnum } from "@recruitintel/shared";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NoticeBanner } from "@/components/ui/notice-banner";
import { Spinner } from "@/components/ui/spinner";

type Contact = {
  id: string;
  displayName: string;
  email: string;
  contactTruth: string;
  provenanceClass: string;
  sourceLabel: string;
  sourceUrl: string | null;
  lastSeenAt: string | null;
};
type Draft = {
  id: string;
  contactId: string;
  subject: string;
  body: string;
  status: string;
  version: number;
  grounding: Array<{ text: string; sourceUrl?: string }>;
  followUpDueAt: string | null;
};

const truthTone: Record<string, BadgeTone> = {
  VERIFIED_PUBLIC: "success",
  USER_PROVIDED: "neutral",
  UNVERIFIED: "warning",
};

export function OutreachPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const load = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([
        fetch("/api/outreach/contacts"),
        fetch("/api/outreach/drafts"),
      ]);
      if (!c.ok || !d.ok) {
        setError("Sign in to manage your outreach.");
        return;
      }
      setContacts((await c.json()).data);
      setDrafts((await d.json()).data);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function add() {
    setError(null);
    const r = await fetch("/api/outreach/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: name,
        email,
        contactTruth: "USER_PROVIDED",
        provenanceClass: "USER_ENTERED",
        sourceLabel: "User-entered contact",
        consentAt: new Date().toISOString(),
      }),
    });
    if (!r.ok) {
      setError("That contact couldn't be saved. Check the email address and try again.");
      return;
    }
    setName("");
    setEmail("");
    await load();
  }
  async function create(contactId: string) {
    const r = await fetch("/api/outreach/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId }),
    });
    if (!r.ok) return setError("The draft couldn't be created.");
    const next = (await r.json()).data as Draft;
    setDraft(next);
    await load();
  }
  async function save() {
    if (!draft) return;
    const r = await fetch(`/api/outreach/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: draft.subject, body: draft.body, version: draft.version }),
    });
    if (!r.ok) return setError("This draft changed elsewhere — reload it and try again.");
    setDraft((await r.json()).data);
    await load();
  }
  async function approve() {
    if (!draft) return;
    const r = await fetch(`/api/outreach/drafts/${draft.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: draft.version }),
    });
    if (!r.ok) return setError("This draft changed elsewhere — reload it before approving.");
    setDraft((await r.json()).data);
    await load();
  }
  async function record() {
    if (!draft) return;
    const r = await fetch(`/api/outreach/drafts/${draft.id}/manual-send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    });
    if (!r.ok) return setError("This draft isn't approved yet, so it can't be marked as sent.");
    await navigator.clipboard.writeText(
      `To: ${contacts.find((c) => c.id === draft.contactId)?.email ?? ""}\nSubject: ${draft.subject}\n\n${draft.body}`,
    );
    setDraft(null);
    await load();
  }

  if (loading) return <Spinner className="surface p-6" label="Loading your outreach…" />;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {error && (
        <NoticeBanner className="lg:col-span-2" compact tone="error">
          {error}
        </NoticeBanner>
      )}
      <section className="surface p-5">
        <h2 className="font-serif text-2xl">Your contacts</h2>
        <p className="text-sm text-[var(--muted)]">
          Add people you already have a public or personal contact for. RecruitIntel never guesses
          an email address.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            aria-label="Contact name"
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] p-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <input
            aria-label="Contact email"
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] p-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
          />
          <Button onClick={() => void add()} size="sm">
            Add
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {contacts.map((c) => (
            <div className="rounded-[var(--radius-sm)] border border-[var(--line)] p-3" key={c.id}>
              <b>{c.displayName}</b>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span>{c.email}</span>
                <Badge tone={truthTone[c.contactTruth] ?? "neutral"}>
                  {humanizeEnum(c.contactTruth)}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {c.sourceUrl ? (
                  <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer">
                    {c.sourceLabel}
                  </a>
                ) : (
                  c.sourceLabel
                )}
              </div>
              <button
                className="mt-2 text-sm font-semibold text-[var(--accent)]"
                onClick={() => void create(c.id)}
                type="button"
              >
                Generate draft
              </button>
            </div>
          ))}
          {!contacts.length && (
            <p className="text-sm text-[var(--muted)]">
              No contacts yet. Add someone above to start a draft.
            </p>
          )}
        </div>
      </section>
      <section className="surface p-5">
        <h2 className="font-serif text-2xl">Drafts</h2>
        {draft ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-[var(--muted)]">
              Evidence: {draft.grounding.map((x) => x.text).join("; ")}
            </p>
            <input
              aria-label="Subject"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--line)] p-2"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
            <textarea
              aria-label="Body"
              className="min-h-48 w-full rounded-[var(--radius-sm)] border border-[var(--line)] p-2"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} size="sm" variant="secondary">
                Save edits
              </Button>
              <Button onClick={() => void approve()} size="sm" variant="secondary">
                Approve
              </Button>
              {draft.status === "SEND_ELIGIBLE" && (
                <Button onClick={() => void record()} size="sm">
                  Copy email &amp; mark as sent
                </Button>
              )}
            </div>
            <p className="text-xs text-[var(--muted)]">
              Approving doesn&apos;t send anything. You copy the email and send it yourself, then
              record it here so the follow-up is tracked.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {drafts.map((d) => (
              <button
                className="block w-full rounded-[var(--radius-sm)] border border-[var(--line)] p-3 text-left"
                onClick={() => setDraft(d)}
                key={d.id}
                type="button"
              >
                <b>{d.subject}</b>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                  <Badge tone="neutral">{humanizeEnum(d.status)}</Badge>
                  <span>Version {d.version}</span>
                  {d.followUpDueAt
                    ? ` · Follow up by ${new Date(d.followUpDueAt).toLocaleDateString()}`
                    : ""}
                </div>
              </button>
            ))}
            {!drafts.length && (
              <p className="text-sm text-[var(--muted)]">
                Generate a draft from one of your contacts to start review.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
