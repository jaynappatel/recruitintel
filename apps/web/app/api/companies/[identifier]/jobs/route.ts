import { NextResponse } from "next/server";

import { getCompany, listJobs } from "@recruitintel/db";
import { jobSchema, listQuerySchema } from "@recruitintel/types";

import { apiError, databaseApiError, validationError } from "@/lib/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params;
  const url = new URL(request.url);
  const query = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) return validationError(query.error);
  try {
    const company = await getCompany(identifier);
    if (!company) return apiError(404, "NOT_FOUND", "Company was not found");
    const page = await listJobs({ companyId: company.id, ...query.data });
    return NextResponse.json({
      data: page.items.map((job) => jobSchema.parse(job)),
      meta: { total: page.total, ...query.data },
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
