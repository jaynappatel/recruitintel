import clsx from "clsx";
import { FlaskConical, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export type NoticeTone = "info" | "warning" | "error";

const toneStyles: Record<NoticeTone, { border: string; bg: string; text: string; icon: string }> = {
  info: {
    border: "border-[var(--line)]",
    bg: "bg-[var(--surface-soft)]",
    text: "text-[var(--ink)]",
    icon: "text-[var(--muted)]",
  },
  warning: {
    border: "border-[var(--warning-border)]",
    bg: "bg-[var(--warning-bg)]",
    text: "text-[var(--ink)]",
    icon: "text-[var(--warning)]",
  },
  error: {
    border: "border-[var(--danger-border)]",
    bg: "bg-[var(--danger-bg)]",
    text: "text-[var(--ink)]",
    icon: "text-[var(--danger)]",
  },
};

const toneIcon: Record<NoticeTone, typeof TriangleAlert> = {
  info: FlaskConical,
  warning: TriangleAlert,
  error: TriangleAlert,
};

export function NoticeBanner({
  tone = "info",
  title,
  children,
  compact = false,
  icon,
  action,
  className,
}: {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  compact?: boolean;
  icon?: typeof TriangleAlert;
  action?: ReactNode;
  className?: string;
}) {
  const styles = toneStyles[tone];
  const Icon = icon ?? toneIcon[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={clsx(
        "flex gap-3 border",
        styles.border,
        styles.bg,
        styles.text,
        compact ? "rounded-[var(--radius-sm)] px-4 py-3 text-sm" : "surface p-6",
        className,
      )}
    >
      <Icon aria-hidden="true" className={clsx("mt-0.5 size-5 shrink-0", styles.icon)} />
      <div className="min-w-0">
        {title ? <h2 className="m-0 text-base font-bold">{title}</h2> : null}
        <div className={clsx("leading-6", title ? "mt-1 text-sm opacity-80" : "text-sm")}>
          {children}
        </div>
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}
