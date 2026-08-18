import { NextResponse } from "next/server";

import {
  createManualRecruiter,
  getCompany,
  getSchool,
  listCompanyRecruiters,
} from "@recruitintel/db";
import {
  createRecruiterRequestSchema,
  recruiterListQuerySchema,
  recruiterSummarySchema,
} from "@recruitintel/types";

import { apiError, databaseApiError, validationError } from "@/lib/api";
import { requireAdmin } from "@/lib/admin";
import { isCompanyIdentifier } from "@/lib/identifiers";

type Context = { params: Promise<{ identifier: string }> };

export async function GET(request: Request, { params }: Context) {
  const { identifier } = await params;
  if (!isCompanyIdentifier(identifier)) {
    return apiError(400, "INVALID_IDENTIFIER", "Company identifier is invalid");
  }
  const parsed = recruiterListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);
  try {
    const company = await getCompany(identifier);
    if (!company) return apiError(404, "NOT_FOUND", "Company was not found");
    const school = parsed.data.school ? await getSchool(parsed.data.school) : null;
    if (parsed.data.school && !school) {
      return apiError(404, "SCHOOL_NOT_FOUND", "School filter was not found");
    }
    const result = await listCompanyRecruiters(company.id, {
      category: parsed.data.category,
      roleFamily: parsed.data.roleFamily,
      schoolId: school?.id,
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

export async function POST(request: Request, { params }: Context) {
  const unauthorized = requireAdmin(request);
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
  const parsed = createRecruiterRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const company = await getCompany(identifier);
    if (!company) return apiError(404, "NOT_FOUND", "Company was not found");
    const recruiter = await createManualRecruiter(company.id, parsed.data);
    return NextResponse.json({ data: recruiter }, { status: 201 });
  } catch (error) {
    return databaseApiError(error);
  }
}
