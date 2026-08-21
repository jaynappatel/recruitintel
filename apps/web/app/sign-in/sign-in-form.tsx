"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";

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
      setError(
        "Sign-in could not be started. Check the authentication configuration and try again.",
      );
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-medium text-primary">RecruitIntel</p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">Sign in to your workspace</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your calendar, plans, preferences, and connected accounts stay private to your user.
        </p>
        <button
          className="mt-7 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          disabled={pending}
          onClick={signIn}
          type="button"
        >
          {pending ? "Connecting…" : "Continue with Google"}
        </button>
        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
