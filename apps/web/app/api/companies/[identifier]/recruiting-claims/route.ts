import { NextResponse } from "next/server";

import { getCompany, listPublicRecruitingClaims } from "@recruitintel/db";
import { listQuerySchema, publicRecruitingClaimSchema } from "@recruitintel/types";

import { apiError, databaseApiError, validationError } from "@/lib/api";
import { isCompanyIdentifier } from "@/lib/identifiers";

type Context = { params: Promise<{ identifier: string }> };

export async function GET(request: Request, { params }: Context) {
  const { identifier } = await params;
  if (!isCompanyIdentifier(identifier)) {
    return apiError(400, "INVALID_IDENTIFIER", "Company identifier is invalid");
  }
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const company = await getCompany(identifier);
    if (!company) return apiError(404, "NOT_FOUND", "Company was not found");
    const page = await listPublicRecruitingClaims(company.id, parsed.data);
    return NextResponse.json({
      data: page.items.map((item) => publicRecruitingClaimSchema.parse(item)),
      meta: { total: page.total, limit: parsed.data.limit, offset: parsed.data.offset },
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
