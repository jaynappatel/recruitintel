import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <div className="eyebrow mb-2">{eyebrow}</div>
        <h1 className="m-0 font-serif text-4xl leading-tight font-semibold tracking-[-0.035em] md:text-5xl">
          {title}
        </h1>
        <p className="mt-3 mb-0 max-w-2xl text-sm leading-6 text-[var(--muted)] md:text-base">
          {description}
        </p>
      </div>
      {action}
    </header>
  );
}
