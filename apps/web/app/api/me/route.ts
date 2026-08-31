import { NextResponse } from "next/server";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  return NextResponse.json({
    data: {
      id: actor.user.id,
      name: actor.user.name,
      email: actor.user.email,
      isAdmin: actor.user.isAdmin,
    },
  });
}
