import type { Metadata } from "next";

import { AppSidebar } from "@/components/app-sidebar";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RecruitIntel", template: "%s · RecruitIntel" },
  description: "Provenance-first recruiting intelligence for students and new graduates.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="page-grid">
          <AppSidebar />
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
