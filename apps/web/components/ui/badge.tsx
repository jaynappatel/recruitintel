import clsx from "clsx";
import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "accent";

const tones: Record<BadgeTone, string> = {
  neutral: "border-[var(--line)] bg-[var(--surface-soft)] text-[var(--ink)]",
  success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
  accent: "border-[var(--tint-sky-line)] bg-[var(--tint-sky)] text-[var(--accent)]",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-extrabold tracking-wide uppercase",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
