import { NextResponse } from "next/server";

import {
  completeGoogleCalendarAuthorization,
  consumeGoogleCalendarAuthorizationFailure,
  GoogleOAuthError,
} from "@/lib/server/google-calendar-oauth";

function redirectTarget(returnTo: string, status: "connected" | "error", code?: string) {
  const configured = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/";
  const target = new URL(returnTo, configured);
  target.searchParams.set("googleCalendar", status);
  if (code) target.searchParams.set("code", code);
  return target;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const state = query.get("state");
  if (!state) {
    return NextResponse.redirect(redirectTarget("/settings", "error", "INVALID_OAUTH_STATE"));
  }
  try {
    const providerError = query.get("error");
    if (providerError) {
      const returnTo = await consumeGoogleCalendarAuthorizationFailure(state);
      return NextResponse.redirect(
        redirectTarget(
          returnTo,
          "error",
          providerError === "access_denied" ? "ACCESS_DENIED" : "GOOGLE_OAUTH_ERROR",
        ),
      );
    }
    const code = query.get("code");
    if (!code)
      throw new GoogleOAuthError("MISSING_AUTHORIZATION_CODE", "Authorization code is missing");
    const result = await completeGoogleCalendarAuthorization({ code, state });
    return NextResponse.redirect(redirectTarget(result.returnTo, "connected"));
  } catch (error) {
    const code = error instanceof GoogleOAuthError ? error.code : "GOOGLE_CALLBACK_FAILED";
    return NextResponse.redirect(redirectTarget("/settings", "error", code));
  }
}
