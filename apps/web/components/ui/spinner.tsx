import clsx from "clsx";
import { LoaderCircle } from "lucide-react";

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      aria-live="polite"
      className={clsx("flex items-center gap-2 text-sm", className ?? "text-[var(--muted)]")}
      role="status"
    >
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}
