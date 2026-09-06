import "server-only";
import type { NextRequest } from "next/server";

import { db } from "./supabase";
import { env } from "./env";
import { hmac } from "./crypto";
import { ConfigurationError, logServerError } from "./logging";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  /** True when the limiter itself could not be consulted. */
  degraded: boolean;
}

/**
 * Database-backed rate limiting.
 *
 * Identity is a keyed HMAC that rotates daily, so no raw IP is ever stored.
 * Counting and recording happen inside one Postgres function under an advisory
 * lock, so two concurrent requests cannot both read a count below the limit.
 */

/**
 * The client address. Behind Vercel the left-most `x-forwarded-for` entry is
 * set by the platform, but a caller can prepend entries, so it is only ever an
 * identity hint. Owner-scoped budgets below do not depend on it at all.
 */
function requestIdentity(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = req.headers.get("x-real-ip")?.trim();
  return forwarded || real || "unknown";
}

function keyFor(scope: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return hmac(`${day}:${scope}`, env().RATE_LIMIT_HMAC_KEY);
}

async function consume(
  scope: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  try {
    const { data, error } = await db().rpc("consume_rate_limit", {
      p_key_hash: keyFor(scope),
      p_action: action,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") throw new Error("Unexpected limiter response");

    return {
      allowed: row.allowed,
      retryAfterSeconds: Number(row.retry_after_seconds ?? windowSeconds),
      degraded: false,
    };
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    logServerError(`rate-limit:${action}`, error);
    return { allowed: false, retryAfterSeconds: 30, degraded: true };
  }
}

/**
 * IP-scoped limit. Used for operations where an unknown caller is the risk.
 * A limiter failure returns `degraded`, and each caller decides: code lookups
 * fail closed, while saving a completed quiz is allowed through so nobody
 * loses answers to an outage.
 */
export const limitByRequest = (req: NextRequest, action: string, limit: number, windowSeconds: number) =>
  consume(`ip:${requestIdentity(req)}`, action, limit, windowSeconds);

/**
 * Owner-scoped limit, keyed on the owner token rather than the network path,
 * so the budget cannot be reset by changing address.
 */
export const limitByOwner = (owner: string, action: string, limit: number, windowSeconds: number) =>
  consume(`owner:${hmac(owner, env().OWNER_TOKEN_HMAC_KEY)}`, action, limit, windowSeconds);

/** Documented budgets, in one place so the docs and the code cannot drift. */
export const LIMITS = {
  /** Profile creation, per address. */
  create: { limit: 12, windowSeconds: 3600 },
  /** Result reads, per address. */
  read: { limit: 60, windowSeconds: 600 },
  /** Deletions, per address. */
  remove: { limit: 10, windowSeconds: 600 },
  /** Code attempts, per address. */
  compareByIp: { limit: 10, windowSeconds: 600 },
  /** Code attempts, per profile per day. */
  compareByOwner: { limit: 30, windowSeconds: 86_400 },
  /** Code regeneration, per profile. */
  rotate: { limit: 5, windowSeconds: 3600 },
} as const;
