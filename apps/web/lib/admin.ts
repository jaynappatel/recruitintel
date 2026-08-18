import { timingSafeEqual } from "node:crypto";

import { apiError } from "@/lib/api";

export function requireAdmin(request: Request) {
  const expected = process.env.RECRUITINTEL_ADMIN_TOKEN;
  if (!expected) {
    return apiError(503, "ADMIN_NOT_CONFIGURED", "Administrative API access is not configured");
  }
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    return apiError(401, "UNAUTHORIZED", "A valid administrative bearer token is required");
  }
  return null;
}
