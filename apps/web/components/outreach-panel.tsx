"use client";
import { useCallback, useEffect, useState } from "react";
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
export function OutreachPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const load = useCallback(async () => {
    const [c, d] = await Promise.all([
      fetch("/api/outreach/contacts"),
      fetch("/api/outreach/drafts"),
    ]);
    if (!c.ok || !d.ok) {
      setError("Sign in to manage private outreach.");
      return;
    }
    setContacts((await c.json()).data);
    setDrafts((await d.json()).data);
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
      setError("Contact could not be saved. Use a valid email and explicit provenance.");
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
    if (!r.ok) return setError("Draft could not be created.");
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
    if (!r.ok) return setError("The draft changed; reload and review it again.");
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
    if (!r.ok) return setError("Approval requires the current draft version.");
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
    if (!r.ok) return setError("This draft is not currently eligible to record as sent.");
    await navigator.clipboard.writeText(
      `To: ${contacts.find((c) => c.id === draft.contactId)?.email ?? ""}\nSubject: ${draft.subject}\n\n${draft.body}`,
    );
    setDraft(null);
    await load();
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {error && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800 lg:col-span-2">{error}</p>
      )}
      <section className="surface p-5">
        <h2 className="font-serif text-2xl">Private contacts</h2>
        <p className="text-sm text-[var(--muted)]">
          Contacts are owner-scoped. Public evidence never supplies a guessed email.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            aria-label="Contact name"
            className="min-w-0 flex-1 rounded border p-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <input
            aria-label="Contact email"
            className="min-w-0 flex-1 rounded border p-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
          />
          <button className="rounded bg-[var(--forest)] px-3 text-white" onClick={add}>
            Add
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {contacts.map((c) => (
            <div className="rounded-xl border p-3" key={c.id}>
              <b>{c.displayName}</b>
              <div className="text-sm">
                {c.email} · {c.contactTruth}
              </div>
              <div className="text-xs text-[var(--muted)]">
                {c.sourceUrl ? (
                  <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer">
                    {c.sourceLabel}
                  </a>
                ) : (
                  c.sourceLabel
                )}
              </div>
              <button
                className="mt-2 text-sm font-semibold text-[var(--forest)]"
                onClick={() => create(c.id)}
              >
                Create grounded draft
              </button>
            </div>
          ))}
          {!contacts.length && <p className="text-sm text-[var(--muted)]">No contacts yet.</p>}
        </div>
      </section>
      <section className="surface p-5">
        <h2 className="font-serif text-2xl">Review queue</h2>
        {draft ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm">Evidence: {draft.grounding.map((x) => x.text).join("; ")}</p>
            <input
              aria-label="Subject"
              className="w-full rounded border p-2"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
            <textarea
              aria-label="Body"
              className="min-h-48 w-full rounded border p-2"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <div className="flex gap-2">
              <button className="rounded border px-3 py-2" onClick={save}>
                Save edits
              </button>
              <button className="rounded bg-[var(--forest)] px-3 py-2 text-white" onClick={approve}>
                Approve exact version
              </button>
              {draft.status === "SEND_ELIGIBLE" && (
                <button className="rounded bg-[var(--mint)] px-3 py-2" onClick={record}>
                  Copy & record manual send
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {drafts.map((d) => (
              <button
                className="block w-full rounded border p-3 text-left"
                onClick={() => setDraft(d)}
                key={d.id}
              >
                <b>{d.subject}</b>
                <div className="text-xs text-[var(--muted)]">
                  {d.status} · version {d.version}
                  {d.followUpDueAt
                    ? ` · follow-up due ${new Date(d.followUpDueAt).toLocaleDateString()}`
                    : ""}
                </div>
              </button>
            ))}
            {!drafts.length && (
              <p className="text-sm text-[var(--muted)]">
                Create a contact and then a draft to begin review.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
