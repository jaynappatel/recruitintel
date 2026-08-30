"use client";

import { Radar } from "lucide-react";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function SignInForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/dashboard",
    });
    if (result.error) {
      setError("We couldn't start sign-in. Please try again in a moment.");
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="surface w-full max-w-md p-8">
        <div className="grid size-10 place-items-center rounded-xl bg-[var(--accent)] text-white">
          <Radar aria-hidden="true" className="size-5" strokeWidth={2.5} />
        </div>
        <h1 className="mt-5 font-serif text-3xl font-semibold tracking-[-0.02em]">
          Sign in to RecruitIntel
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Your calendar, plans, preferences, and connected accounts stay private to your account.
        </p>
        <Button className="mt-7 w-full" disabled={pending} onClick={signIn}>
          {pending ? (
            <Spinner className="text-white" label="Connecting…" />
          ) : (
            "Continue with Google"
          )}
        </Button>
        {error ? (
          <p aria-live="polite" className="mt-4 text-sm font-medium text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
