"use client";

import clsx from "clsx";
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Send,
  Bell,
  Bookmark,
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  LayoutDashboard,
  LogIn,
  LogOut,
  Radar,
  FileText,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/today", label: "Today", icon: CheckCircle2 },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/opportunities", label: "Recommendations", icon: Sparkles },
  { href: "/applications", label: "Applications", icon: ClipboardList },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/resumes", label: "Resumes", icon: FileText },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/events", label: "Event stream", icon: Activity },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/sign-in", label: "Sign in", icon: LogIn },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <aside className="app-sidebar">
      <div className="flex items-center gap-3 px-2">
        <div className="grid size-10 place-items-center rounded-[var(--radius-sm)] border-[1.5px] border-white bg-[var(--accent)] text-white">
          <Radar aria-hidden="true" className="size-5" strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-lg leading-none font-extrabold tracking-tight">RecruitIntel</div>
          <div className="mt-1 text-[0.65rem] font-bold tracking-[0.16em] text-white/50 uppercase">
            Signal desk
          </div>
        </div>
      </div>

      <nav aria-label="Primary navigation" className="mt-8 flex gap-2 overflow-x-auto md:flex-col">
        {navigation
          .filter(({ href }) => href !== "/sign-in")
          .map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
          return (
            <Link
              className={clsx(
                "flex shrink-0 items-center gap-3 rounded-[var(--radius-sm)] border-[1.5px] border-transparent px-3.5 py-2.5 text-sm font-semibold transition-all",
                active
                  ? "border-white bg-[var(--accent)] text-white"
                  : "text-white/65 hover:bg-white/8 hover:text-white",
              )}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          );
          })}
        {session ? (
          <button
            className="flex shrink-0 items-center gap-3 rounded-[var(--radius-sm)] border-[1.5px] border-transparent px-3.5 py-2.5 text-sm font-semibold text-white/65 transition-all hover:bg-white/8 hover:text-white md:text-left"
            onClick={() => void signOut()}
            type="button"
          >
            <LogOut aria-hidden="true" className="size-4" />
            Sign out
          </button>
        ) : (
          <Link
            className={clsx(
              "flex shrink-0 items-center gap-3 rounded-[var(--radius-sm)] border-[1.5px] border-transparent px-3.5 py-2.5 text-sm font-semibold transition-all",
              pathname === "/sign-in"
                ? "border-white bg-[var(--accent)] text-white"
                : "text-white/65 hover:bg-white/8 hover:text-white",
            )}
            href="/sign-in"
          >
            <LogIn aria-hidden="true" className="size-4" />
            Sign in
          </Link>
        )}
      </nav>

      <div className="desktop-sidebar-copy mt-auto rounded-[var(--radius-sm)] border-[1.5px] border-white/15 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wide text-[var(--accent-bright)] uppercase">
          <span aria-hidden="true" className="size-2 rounded-full bg-[var(--accent-bright)]" />
          Provenance on
        </div>
        <p className="m-0 text-xs leading-5 text-white/55">
          Every signal here links back to where it came from and when it changed.
        </p>
      </div>
    </aside>
  );
}
