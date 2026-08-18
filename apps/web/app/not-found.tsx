import Link from "next/link";

export default function NotFound() {
  return (
    <div className="surface grid min-h-[70vh] place-items-center p-8 text-center">
      <div>
        <div className="eyebrow mb-3">404 · No signal</div>
        <h1 className="m-0 font-serif text-4xl font-semibold">That record does not exist.</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          It may have been removed or the address is incorrect.
        </p>
        <Link
          className="mt-5 inline-block rounded-xl bg-[var(--forest)] px-4 py-2 text-sm font-bold text-white"
          href="/dashboard"
        >
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}
