import { NextResponse } from "next/server";

import { getSchool } from "@recruitintel/db";
import { schoolSummarySchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";
import { isSchoolIdentifier } from "@/lib/identifiers";

type Context = { params: Promise<{ identifier: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { identifier } = await params;
  if (!isSchoolIdentifier(identifier)) {
    return apiError(400, "INVALID_IDENTIFIER", "School identifier is invalid");
  }
  try {
    const school = await getSchool(identifier);
    if (!school) return apiError(404, "NOT_FOUND", "School was not found");
    return NextResponse.json({ data: schoolSummarySchema.parse(school) });
  } catch (error) {
    return databaseApiError(error);
  }
}
