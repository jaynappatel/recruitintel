import { NextResponse } from "next/server";

import { getOperationalDiagnostics } from "@recruitintel/db";
import { productionConfigurationIssues } from "@/lib/server/runtime-config";

export const dynamic = "force-dynamic";

/** Readiness proves schema availability without publishing deployment internals. */
export async function GET() {
  try {
    const configurationIssues = productionConfigurationIssues();
    if (configurationIssues.length)
      return NextResponse.json({ status: "not_ready", configuration: "invalid" }, { status: 503 });
    const diagnostics = await getOperationalDiagnostics();
    return NextResponse.json({ status: "ready", migrationCount: diagnostics.migrationCount });
  } catch {
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
