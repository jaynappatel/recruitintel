import Link from "next/link";

import type { CalendarProviderStatus } from "@/lib/types/calendar";

const copy: Record<CalendarProviderStatus, { label: string; dot: string }> = {
  NOT_CONNECTED: { label: "Google Calendar not connected", dot: "bg-[var(--muted)]" },
  CONNECTING: { label: "Connecting Google Calendar…", dot: "bg-[var(--accent)] animate-pulse" },
  CONNECTED: { label: "Google Calendar connected", dot: "bg-emerald-600" },
  SYNCING: { label: "Syncing Google Calendar…", dot: "bg-[var(--accent)] animate-pulse" },
  SYNC_ERROR: { label: "Google Calendar sync error", dot: "bg-red-600" },
};

export function SyncStatusChip({ status }: { status: CalendarProviderStatus }) {
  const { label, dot } = copy[status];
  return (
    <Link
      className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold text-[var(--ink)] shadow-sm transition hover:border-[var(--accent)]"
      href="/settings#integrations"
    >
      <span className={`size-2 rounded-full ${dot}`} />
      {label}
    </Link>
  );
}
