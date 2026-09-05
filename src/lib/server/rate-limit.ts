import "server-only";
import type { NextRequest } from "next/server";
import { db } from "./supabase";
import { env } from "./env";
import { hmac } from "./crypto";
import { ConfigurationError, logServerError } from "./logging";

/**
 * Database-backed rate limiting.
 *
 * The caller's IP is never stored: it is folded into a keyed HMAC together
 * with the current date, so the identity rotates daily and the stored value is
 * not reversible.
 *
 * A rate-limit table that is unreachable must not be the reason a consenting
 * adult loses the result they just spent ten minutes producing, so storage
 * failures are logged and allowed through. Configuration errors still throw:
 * those mean the deployment itself is broken and the caller reports that.
 */
export async function rateLimit(
  req: NextRequest,
  action: string,
  limit: number,
  minutes: number,
  owner = "",
): Promise<boolean> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const key = hmac(`${day}:${ip}:${owner}`, env().RATE_LIMIT_HMAC_KEY);
  const since = new Date(Date.now() - minutes * 60_000).toISOString();

  try {
    const client = db();
    const { count, error } = await client
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("key_hash", key)
      .eq("action", action)
      .gte("created_at", since);
    if (error) throw error;
    if ((count ?? 0) >= limit) return false;

    const { error: insertError } = await client.from("rate_limit_events").insert({ key_hash: key, action });
    if (insertError) throw insertError;
    return true;
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    logServerError(`rate-limit:${action}`, error);
    return true;
  }
}
