import { NextResponse } from "next/server";

import { listApplications, listDailyWorkflow, listOpportunityRecommendations } from "@recruitintel/db";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    const [recommendations, applications, workflow] = await Promise.all([
      listOpportunityRecommendations(actor.user.id, {
        limit: 50,
        includeLowPriority: true,
        includeIneligible: false,
      }),
      listApplications(actor.user.id, { limit: 100 }),
      listDailyWorkflow(actor.user.id),
    ]);

    const weekAgo = Date.now() - WEEK_MS;
    const appliedThisWeek = applications.items.filter((application) => {
      const stamp = application.appliedAt ?? application.createdAt;
      return stamp ? new Date(stamp).getTime() >= weekAgo : false;
    }).length;

    const dueToday = workflow.filter(
      (item) => item.urgency === "TODAY" || item.urgency === "OVERDUE",
    ).length;

    return NextResponse.json({
      data: {
        newMatches: recommendations.items.length,
        appliedThisWeek,
        dueToday,
      },
    });
  } catch (error) {
    return personalizationApiError(error);
  }
}
