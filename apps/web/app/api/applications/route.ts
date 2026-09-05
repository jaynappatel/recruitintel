import { NextResponse } from "next/server";
import {
  createApplication,
  importManualApplication,
  listApplications,
  ApplicationConflictError,
  ApplicationValidationError,
  ApplicationNotFoundError,
} from "@recruitintel/db";
import {
  applicationStatusSchema,
  createApplicationRequestSchema,
  importApplicationRequestSchema,
} from "@recruitintel/types";
import { apiError, validationError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  if (status && !applicationStatusSchema.safeParse(status).success)
    return apiError(400, "INVALID_REQUEST", "Invalid application status");
  try {
    return NextResponse.json({
      data: await listApplications(actor.user.id, {
        limit: Number(params.get("limit") ?? 25),
        status: status ?? undefined,
        companyId: params.get("company") ?? undefined,
        includeArchived: params.get("includeArchived") === "true",
      }),
    });
  } catch (error) {
    return databaseApiError(error);
  }
}

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = createApplicationRequestSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    return NextResponse.json(
      { data: await createApplication(actor.user.id, input.data) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApplicationConflictError) return apiError(409, "CONFLICT", error.message);
    if (error instanceof ApplicationValidationError || error instanceof ApplicationNotFoundError)
      return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}

export async function PUT(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = importApplicationRequestSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    return NextResponse.json(
      { data: await importManualApplication(actor.user.id, input.data) },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof ApplicationConflictError ||
      error instanceof ApplicationValidationError ||
      error instanceof ApplicationNotFoundError
    )
      return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}
