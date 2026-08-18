import { NextResponse } from "next/server";

import { listSchools } from "@recruitintel/db";
import { schoolListQuerySchema, schoolSummarySchema } from "@recruitintel/types";

import { databaseApiError, validationError } from "@/lib/api";

export async function GET(request: Request) {
  const parsed = schoolListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);
  try {
    const result = await listSchools(parsed.data);
    return NextResponse.json({
      data: result.items.map((item) => schoolSummarySchema.parse(item)),
      meta: { total: result.total, limit: parsed.data.limit, offset: parsed.data.offset },
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
