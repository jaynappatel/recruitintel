import { NextResponse } from "next/server";

import { getCompany, listWebSearchQueries } from "@recruitintel/db";
import { webSearchQuerySchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";
import { isCompanyIdentifier } from "@/lib/identifiers";

type Context = { params: Promise<{ identifier: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { identifier } = await params;
  if (!isCompanyIdentifier(identifier)) {
    return apiError(400, "INVALID_IDENTIFIER", "Company identifier is invalid");
  }
  try {
    const company = await getCompany(identifier);
    if (!company) return apiError(404, "NOT_FOUND", "Company was not found");
    const queries = await listWebSearchQueries(company.id);
    return NextResponse.json({
      data: queries.map((query) => webSearchQuerySchema.parse(query)),
      meta: { total: queries.length },
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
