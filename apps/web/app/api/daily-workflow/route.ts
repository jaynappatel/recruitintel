import { NextResponse } from "next/server";

import { listDailyWorkflow } from "@recruitintel/db";
import { dailyWorkflowItemSchema } from "@recruitintel/types";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    const items = await listDailyWorkflow(actor.user.id);
    return NextResponse.json({ data: items.map((item) => dailyWorkflowItemSchema.parse(item)) });
  } catch (error) {
    return personalizationApiError(error);
  }
}
