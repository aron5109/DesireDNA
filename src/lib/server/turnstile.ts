import "server-only";
import type { NextRequest } from "next/server";

import { ConfigurationError, logServerError } from "./logging";

/**
 * Cloudflare Turnstile verification.
 *
 * Enabled only when both keys are configured. Configuring the secret without
 * the site key would leave the browser unable to produce a token, so that
 * combination is rejected as a misconfiguration rather than silently blocking
 * every request.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

export interface TurnstileOutcome {
  ok: boolean;
  /** Set when the token was rejected in a way the person can recover from. */
  reason?: "missing" | "expired" | "invalid" | "unavailable";
}

export function turnstileConfigured(): boolean {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const site = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();

  if (!secret && !site) return false;
  if (secret && site) return true;

  throw new ConfigurationError(
    "Turnstile needs both NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither",
  );
}

/**
 * A development-only bypass. It cannot activate in production: the check on
 * NODE_ENV is evaluated on the server, where the value is fixed at build time.
 */
function bypassAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.TURNSTILE_DEV_BYPASS === "true";
}

export async function verifyTurnstile(
  token: string | undefined,
  req: NextRequest,
  expectedAction: string,
): Promise<TurnstileOutcome> {
  if (!turnstileConfigured()) return { ok: true };
  if (bypassAllowed() && token === "dev-bypass") return { ok: true };
  if (!token) return { ok: false, reason: "missing" };

  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY as string,
    response: token,
    remoteip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(VERIFY_URL, { method: "POST", body, signal: controller.signal });
    const data = (await response.json()) as {
      success?: boolean;
      action?: string;
      hostname?: string;
      "error-codes"?: string[];
    };

    if (!data.success) {
      const codes = data["error-codes"] ?? [];
      const expired = codes.includes("timeout-or-duplicate");
      return { ok: false, reason: expired ? "expired" : "invalid" };
    }

    // A token minted for another action or another site must not be replayed.
    if (data.action && data.action !== expectedAction) return { ok: false, reason: "invalid" };

    const allowedHost = process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim();
    if (allowedHost && data.hostname && data.hostname !== allowedHost) {
      return { ok: false, reason: "invalid" };
    }

    return { ok: true };
  } catch (error) {
    logServerError("turnstile:verify", error);
    // Never silently disable verification after a failure.
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
