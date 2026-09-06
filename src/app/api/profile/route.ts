import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { CURRENT_QUIZ_VERSION } from "@/data/bank/registry";
import { sanitizeAlias } from "@/lib/quiz/alias";
import { ContradictoryAnswerError } from "@/lib/quiz/answer";
import { scoreResponses } from "@/lib/quiz/scoring";
import { AnswerValidationError, createProfileSchema, validateResponses } from "@/lib/quiz/validation";
import { generateDesireCode, generateOwnerToken } from "@/lib/server/codes";
import { clearOwnerCookie, ownerCookie, setOwnerCookie } from "@/lib/server/cookies";
import { ConfigurationError, describeStorageError, logServerError } from "@/lib/server/logging";
import {
  byOwner,
  createStoredProfile,
  purgeExpired,
  removeById,
  removeOwner,
  rotateShareCode,
} from "@/lib/server/profile-store";
import { LIMITS, limitByOwner, limitByRequest } from "@/lib/server/rate-limit";
import { RequestRejectedError, assertSameOrigin, readJsonBody } from "@/lib/server/request";
import { verifyTurnstile } from "@/lib/server/turnstile";
import type { ProfilePayload } from "@/lib/quiz/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 120_000;

function failure(scope: string, error: unknown): NextResponse {
  logServerError(scope, error);

  if (error instanceof ConfigurationError) {
    return NextResponse.json(
      {
        error:
          "DesireDNA is not fully configured. The server is missing required environment variables — see /api/health for the list, then redeploy after setting them.",
        missingConfiguration: error.details?.missing ?? [],
        invalidConfiguration: error.details?.invalid ?? [],
      },
      { status: 503, headers: noStore },
    );
  }
  if (error instanceof RequestRejectedError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ZodError || error instanceof AnswerValidationError || error instanceof ContradictoryAnswerError) {
    return NextResponse.json(
      { error: "Some answers could not be accepted. Please try again." },
      { status: 400, headers: noStore },
    );
  }
  // A storage failure is almost always a schema that was never applied, so the
  // reason is passed through: it names the missing object, never a stored value.
  const reason = describeStorageError(error);
  return NextResponse.json(
    {
      error: reason
        ? "Your answers could not be saved because the database is not set up correctly."
        : "We could not reach your private storage. Please try again.",
      ...(reason ? { storageProblem: reason, hint: "Open /api/health for the full setup check." } : {}),
    },
    { status: 500, headers: noStore },
  );
}

const tooMany = (retryAfterSeconds: number, message: string) =>
  NextResponse.json(
    { error: message, retryAfterSeconds },
    { status: 429, headers: { ...noStore, "Retry-After": String(retryAfterSeconds) } },
  );

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);

    const limit = await limitByRequest(req, "create", LIMITS.create.limit, LIMITS.create.windowSeconds);
    // A limiter outage must not cost someone the quiz they just finished, so
    // saving is allowed through while code lookups (below) fail closed.
    if (!limit.allowed && !limit.degraded) {
      return tooMany(limit.retryAfterSeconds, "Too many profiles were created from this connection.");
    }

    const parsed = createProfileSchema.parse(await readJsonBody(req, MAX_BODY_BYTES));

    const turnstile = await verifyTurnstile(parsed.turnstileToken, req, "create_profile");
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "Verification failed. Please try again.", turnstile: turnstile.reason },
        { status: 400, headers: noStore },
      );
    }

    validateResponses(parsed.responses, parsed.quizVersion);

    const result = scoreResponses(parsed.responses, parsed.tone);
    const owner = generateOwnerToken();
    const desireCode = generateDesireCode();
    const expiresAt = new Date(Date.now() + parsed.retentionDays * 86_400_000);

    const payload: ProfilePayload = {
      responses: parsed.responses,
      result,
      desireCode,
      alias: sanitizeAlias(parsed.alias),
      tone: parsed.tone,
      consentTimestamp: new Date().toISOString(),
      quizVersion: CURRENT_QUIZ_VERSION,
      retentionDays: parsed.retentionDays,
      shareMode: "mutual_only",
    };

    // A replacement is written before the old profile is removed, so a failure
    // here leaves the existing profile intact and reachable.
    const previous = parsed.replaceExisting ? await currentProfileId() : null;

    await createStoredProfile(owner, desireCode, payload, expiresAt.toISOString());
    await setOwnerCookie(owner, parsed.retentionDays * 86_400);

    if (previous) {
      try {
        await removeById(previous);
      } catch (error) {
        // The new profile is saved and owned; a stale old row will expire.
        logServerError("profile:replace-cleanup", error);
      }
    }

    await purgeExpired();

    return NextResponse.json(
      {
        result,
        desireCode,
        alias: payload.alias,
        expiresAt: expiresAt.toISOString(),
        shareMode: "mutual_only",
        quizVersion: CURRENT_QUIZ_VERSION,
      },
      { status: 201, headers: noStore },
    );
  } catch (error) {
    return failure("profile:create", error);
  }
}

async function currentProfileId(): Promise<string | null> {
  const owner = await ownerCookie();
  if (!owner) return null;
  const existing = await byOwner(owner);
  return existing?.row.id ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const limit = await limitByRequest(req, "read", LIMITS.read.limit, LIMITS.read.windowSeconds);
    if (!limit.allowed && !limit.degraded) {
      return tooMany(limit.retryAfterSeconds, "Too many attempts.");
    }

    const owner = await ownerCookie();
    if (!owner) return NextResponse.json({ error: "No active profile." }, { status: 401, headers: noStore });

    const found = await byOwner(owner);
    if (!found) return NextResponse.json({ error: "No active profile." }, { status: 404, headers: noStore });

    return NextResponse.json(
      {
        result: found.payload.result,
        desireCode: found.payload.desireCode,
        alias: found.payload.alias,
        expiresAt: found.row.expires_at,
        shareMode: found.payload.shareMode,
        quizVersion: found.payload.quizVersion,
        tone: found.payload.tone,
      },
      { headers: noStore },
    );
  } catch (error) {
    return failure("profile:read", error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);

    const limit = await limitByRequest(req, "remove", LIMITS.remove.limit, LIMITS.remove.windowSeconds);
    if (!limit.allowed && !limit.degraded) {
      return tooMany(limit.retryAfterSeconds, "Too many attempts.");
    }

    const owner = await ownerCookie();
    if (owner) await removeOwner(owner);
    await clearOwnerCookie();

    return NextResponse.json({ success: true }, { headers: noStore });
  } catch (error) {
    return failure("profile:delete", error);
  }
}

/** Issues a replacement DesireCode, invalidating the previous one. */
export async function PATCH(req: NextRequest) {
  try {
    assertSameOrigin(req);

    const owner = await ownerCookie();
    if (!owner) return NextResponse.json({ error: "No active profile." }, { status: 401, headers: noStore });

    const limit = await limitByOwner(owner, "rotate", LIMITS.rotate.limit, LIMITS.rotate.windowSeconds);
    if (!limit.allowed) return tooMany(limit.retryAfterSeconds, "Too many code changes. Try again later.");

    const desireCode = generateDesireCode();
    const rotated = await rotateShareCode(owner, desireCode);
    if (!rotated) return NextResponse.json({ error: "No active profile." }, { status: 404, headers: noStore });

    return NextResponse.json({ desireCode }, { headers: noStore });
  } catch (error) {
    return failure("profile:rotate-code", error);
  }
}
