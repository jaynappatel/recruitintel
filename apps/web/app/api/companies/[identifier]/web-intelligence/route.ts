import { NextResponse } from "next/server";

import { getCompany, getPublicWebIntelligence } from "@recruitintel/db";
import { publicWebIntelligenceSchema } from "@recruitintel/types";

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
    const intelligence = await getPublicWebIntelligence(company.id);
    return NextResponse.json({ data: publicWebIntelligenceSchema.parse(intelligence) });
  } catch (error) {
    return databaseApiError(error);
  }
}
