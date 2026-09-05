"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { CharacterWidget } from "@/components/character/character-widget";

const UNAUTHENTICATED_ROUTES = ["/sign-in"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (UNAUTHENTICATED_ROUTES.includes(pathname)) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="page-grid">
      <AppSidebar />
      <main className="app-main">{children}</main>
      <CharacterWidget />
    </div>
  );
}
