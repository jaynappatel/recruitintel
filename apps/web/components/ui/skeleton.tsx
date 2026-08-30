import clsx from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx("surface animate-pulse bg-[var(--surface-soft)]", className)}
    />
  );
}
