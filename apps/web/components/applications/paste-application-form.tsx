"use client";

import { ClipboardPaste, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

function guessDetails(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const value = (label: RegExp) =>
    lines.find((line) => label.test(line))?.split(/:\s*/, 2)[1] ?? "";
  return {
    title: value(/^(title|role|position)\s*:/i) || lines[0] || "",
    companyName: value(/^(company|employer)\s*:/i),
    location: value(/^(location|where)\s*:/i),
    salary: value(/^(salary|compensation|pay)\s*:/i),
  };
}

export function PasteApplicationForm({ onCreated }: { onCreated: () => void }) {
  const [paste, setPaste] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [salary, setSalary] = useState("");
  const [applicationUrl, setApplicationUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [appliedAt, setAppliedAt] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function parsePaste() {
    const parsed = guessDetails(paste);
    if (parsed.title) setTitle(parsed.title);
    if (parsed.companyName) setCompanyName(parsed.companyName);
    if (parsed.location) setLocation(parsed.location);
    if (parsed.salary) setSalary(parsed.salary);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/applications", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName,
        title,
        location,
        salary,
        description: paste,
        notes,
        applicationUrl,
        appliedAt: new Date(`${appliedAt}T12:00:00`).toISOString(),
      }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(result?.error?.message ?? "The application could not be imported.");
      setBusy(false);
      return;
    }
    setPaste("");
    setCompanyName("");
    setTitle("");
    setLocation("");
    setSalary("");
    setApplicationUrl("");
    setNotes("");
    setBusy(false);
    onCreated();
  }

  return (
    <section className="surface mb-6 p-5" aria-label="Import an application">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Already applied somewhere else?</div>
          <h2 className="mt-1 font-serif text-2xl font-semibold">Paste it into your tracker</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            We’ll save the job and mark it applied today. Review the fields before importing.
          </p>
        </div>
        <ClipboardPaste aria-hidden="true" className="size-5 text-[var(--accent)]" />
      </div>
      <textarea
        className="mt-5 min-h-28 w-full rounded-xl border border-[var(--line)] bg-white p-3 text-sm"
        onChange={(event) => setPaste(event.target.value)}
        placeholder="Paste the job description, confirmation email, or job details here…"
        value={paste}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <Button onClick={parsePaste} size="sm" variant="secondary">
          Fill fields from paste
        </Button>
        <span className="text-xs text-[var(--muted)]">
          Labels like “Company:” and “Location:” work best.
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          aria-label="Company"
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
          onChange={(event) => setCompanyName(event.target.value)}
          placeholder="Company"
          value={companyName}
        />
        <input
          aria-label="Job title"
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Job title"
          value={title}
        />
        <input
          aria-label="Location"
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
          onChange={(event) => setLocation(event.target.value)}
          placeholder="Location or remote"
          value={location}
        />
        <input
          aria-label="Salary"
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
          onChange={(event) => setSalary(event.target.value)}
          placeholder="Salary or compensation"
          value={salary}
        />
        <input
          aria-label="Application URL"
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm sm:col-span-2"
          onChange={(event) => setApplicationUrl(event.target.value)}
          placeholder="https:// application or job URL (required)"
          type="url"
          value={applicationUrl}
        />
        <input
          aria-label="Applied date"
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
          onChange={(event) => setAppliedAt(event.target.value)}
          type="date"
          value={appliedAt}
        />
        <input
          aria-label="Notes"
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Notes (optional)"
          value={notes}
        />
      </div>
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="mt-4" disabled={busy} onClick={() => void submit()}>
        {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
        {busy ? "Importing…" : "Import as applied"}
      </Button>
    </section>
  );
}
