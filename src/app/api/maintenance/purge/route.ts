import { NextResponse } from "next/server";

import { env } from "@/lib/server/env";
import { logServerError } from "@/lib/server/logging";
import { db } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_RETENTION_DAYS = 31;

/**
 * Scheduled cleanup. Returns counts only — never any profile detail. Vercel
 * Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
async function purge(req: Request) {
  try {
    if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const client = db();
    const now = new Date().toISOString();
    const staleBefore = new Date(Date.now() - RATE_LIMIT_RETENTION_DAYS * 86_400_000).toISOString();

    const profiles = await client.from("quiz_profiles").delete({ count: "exact" }).lt("expires_at", now);
    const events = await client.from("rate_limit_events").delete({ count: "exact" }).lt("created_at", staleBefore);

    if (profiles.error || events.error) {
      logServerError("maintenance:purge", profiles.error ?? events.error);
      return NextResponse.json({ error: "Cleanup failed." }, { status: 500 });
    }

    return NextResponse.json({ profilesDeleted: profiles.count ?? 0, eventsDeleted: events.count ?? 0 });
  } catch (error) {
    logServerError("maintenance:purge", error);
    return NextResponse.json({ error: "Cleanup failed." }, { status: 500 });
  }
}

export const GET = purge;
export const POST = purge;
