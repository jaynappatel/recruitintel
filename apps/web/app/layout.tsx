import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";

import { AppShell } from "@/components/app-shell";

import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "RecruitIntel", template: "%s · RecruitIntel" },
  description: "Provenance-first recruiting intelligence for students and new graduates.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
