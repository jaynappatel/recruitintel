import { NextResponse } from "next/server";
import { exportUserAccount } from "@recruitintel/db";
import { apiError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({ data: await exportUserAccount(actor.user.id) });
  } catch (error) {
    if (error instanceof Error && error.message === "User not found")
      return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
