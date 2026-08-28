import { NextResponse } from "next/server";

import { getOperationalDiagnostics } from "@recruitintel/db";

export const dynamic = "force-dynamic";

/** Load-balancer health endpoint: no credentials, identifiers, or user content. */
export async function GET() {
  try {
    const diagnostics = await getOperationalDiagnostics();
    return NextResponse.json({ status: "ok", database: diagnostics.database });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
