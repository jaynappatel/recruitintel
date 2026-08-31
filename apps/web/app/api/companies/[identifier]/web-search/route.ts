import { NextResponse } from "next/server";

import { createWebSearchRequests, getCompany } from "@recruitintel/db";
import { publicWebWorkRequestSchema, webSearchRequestSchema } from "@recruitintel/types";

import { requireAdmin } from "@/lib/admin";
import { apiError, databaseApiError, validationError } from "@/lib/api";
import { isCompanyIdentifier } from "@/lib/identifiers";

type Context = { params: Promise<{ identifier: string }> };

export async function POST(request: Request, { params }: Context) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { identifier } = await params;
  if (!isCompanyIdentifier(identifier)) {
    return apiError(400, "INVALID_IDENTIFIER", "Company identifier is invalid");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const parsed = webSearchRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const company = await getCompany(identifier);
    if (!company) return apiError(404, "NOT_FOUND", "Company was not found");
    const result = await createWebSearchRequests(company, parsed.data);
    return NextResponse.json(
      {
        data: {
          requests: result.requests.map((item) => publicWebWorkRequestSchema.parse(item)),
          queriesGenerated: result.queriesGenerated,
          skippedByBudget: result.skippedByBudget,
        },
      },
      { status: 202 },
    );
  } catch (error) {
    return databaseApiError(error);
  }
}
