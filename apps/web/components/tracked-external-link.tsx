"use client";

import type { ReactNode } from "react";

import { recordClientProductEvent } from "@/lib/api/instrumentation";

export function TrackedExternalLink({
  href,
  entityId,
  className,
  children,
}: {
  href: string;
  entityId: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={() => recordClientProductEvent({ eventType: "JOB_VIEWED", entityId })}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
