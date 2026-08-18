import { DatabaseZap } from "lucide-react";

export function EmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="surface grid min-h-56 place-items-center p-8 text-center">
      <div>
        <DatabaseZap className="mx-auto mb-3 size-7 text-[var(--forest-bright)]" />
        <h2 className="m-0 font-serif text-xl">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{copy}</p>
      </div>
    </div>
  );
}
