import { NextResponse } from "next/server";

import { getCompany } from "@recruitintel/db";
import { companySchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";
import { isCompanyIdentifier } from "@/lib/identifiers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params;
  if (!isCompanyIdentifier(identifier)) {
    return apiError(400, "INVALID_IDENTIFIER", "Company identifier is invalid");
  }
  try {
    const company = await getCompany(identifier);
    if (!company) return apiError(404, "NOT_FOUND", "Company was not found");
    return NextResponse.json({ data: companySchema.parse(company) });
  } catch (error) {
    return databaseApiError(error);
  }
}
