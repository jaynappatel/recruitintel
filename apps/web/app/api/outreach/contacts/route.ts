import { NextResponse } from "next/server";
import {
  createOutreachContact,
  listOutreachContacts,
  OutreachConflictError,
  OutreachValidationError,
} from "@recruitintel/db";
import { outreachContactRequestSchema } from "@recruitintel/types";
import { apiError, databaseApiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({ data: await listOutreachContacts(actor.user.id) });
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
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const parsed = outreachContactRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json(
      { data: await createOutreachContact(actor.user.id, parsed.data) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof OutreachConflictError) return apiError(409, "CONFLICT", error.message);
    if (error instanceof OutreachValidationError)
      return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}
