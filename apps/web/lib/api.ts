import { NextResponse } from "next/server";
import { redactText } from "@recruitintel/shared";
import type { ZodError } from "zod";

import { logger } from "./server/logger";

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message: redactText(message) } }, { status });
}

export function validationError(error: ZodError) {
  const first = error.issues[0];
  return apiError(400, "INVALID_REQUEST", first?.message ?? "Request validation failed");
}

export function databaseApiError(error: unknown) {
  logger.error("database_request_failed", error);
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
  const message = error instanceof Error ? error.message : "";
  if (code === "42501") return apiError(403, "FORBIDDEN", "This operation is not permitted");
  if (code === "P0001" && message === "SOURCE_POLICY_NOT_EXECUTABLE") {
    return apiError(409, "SOURCE_POLICY_REVIEW_REQUIRED", "Source policy does not allow execution");
  }
  return apiError(503, "DATABASE_UNAVAILABLE", "RecruitIntel data is temporarily unavailable");
}
