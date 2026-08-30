import { DatabaseZap } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface grid min-h-56 place-items-center p-8 text-center">
      <div>
        <DatabaseZap aria-hidden="true" className="mx-auto mb-3 size-7 text-[var(--accent)]" />
        <h2 className="m-0 font-serif text-xl">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{copy}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}
