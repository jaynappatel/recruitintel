import { NextResponse } from "next/server";

import { listCompanies } from "@recruitintel/db";
import { companySchema, listQuerySchema } from "@recruitintel/types";

import { databaseApiError, validationError } from "@/lib/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const page = await listCompanies(parsed.data.limit, parsed.data.offset);
    const data = page.items.map((company) => companySchema.parse(company));
    return NextResponse.json({ data, meta: { total: page.total, ...parsed.data } });
  } catch (error) {
    return databaseApiError(error);
  }
}
