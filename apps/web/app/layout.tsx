import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";

import { AppShell } from "@/components/app-shell";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "RecruitIntel", template: "%s · RecruitIntel" },
  description: "Provenance-first recruiting intelligence for students and new graduates.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
