"use client";

import { Upload } from "lucide-react";
import { ChangeEvent, useCallback, useEffect, useState } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Resume = {
  id: string;
  originalFilename: string;
  mediaType: string;
  status: string;
  createdAt: string;
};
type Version = { id: string; versionNumber: number };
type Evidence = {
  id: string;
  evidenceType: string;
  normalizedValue: Record<string, unknown>;
  source: string;
  reviewStatus: "EXTRACTED" | "CONFIRMED" | "REJECTED" | "SUPERSEDED" | "UNKNOWN";
  reviewVersion: number;
};

function evidenceTone(item: Evidence): { tone: BadgeTone; label: string } {
  switch (item.reviewStatus) {
    case "CONFIRMED":
      return item.source === "USER_CORRECTED"
        ? { tone: "accent", label: "Corrected" }
        : { tone: "success", label: "Confirmed" };
    case "REJECTED":
      return { tone: "danger", label: "Rejected" };
    case "SUPERSEDED":
      return { tone: "neutral", label: "Replaced" };
    case "EXTRACTED":
      return { tone: "warning", label: "Needs review" };
    case "UNKNOWN":
    default:
      return { tone: "neutral", label: "Unknown" };
  }
}

export function ResumesPanel() {
  const [items, setItems] = useState<Resume[]>([]);
  const [selected, setSelected] = useState<Resume | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [text, setText] = useState("");
  const [correction, setCorrection] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/resumes", { cache: "no-store" });
    if (response.ok) setItems((await response.json()).data);
    else
      setMessage(
        response.status === 401
          ? "Sign in to manage your resumes."
          : "Resumes are temporarily unavailable.",
      );
    setLoading(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function select(document: Resume) {
    setSelected(document);
    setEvidence([]);
    setText("");
    const response = await fetch(`/api/resumes/${document.id}/versions`, { cache: "no-store" });
    const next = response.ok ? ((await response.json()).data as Version[]) : [];
    setVersions(next);
    if (next[0]) await loadEvidence(document.id, next[0].id);
  }
  async function loadEvidence(documentId: string, versionId: string) {
    const response = await fetch(
      `/api/resumes/${documentId}/evidence?resumeVersionId=${versionId}`,
      { cache: "no-store" },
    );
    if (response.ok) setEvidence((await response.json()).data);
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10_000_000 || !["application/pdf", "text/plain"].includes(file.type)) {
      setMessage("Choose a PDF or text resume smaller than 10 MB.");
      return;
    }
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The selected file could not be read."));
      reader.onload = () => {
        const result = String(reader.result ?? "");
        resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
      };
      reader.readAsDataURL(file);
    });
    const response = await fetch("/api/resumes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ originalFilename: file.name, mediaType: file.type, content }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setMessage(
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : "Resume upload failed. The file may be unsupported.",
      );
      return;
    }
    const document = (await response.json()).data as Resume;
    setMessage("Resume encrypted and stored. Add extracted text to create a reviewable version.");
    await load();
    await select(document);
  }
  async function createVersion() {
    if (!selected || !text.trim()) return;
    const response = await fetch(`/api/resumes/${selected.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extractedText: text }),
    });
    if (!response.ok) {
      setMessage("Could not create the resume version.");
      return;
    }
    const version = (await response.json()).data as Version;
    await fetch(`/api/resumes/${selected.id}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeVersionId: version.id }),
    });
    setMessage("Parsing started. Refresh this resume in a moment to review what was found.");
    await select(selected);
  }
  async function review(item: Evidence, action: "CONFIRMED" | "REJECTED") {
    if (!selected || !versions[0]) return;
    const response = await fetch(`/api/resumes/${selected.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resumeVersionId: versions[0].id,
        evidenceId: item.id,
        action,
        expectedVersion: item.reviewVersion,
      }),
    });
    if (!response.ok) {
      setMessage("That review couldn't be saved — refresh and try again.");
      return;
    }
    await loadEvidence(selected.id, versions[0].id);
  }
  async function correct(item: Evidence) {
    if (!selected) return;
    let normalizedValue: Record<string, unknown>;
    try {
      normalizedValue = JSON.parse(correction[item.id] ?? "");
    } catch {
      setMessage('Correction must be valid JSON, for example {"skill":"TypeScript"}.');
      return;
    }
    const response = await fetch(`/api/resume-evidence/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ disposition: "CORRECTED", normalizedValue }),
    });
    if (!response.ok) {
      setMessage("That correction couldn't be saved — refresh and try again.");
      return;
    }
    setMessage("Correction saved. Your previous entry is kept as history, not deleted.");
    await loadEvidence(selected.id, versions[0]?.id ?? "");
  }
  async function remove() {
    if (!selected || !confirm("Delete this encrypted resume and its private evidence?")) return;
    const response = await fetch(`/api/resumes/${selected.id}`, { method: "DELETE" });
    if (response.ok) {
      setSelected(null);
      setVersions([]);
      setEvidence([]);
      await load();
    } else setMessage("Resume deletion failed.");
  }

  if (loading) return <Spinner className="surface p-6" label="Loading your resumes…" />;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="surface p-5">
        <label className={buttonVariants({ className: "mb-4 cursor-pointer" })}>
          <Upload aria-hidden="true" className="size-4" />
          Upload resume
          <input
            accept="application/pdf,text/plain"
            className="sr-only"
            onChange={(event) => void upload(event)}
            type="file"
          />
        </label>
        <p className="text-xs text-[var(--muted)]">
          Files are encrypted. RecruitIntel never turns an unreviewed extraction into confirmed
          evidence — you decide what&apos;s confirmed.
        </p>
        <div className="divide-y divide-[var(--line)]">
          {items.map((item) => (
            <button
              className="w-full py-3 text-left"
              key={item.id}
              onClick={() => void select(item)}
              type="button"
            >
              <span className="block font-semibold">{item.originalFilename}</span>
              <span className="text-xs text-[var(--muted)]">
                {item.status} · {new Date(item.createdAt).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
        {!items.length ? (
          <p className="text-sm text-[var(--muted)]">
            No resume yet. A resume is optional — anything we don&apos;t have evidence for stays
            marked unknown, never assumed.
          </p>
        ) : null}
      </section>
      <section className="surface p-5" aria-live="polite">
        {!selected ? (
          <p className="text-sm text-[var(--muted)]">
            Select a resume to review its versions and evidence.
          </p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Encrypted private document</div>
                <h2 className="mt-1 font-serif text-2xl">{selected.originalFilename}</h2>
              </div>
              <button
                className="text-sm font-bold text-[var(--danger)]"
                onClick={() => void remove()}
                type="button"
              >
                Delete
              </button>
            </div>
            <label className="mt-4 block text-sm font-semibold">
              Extracted text for a new version
              <textarea
                className="mt-1 min-h-28 w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-white/70 p-3 font-normal"
                onChange={(event) => setText(event.target.value)}
                placeholder="Paste the text you want RecruitIntel to parse. Review every extracted claim below."
                value={text}
              />
            </label>
            <Button className="mt-2" onClick={() => void createVersion()} size="sm">
              Create and parse version
            </Button>
            <div className="mt-6">
              <h3 className="text-sm font-bold">Evidence review</h3>
              {!versions.length ? (
                <p className="text-sm text-[var(--muted)]">No parsed version yet.</p>
              ) : (
                <div className="space-y-3">
                  {evidence.map((item) => {
                    const { tone, label } = evidenceTone(item);
                    const superseded = item.reviewStatus === "SUPERSEDED";
                    return (
                      <article
                        className="rounded-[var(--radius-sm)] border border-[var(--line)] p-3"
                        key={item.id}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={
                              superseded ? "text-[var(--muted)] line-through" : "font-semibold"
                            }
                          >
                            {item.evidenceType}
                          </span>
                          <Badge tone={tone}>{label}</Badge>
                        </div>
                        <pre
                          className={
                            "mt-2 overflow-auto text-xs whitespace-pre-wrap" +
                            (superseded ? " text-[var(--muted)] line-through" : "")
                          }
                        >
                          {JSON.stringify(item.normalizedValue)}
                        </pre>
                        {["EXTRACTED", "UNKNOWN"].includes(item.reviewStatus) ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              className="text-sm font-bold text-[var(--success)]"
                              onClick={() => void review(item, "CONFIRMED")}
                              type="button"
                            >
                              Confirm
                            </button>
                            <button
                              className="text-sm font-bold text-[var(--danger)]"
                              onClick={() => void review(item, "REJECTED")}
                              type="button"
                            >
                              Reject
                            </button>
                            <input
                              aria-label={`Correction for ${item.evidenceType}`}
                              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] px-2 py-1 text-xs"
                              onChange={(event) =>
                                setCorrection((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              placeholder='{"skill":"…"}'
                              value={correction[item.id] ?? ""}
                            />
                            <button
                              className="text-sm font-bold text-[var(--accent)]"
                              onClick={() => void correct(item)}
                              type="button"
                            >
                              Correct
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
        {message ? <p className="mt-4 text-sm text-[var(--muted)]">{message}</p> : null}
      </section>
    </div>
  );
}
