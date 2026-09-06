import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { IncompatibleVersionsError, compareProfiles } from "@/lib/quiz/comparison";
import { normalizeDesireCode } from "@/lib/server/codes";
import { ownerCookie } from "@/lib/server/cookies";
import { ConfigurationError, logServerError } from "@/lib/server/logging";
import { byCode, byOwner } from "@/lib/server/profile-store";
import { LIMITS, limitByOwner, limitByRequest } from "@/lib/server/rate-limit";
import { RequestRejectedError, assertSameOrigin, readJsonBody } from "@/lib/server/request";
import { verifyTurnstile } from "@/lib/server/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * One message for every unusable code. A caller must not be able to tell a
 * typo from a deleted, expired, revoked, or never-existing profile.
 */
const NOT_FOUND = "This DesireCode was not found or has expired.";

/**
 * Records a failed code attempt and reports whether the guessing budget is
 * spent. Wrong codes are the abuse signal, so they are bounded more tightly
 * than comparisons with codes someone was actually given.
 */
async function noteFailedAttempt(owner: string) {
  return limitByOwner(owner, "invalid_code", LIMITS.invalidCode.limit, LIMITS.invalidCode.windowSeconds);
}

const tooManyGuesses = (retryAfterSeconds: number) => {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return NextResponse.json(
    {
      error: `Too many codes that did not match. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      retryAfterSeconds,
    },
    { status: 429, headers: { ...noStore, "Retry-After": String(retryAfterSeconds) } },
  );
};

const bodySchema = z
  .object({ desireCode: z.string().max(40), turnstileToken: z.string().max(2048).optional() })
  .strict();

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);

    const owner = await ownerCookie();
    if (!owner) {
      return NextResponse.json(
        { error: "Complete your own quiz before comparing." },
        { status: 401, headers: noStore },
      );
    }

    const [byIp, byProfile] = await Promise.all([
      limitByRequest(req, "compare", LIMITS.compareByIp.limit, LIMITS.compareByIp.windowSeconds),
      limitByOwner(owner, "compare", LIMITS.compareByOwner.limit, LIMITS.compareByOwner.windowSeconds),
    ]);

    // Code lookup fails closed: a limiter that cannot be consulted must never
    // turn into unlimited guessing at other people's codes.
    for (const decision of [byIp, byProfile]) {
      if (decision.degraded) {
        // Fails closed either way, but the two causes need different words:
        // one passes on its own, the other needs a migration applied.
        return NextResponse.json(
          {
            error: decision.notInstalled
              ? "Comparison is unavailable because the database is not fully set up."
              : "Comparison is temporarily unavailable. Please try again shortly.",
            ...(decision.reason ? { storageProblem: decision.reason } : {}),
            ...(decision.notInstalled
              ? {
                  hint: "Apply supabase/migrations/202609060001_atomic_rate_limit.sql, then run `notify pgrst, 'reload schema';`. Check /api/health for the full setup state.",
                }
              : {}),
          },
          { status: 503, headers: { ...noStore, "Retry-After": String(decision.retryAfterSeconds) } },
        );
      }
      if (!decision.allowed) {
        const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
        return NextResponse.json(
          {
            error: `Too many comparison attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
            retryAfterSeconds: decision.retryAfterSeconds,
          },
          { status: 429, headers: { ...noStore, "Retry-After": String(decision.retryAfterSeconds) } },
        );
      }
    }

    const { desireCode, turnstileToken } = bodySchema.parse(await readJsonBody(req, 4096));

    const turnstile = await verifyTurnstile(turnstileToken, req, "compare");
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "Verification failed. Please try again.", turnstile: turnstile.reason },
        { status: 400, headers: noStore },
      );
    }

    const code = normalizeDesireCode(desireCode);
    if (!code) {
      const guesses = await noteFailedAttempt(owner);
      if (!guesses.allowed) return tooManyGuesses(guesses.retryAfterSeconds);
      return NextResponse.json({ error: NOT_FOUND }, { status: 404, headers: noStore });
    }

    const [self, partner] = await Promise.all([byOwner(owner), byCode(code)]);
    if (!self) {
      return NextResponse.json(
        { error: "Complete your own quiz before comparing." },
        { status: 401, headers: noStore },
      );
    }
    if (!partner || self.row.id === partner.row.id) {
      const guesses = await noteFailedAttempt(owner);
      if (!guesses.allowed) return tooManyGuesses(guesses.retryAfterSeconds);
      return NextResponse.json({ error: NOT_FOUND }, { status: 404, headers: noStore });
    }

    let comparison;
    try {
      comparison = compareProfiles(self.payload, partner.payload);
    } catch (error) {
      if (error instanceof IncompatibleVersionsError) {
        // Says nothing about the other profile beyond "not comparable".
        return NextResponse.json(
          {
            error:
              "These two profiles were made with different versions of the quiz. Both of you will need to take the current quiz to compare.",
          },
          { status: 409, headers: noStore },
        );
      }
      throw error;
    }

    return NextResponse.json(
      {
        comparison,
        consentReminder: "A matching interest never replaces active, sober, informed consent.",
      },
      { headers: noStore },
    );
  } catch (error) {
    logServerError("compare", error);
    if (error instanceof ConfigurationError) {
      return NextResponse.json(
        { error: "DesireDNA is not fully configured yet. Please try again later." },
        { status: 503, headers: noStore },
      );
    }
    if (error instanceof RequestRejectedError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
    }
    return NextResponse.json({ error: NOT_FOUND }, { status: 400, headers: noStore });
  }
}
