import { NextResponse } from "next/server";

import { getOpportunity, listOpportunitySources } from "@recruitintel/db";
import { databaseUuidSchema, opportunitySourcePostingSchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Opportunity id is invalid");
  }
  try {
    if (!(await getOpportunity(id))) {
      return apiError(404, "NOT_FOUND", "Opportunity was not found");
    }
    const sources = await listOpportunitySources(id);
    return NextResponse.json({
      data: sources.map((item) => opportunitySourcePostingSchema.parse(item)),
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
