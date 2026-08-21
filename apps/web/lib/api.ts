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
  return apiError(503, "DATABASE_UNAVAILABLE", "RecruitIntel data is temporarily unavailable");
}
