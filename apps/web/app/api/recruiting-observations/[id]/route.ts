import { NextResponse } from "next/server";

import { getPublicRecruitingObservation } from "@recruitintel/db";
import { databaseUuidSchema, publicRecruitingObservationSchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Observation identifier is invalid");
  }
  try {
    const observation = await getPublicRecruitingObservation(id);
    if (!observation) return apiError(404, "NOT_FOUND", "Recruiting observation was not found");
    return NextResponse.json({ data: publicRecruitingObservationSchema.parse(observation) });
  } catch (error) {
    return databaseApiError(error);
  }
}
