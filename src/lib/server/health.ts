import "server-only";

import { env } from "./env";
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

const RELOAD_CACHE =
  "The table exists but Supabase's API layer has not picked it up. Run `notify pgrst, 'reload schema';` in the SQL editor, or restart the API from Settings → API.";

/**
 * PostgREST reports a stale schema cache and a genuinely absent table very
 * differently, and the fixes are opposite: one needs a cache reload, the other
 * needs the migration applied. Telling them apart matters — advising someone to
 * re-run a migration they already ran sends them in circles.
 */
const staleSchemaCache = (message: string, code?: string) =>
  code === "PGRST205" || /schema cache/i.test(message);

const missingRelation = (message: string) => /does not exist/i.test(message);

async function checkTable(table: string, fix: string): Promise<CheckResult> {
  try {
    // A plain GET rather than HEAD: a HEAD response carries no body, so the
    // error describing a missing relation would never reach the client.
    const { error } = await db().from(table).select("id").limit(1);
    if (!error) return { name: `table ${table}`, ok: true };

    if (staleSchemaCache(error.message, error.code)) {
      return { name: `table ${table}`, ok: false, problem: "is not in the API schema cache", fix: RELOAD_CACHE };
    }
    if (missingRelation(error.message)) {
      return { name: `table ${table}`, ok: false, problem: "does not exist", fix };
    }
    return {
      name: `table ${table}`,
      ok: false,
      problem: error.message,
      fix: "Check the service-role key and project URL.",
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

    if (staleSchemaCache(error.message, error.code)) {
      return { name, ok: false, problem: "is not in the API schema cache", fix: RELOAD_CACHE };
    }
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

/**
 * The Supabase project the server is actually talking to.
 *
 * Not a credential — it is the project's public URL — and it is the fastest way
 * to catch SQL being run in one project while the app points at another, which
 * looks identical to a stale cache from the outside.
 */
export function connectedProject(): string {
  try {
    return new URL(env().SUPABASE_URL).host;
  } catch {
    return "unknown";
  }
}

export async function databaseReport(): Promise<{ ok: boolean; project: string; checks: CheckResult[] }> {
  const checks = await Promise.all([
    checkTable("quiz_profiles", APPLY_INITIAL),
    checkTable("rate_limit_events", APPLY_INITIAL),
    checkLimiter(),
  ]);

  return { ok: checks.every((check) => check.ok), project: connectedProject(), checks };
}
