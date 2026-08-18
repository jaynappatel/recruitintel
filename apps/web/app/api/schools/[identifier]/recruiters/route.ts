import { NextResponse } from "next/server";

import { getSchool, listSchoolRecruiters } from "@recruitintel/db";
import { recruiterListQuerySchema, recruiterSummarySchema } from "@recruitintel/types";

import { apiError, databaseApiError, validationError } from "@/lib/api";
import { isSchoolIdentifier } from "@/lib/identifiers";

type Context = { params: Promise<{ identifier: string }> };

export async function GET(request: Request, { params }: Context) {
  const { identifier } = await params;
  if (!isSchoolIdentifier(identifier)) {
    return apiError(400, "INVALID_IDENTIFIER", "School identifier is invalid");
  }
  const parsed = recruiterListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);
  try {
    const school = await getSchool(identifier);
    if (!school) return apiError(404, "NOT_FOUND", "School was not found");
    const result = await listSchoolRecruiters(school.id, {
      includeStale: parsed.data.includeStale,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return NextResponse.json({
      data: result.items.map((item) => recruiterSummarySchema.parse(item)),
      meta: { total: result.total, limit: parsed.data.limit, offset: parsed.data.offset },
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
