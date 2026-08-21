import { NextResponse } from "next/server";

import { addManualRecruiterEvidence, getRecruiter, listRecruiterEvidence } from "@recruitintel/db";
import {
  createRecruiterEvidenceRequestSchema,
  listQuerySchema,
  recruiterDetailSchema,
  recruiterEvidenceSchema,
} from "@recruitintel/types";

import { apiError, databaseApiError, validationError } from "@/lib/api";
import { requireAdmin } from "@/lib/admin";
import { isDatabaseUuid } from "@/lib/identifiers";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isDatabaseUuid(id)) return apiError(400, "INVALID_IDENTIFIER", "Recruiter id is invalid");
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const recruiter = await getRecruiter(id);
    if (!recruiter) return apiError(404, "NOT_FOUND", "Recruiter was not found");
    const result = await listRecruiterEvidence(id, parsed.data);
    return NextResponse.json({
      data: result.items.map((item) => recruiterEvidenceSchema.parse(item)),
      meta: { total: result.total, limit: parsed.data.limit, offset: parsed.data.offset },
    });
  } catch (error) {
    return databaseApiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { id } = await params;
  if (!isDatabaseUuid(id)) return apiError(400, "INVALID_IDENTIFIER", "Recruiter id is invalid");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const parsed = createRecruiterEvidenceRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const recruiter = await addManualRecruiterEvidence(id, parsed.data);
    if (!recruiter) return apiError(404, "NOT_FOUND", "Recruiter was not found");
    return NextResponse.json({ data: recruiterDetailSchema.parse(recruiter) }, { status: 201 });
  } catch (error) {
    return databaseApiError(error);
  }
}
