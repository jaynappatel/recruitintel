import { NextResponse } from "next/server";

import { getCompany, getCompanyInterviewQuestionAnalytics } from "@recruitintel/db";
import {
  interviewQuestionAnalyticsQuerySchema,
  interviewQuestionAnalyticsSchema,
} from "@recruitintel/types";

import { apiError, databaseApiError, validationError } from "@/lib/api";
import { isCompanyIdentifier } from "@/lib/identifiers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params;
  if (!isCompanyIdentifier(identifier)) {
    return apiError(400, "INVALID_IDENTIFIER", "Company identifier is invalid");
  }
  const url = new URL(request.url);
  const query = interviewQuestionAnalyticsQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!query.success) return validationError(query.error);
  try {
    const company = await getCompany(identifier);
    if (!company) return apiError(404, "NOT_FOUND", "Company was not found");
    const analytics = await getCompanyInterviewQuestionAnalytics(company.id, query.data);
    return NextResponse.json({
      data: interviewQuestionAnalyticsSchema.parse(analytics),
      meta: { limit: query.data.limit, offset: query.data.offset, sort: query.data.sort },
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
