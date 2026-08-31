import { NextResponse } from "next/server";
import {
  deleteOutreachContact,
  updateOutreachContact,
  OutreachNotFoundError,
  OutreachValidationError,
} from "@recruitintel/db";
import { outreachContactUpdateSchema } from "@recruitintel/types";
import { apiError, databaseApiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const parsed = outreachContactUpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json({
      data: await updateOutreachContact(actor.user.id, (await params).id, parsed.data),
    });
  } catch (error) {
    if (error instanceof OutreachNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    if (error instanceof OutreachValidationError)
      return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    await deleteOutreachContact(actor.user.id, (await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof OutreachNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
