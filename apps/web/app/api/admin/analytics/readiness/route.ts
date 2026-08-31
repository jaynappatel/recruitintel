import { NextResponse } from "next/server";
import { getDataReadiness } from "@recruitintel/db";
import { dataReadinessSchema, dataReadinessTaskSchema } from "@recruitintel/types";
import { apiError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  if (!actor.user.isAdmin) return apiError(403, "FORBIDDEN", "Admin access is required");
  const task = dataReadinessTaskSchema.safeParse(
    new URL(request.url).searchParams.get("taskType") ?? "PERSONALIZED_RANKING",
  );
  if (!task.success) return apiError(400, "VALIDATION_ERROR", "taskType is invalid");
  try {
    return NextResponse.json({
      data: dataReadinessSchema.parse(await getDataReadiness(task.data)),
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
