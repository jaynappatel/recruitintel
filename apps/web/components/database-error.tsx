import { TriangleAlert } from "lucide-react";

export function DatabaseError({ message }: { message?: string }) {
  return (
    <div className="surface border-amber-200 bg-amber-50/80 p-6">
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div>
          <h2 className="m-0 text-base font-bold text-amber-950">Local database is not ready</h2>
          <p className="mt-1 mb-0 text-sm leading-6 text-amber-900/75">
            Start PostgreSQL, run the migration and seed commands, then refresh this page.
            {message ? ` (${message})` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
