import { NextResponse } from "next/server";

import {
  attachCompanyGitHubRepository,
  getCompany,
  listCompanyGitHubRepositories,
} from "@recruitintel/db";
import {
  attachGithubRepositoryRequestSchema,
  companyGithubRepositorySchema,
} from "@recruitintel/types";

import { apiError, databaseApiError, validationError } from "@/lib/api";
import { requireAdmin } from "@/lib/admin";
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
    const repositories = await listCompanyGitHubRepositories(company.id);
    return NextResponse.json({
      data: repositories.map((repository) => companyGithubRepositorySchema.parse(repository)),
      meta: { total: repositories.length },
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
  const parsed = attachGithubRepositoryRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const company = await getCompany(identifier);
    if (!company) return apiError(404, "NOT_FOUND", "Company was not found");
    const repository = await attachCompanyGitHubRepository(company.id, parsed.data);
    return NextResponse.json(
      { data: companyGithubRepositorySchema.parse(repository) },
      { status: 201 },
    );
  } catch (error) {
    return databaseApiError(error);
  }
}
