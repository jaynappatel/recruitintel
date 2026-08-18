import { NextResponse } from "next/server";

import { listJobs } from "@recruitintel/db";
import { jobSchema, jobsQuerySchema } from "@recruitintel/types";

import { databaseApiError, validationError } from "@/lib/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = jobsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const page = await listJobs(parsed.data);
    return NextResponse.json({
      data: page.items.map((job) => jobSchema.parse(job)),
      meta: { total: page.total, limit: parsed.data.limit, offset: parsed.data.offset },
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
