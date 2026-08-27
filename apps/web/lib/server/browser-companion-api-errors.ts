import {
  BrowserCompanionConflictError,
  BrowserCompanionNotFoundError,
  BrowserCompanionPolicyError,
  BrowserCompanionValidationError,
} from "@recruitintel/db";

import { apiError, databaseApiError } from "@/lib/api";

export function browserCompanionApiError(error: unknown) {
  if (error instanceof BrowserCompanionNotFoundError)
    return apiError(404, "NOT_FOUND", error.message);
  if (error instanceof BrowserCompanionConflictError)
    return apiError(409, "CONFLICT", error.message);
  if (error instanceof BrowserCompanionPolicyError)
    return apiError(409, "SOURCE_POLICY_REVIEW_REQUIRED", error.message);
  if (error instanceof BrowserCompanionValidationError)
    return apiError(400, "INVALID_REQUEST", error.message);
  return databaseApiError(error);
}
