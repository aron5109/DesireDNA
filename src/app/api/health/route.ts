import { NextResponse } from "next/server";

import { configurationReport } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Setup check for whoever is deploying this app.
 *
 * Reports which server environment variables are still missing or unusable so
 * a broken deployment can be diagnosed without reading platform logs. It
 * returns variable *names and reasons only* — never a value, and it never
 * touches the database or any profile.
 */
export function GET() {
  const report = configurationReport();

  return NextResponse.json(
    {
      status: report.ok ? "ok" : "misconfigured",
      missing: report.missing,
      invalid: report.invalid,
      hint: report.ok
        ? undefined
        : "Set these in your hosting provider's environment variables, then redeploy — existing deployments do not pick up new values. See README.md for how to generate each secret.",
    },
    { status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
