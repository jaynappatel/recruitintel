import { NextResponse } from "next/server";

import { createApplicationPlan, listApplicationPlans } from "@recruitintel/db";
import {
  applicationPlanQuerySchema,
  applicationPlanSchema,
  createApplicationPlanRequestSchema,
} from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const query = applicationPlanQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!query.success) return validationError(query.error);
  try {
    const plans = await listApplicationPlans(actor.user.id, query.data);
    return NextResponse.json({
      data: plans.map((plan) => applicationPlanSchema.parse(plan)),
      meta: { total: plans.length },
    });
  } catch (error) {
    return calendarApiError(error);
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
  const input = createApplicationPlanRequestSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    const plan = await createApplicationPlan(actor.user.id, input.data);
    return NextResponse.json({ data: applicationPlanSchema.parse(plan) }, { status: 201 });
  } catch (error) {
    return calendarApiError(error);
  }
}
