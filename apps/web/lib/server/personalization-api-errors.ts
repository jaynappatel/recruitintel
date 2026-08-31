import { PersonalizationConflictError, PersonalizationNotFoundError } from "@recruitintel/db";

import { apiError, databaseApiError } from "../api";

export function personalizationApiError(error: unknown) {
  if (error instanceof PersonalizationNotFoundError) {
    return apiError(404, "NOT_FOUND", error.message);
  }
  if (error instanceof PersonalizationConflictError) {
    return apiError(409, "CONFLICT", error.message);
  }
  return databaseApiError(error);
}
