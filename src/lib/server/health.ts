import "server-only";

import { db } from "./supabase";

/**
 * Readiness checks for the pieces the app cannot work without.
 *
 * Environment variables being present is not the same as the database being
 * usable: the tables and the limiter function have to exist too. These checks
 * report which specific piece is missing so a broken deployment says what to
 * fix instead of failing with "we could not reach your private storage".
 *
 * Only schema-level facts are reported — never a row, and never a value.
 */

export interface CheckResult {
  name: string;
  ok: boolean;
  problem?: string;
  fix?: string;
}

const APPLY_INITIAL =
  "Apply supabase/migrations/202609040001_initial_schema.sql in the Supabase SQL editor.";
const APPLY_LIMITER =
  "Apply supabase/migrations/202609060001_atomic_rate_limit.sql in the Supabase SQL editor.";

/** Postgres/PostgREST signals for "this object does not exist". */
const missingRelation = (message: string) =>
  /does not exist|could not find the table|schema cache/i.test(message);

async function checkTable(table: string, fix: string): Promise<CheckResult> {
  try {
    // A plain GET rather than HEAD: a HEAD response carries no body, so the
    // error describing a missing relation would never reach the client.
    const { error } = await db().from(table).select("id").limit(1);
    if (!error) return { name: `table ${table}`, ok: true };

    return {
      name: `table ${table}`,
      ok: false,
      problem: missingRelation(error.message) ? "does not exist" : error.message,
      fix: missingRelation(error.message) ? fix : "Check the service-role key and project URL.",
    };
  } catch (error) {
    return {
      name: `table ${table}`,
      ok: false,
      problem: error instanceof Error ? error.message : "unreachable",
      fix: "Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    };
  }
}

/**
 * Probes the limiter with an invalid limit. The function raises before writing
 * anything, so its own error proves it exists without recording an event.
 */
async function checkLimiter(): Promise<CheckResult> {
  const name = "function consume_rate_limit";
  try {
    const { error } = await db().rpc("consume_rate_limit", {
      p_key_hash: "healthcheck",
      p_action: "healthcheck",
      p_limit: 0,
      p_window_seconds: 0,
    });

    // The deliberate parameter error means the function is installed.
    if (error && /invalid rate limit parameters/i.test(error.message)) return { name, ok: true };
    if (!error) return { name, ok: true };

    return {
      name,
      ok: false,
      problem: missingRelation(error.message) ? "does not exist" : error.message,
      fix: APPLY_LIMITER,
    };
  } catch (error) {
    return { name, ok: false, problem: error instanceof Error ? error.message : "unreachable", fix: APPLY_LIMITER };
  }
}

export async function databaseReport(): Promise<{ ok: boolean; checks: CheckResult[] }> {
  const checks = await Promise.all([
    checkTable("quiz_profiles", APPLY_INITIAL),
    checkTable("rate_limit_events", APPLY_INITIAL),
    checkLimiter(),
  ]);

  return { ok: checks.every((check) => check.ok), checks };
}
