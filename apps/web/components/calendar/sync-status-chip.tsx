import Link from "next/link";

import type { CalendarProviderDisplayStatus } from "@/lib/types/calendar";

const copy: Record<CalendarProviderDisplayStatus, { label: string; dot: string }> = {
  DISCONNECTED: { label: "Google Calendar not connected", dot: "bg-[var(--muted)]" },
  CONNECTING: { label: "Connecting Google Calendar…", dot: "bg-[var(--accent)] animate-pulse" },
  CONNECTED: { label: "Google Calendar connected", dot: "bg-[var(--success)]" },
  SYNCING: { label: "Syncing Google Calendar…", dot: "bg-[var(--accent)] animate-pulse" },
  REAUTH_REQUIRED: { label: "Reconnect Google Calendar", dot: "bg-amber-600" },
  ERROR: { label: "Google Calendar sync error", dot: "bg-[var(--danger)]" },
};

export function SyncStatusChip({ status }: { status: CalendarProviderDisplayStatus }) {
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
