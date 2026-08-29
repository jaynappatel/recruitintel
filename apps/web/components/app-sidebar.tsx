"use client";

import clsx from "clsx";
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Bell,
  Bookmark,
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  LayoutDashboard,
  Radar,
  FileText,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/today", label: "Today", icon: CheckCircle2 },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/opportunities", label: "Recommendations", icon: Sparkles },
  { href: "/applications", label: "Applications", icon: ClipboardList },
  { href: "/resumes", label: "Resumes", icon: FileText },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/events", label: "Event stream", icon: Activity },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="app-sidebar">
      <div className="flex items-center gap-3 px-2">
        <div className="grid size-10 place-items-center rounded-xl bg-[var(--mint)] text-[var(--forest)]">
          <Radar aria-hidden="true" className="size-5" strokeWidth={2.5} />
        </div>
        <div>
          <div className="font-serif text-xl leading-none font-semibold">RecruitIntel</div>
          <div className="mt-1 text-[0.65rem] font-bold tracking-[0.16em] text-white/55 uppercase">
            Signal desk
          </div>
        </div>
      </div>

      <nav aria-label="Primary navigation" className="mt-10 flex gap-2 overflow-x-auto md:flex-col">
        {navigation.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
          return (
            <Link
              className={clsx(
                "flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                active
                  ? "bg-white text-[var(--forest)] shadow-sm"
                  : "text-white/70 hover:bg-white/8 hover:text-white",
              )}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="desktop-sidebar-copy mt-auto rounded-2xl border border-white/10 bg-white/6 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wide text-[var(--mint)] uppercase">
          <span className="size-2 rounded-full bg-[var(--mint)]" />
          Provenance on
        </div>
        <p className="m-0 text-xs leading-5 text-white/60">
          Every signal shown here links back to a source, collection run, and immutable event.
        </p>
      </div>
    </aside>
  );
}
