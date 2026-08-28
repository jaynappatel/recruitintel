"use client";

import { useEffect, useState } from "react";

type Grant = { id: string; name: string; status: string; expiresAt: string };
type Analytics = {
  impressions: number;
  applications: number;
  oaProgressions: number;
  interviewProgressions: number;
  offers: number;
};

export function AccountControlsCard() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  async function load() {
    const [grantResponse, analyticsResponse] = await Promise.all([
      fetch("/api/extension/grants", { cache: "no-store" }),
      fetch("/api/me/analytics", { cache: "no-store" }),
    ]);
    if (grantResponse.ok) setGrants((await grantResponse.json()).data);
    if (analyticsResponse.ok) setAnalytics((await analyticsResponse.json()).data);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function grant() {
    const response = await fetch("/api/extension/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Browser companion",
        scopes: ["PAGE_SCAN", "JOB_IMPORT"],
        expiresInSeconds: 2_592_000,
      }),
    });
    if (response.ok) {
      const created = (await response.json()).data as Grant & { token: string };
      setOneTimeToken(created.token);
      setMessage(
        "Extension grant created. Copy the one-time token into the reviewed browser companion setup.",
      );
      await load();
    } else setMessage("Could not create an extension grant.");
  }
  async function revoke(id: string) {
    const response = await fetch(`/api/extension/grants/${id}`, { method: "DELETE" });
    if (response.ok) {
      setMessage("Extension grant revoked.");
      await load();
    } else setMessage("Could not revoke that grant.");
  }
  async function exportData() {
    const response = await fetch("/api/privacy/export", { cache: "no-store" });
    if (!response.ok) {
      setMessage("Export is temporarily unavailable.");
      return;
    }
    const payload = await response.json();
    const blob = new Blob([JSON.stringify(payload.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "recruitintel-export.json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Your private export was downloaded.");
  }
  async function deleteAccount() {
    if (!confirm("Delete your account and private data? This cannot be undone.")) return;
    const response = await fetch("/api/account", { method: "DELETE" });
    setMessage(
      response.ok ? "Account deletion completed." : "Account deletion could not be completed.",
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h3 className="m-0 text-sm font-bold">Browser companion</h3>
        <p className="text-sm text-[var(--muted)]">
          The MV3 companion scans only the active page after your explicit action. Grants can be
          revoked here.
        </p>
        <button
          className="rounded-lg bg-[var(--panel)] px-3 py-2 text-sm font-bold text-white"
          onClick={() => void grant()}
          type="button"
        >
          Create extension grant
        </button>
        {oneTimeToken ? (
          <div className="mt-3 rounded-lg border border-[var(--accent)] bg-white p-3 text-sm">
            <div className="font-bold">Copy this token now</div>
            <code className="mt-1 block break-all text-xs">{oneTimeToken}</code>
            <button
              className="mt-2 font-bold underline"
              onClick={() => setOneTimeToken(null)}
              type="button"
            >
              I copied it
            </button>
          </div>
        ) : null}
        <div className="mt-3 space-y-2">
          {grants.map((item) => (
            <div
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] p-3 text-sm"
              key={item.id}
            >
              <span>
                {item.name} · {item.status}
              </span>
              <button
                className="font-bold text-red-700"
                onClick={() => void revoke(item.id)}
                type="button"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="m-0 text-sm font-bold">Your activity</h3>
        {analytics ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[var(--muted)]">Impressions</dt>
              <dd className="m-0 font-bold">{analytics.impressions}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Applications</dt>
              <dd className="m-0 font-bold">{analytics.applications}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">OA progressions</dt>
              <dd className="m-0 font-bold">{analytics.oaProgressions}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Interview progressions</dt>
              <dd className="m-0 font-bold">{analytics.interviewProgressions}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-[var(--muted)]">Loading your persisted activity totals…</p>
        )}
        <div className="mt-6 border-t border-[var(--line)] pt-4">
          <h3 className="m-0 text-sm font-bold">Privacy and account</h3>
          <p className="text-sm text-[var(--muted)]">
            Exports contain your private records. Account deletion revokes local private access and
            cancels private work.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold"
              onClick={() => void exportData()}
              type="button"
            >
              Export my data
            </button>
            <button
              className="rounded-lg px-3 py-2 text-sm font-bold text-red-700"
              onClick={() => void deleteAccount()}
              type="button"
            >
              Delete account
            </button>
          </div>
        </div>
      </section>
      {message ? (
        <p aria-live="polite" className="text-sm text-[var(--muted)] lg:col-span-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
