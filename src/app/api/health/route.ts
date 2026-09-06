import { NextResponse } from "next/server";

import { configurationReport } from "@/lib/server/env";
import { databaseReport } from "@/lib/server/health";
import { logServerError } from "@/lib/server/logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Setup check for whoever is deploying this app.
 *
 * Reports which environment variables are missing or unusable, and whether the
 * database actually has the tables and the limiter function. Names and reasons
 * only — never a value, and never a row.
 */
export async function GET() {
  const configuration = configurationReport();

  if (!configuration.ok) {
    return NextResponse.json(
      {
        status: "misconfigured",
        missing: configuration.missing,
        invalid: configuration.invalid,
        hint: "Set these in your hosting provider's environment variables, then redeploy — existing deployments do not pick up new values.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let database;
  try {
    database = await databaseReport();
  } catch (error) {
    logServerError("health:database", error);
    database = { ok: false, project: "unknown", checks: [{ name: "database", ok: false, problem: "unreachable" }] };
  }

  const failing = database.checks.filter((check) => !check.ok);

  return NextResponse.json(
    {
      status: database.ok ? "ok" : "database_not_ready",
      missing: [],
      invalid: [],
      // Compare this against the project you are running SQL in.
      connectedTo: database.project,
      database: database.checks,
      ...(failing.length
        ? { hint: failing.map((check) => `${check.name} ${check.problem}. ${check.fix ?? ""}`.trim()).join(" ") }
        : {}),
    },
    { status: database.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
