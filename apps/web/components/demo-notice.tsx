import { FlaskConical } from "lucide-react";

export function DemoNotice() {
  return (
    <div className="mb-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-amber-700" />
      <p className="m-0 leading-5">
        Seed jobs are synthetic interface examples and are never presented as live openings. Live
        ATS collection writes separate, source-backed records.
      </p>
    </div>
  );
}
