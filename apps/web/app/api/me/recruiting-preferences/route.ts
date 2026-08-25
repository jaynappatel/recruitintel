import { NextResponse } from "next/server";

import { getRecruitingPreferences, updateRecruitingPreferences } from "@recruitintel/db";
import { recruitingPreferencesPatchSchema, recruitingPreferencesSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({
      data: recruitingPreferencesSchema.parse(await getRecruitingPreferences(actor.user.id)),
    });
  } catch (error) {
    return personalizationApiError(error);
  }
}

export async function PATCH(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = recruitingPreferencesPatchSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    return NextResponse.json({
      data: recruitingPreferencesSchema.parse(
        await updateRecruitingPreferences(actor.user.id, input.data),
      ),
    });
  } catch (error) {
    return personalizationApiError(error);
  }
}
