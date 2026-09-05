import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { QUIZ_VERSION } from "@/data/questions";
import { sanitizeAlias } from "@/lib/quiz/alias";
import { scoreQuiz } from "@/lib/quiz/scoring";
import { AnswerValidationError, createProfileSchema, validateAnswers } from "@/lib/quiz/validation";
import { generateDesireCode, generateOwnerToken } from "@/lib/server/codes";
import { clearOwnerCookie, ownerCookie, setOwnerCookie } from "@/lib/server/cookies";
import { ConfigurationError, logServerError } from "@/lib/server/logging";
import { byOwner, createStoredProfile, purgeExpired, removeOwner } from "@/lib/server/profile-store";
import { rateLimit } from "@/lib/server/rate-limit";
import type { ProfilePayload } from "@/lib/quiz/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 100_000;

/**
 * Maps a thrown error onto a safe response. Nothing derived from the request
 * body is returned; the distinction exists so a misconfigured deployment is
 * reported as a server problem instead of silently looking like bad input.
 */
function failure(scope: string, error: unknown): NextResponse {
  logServerError(scope, error);

  if (error instanceof ConfigurationError) {
    // Variable names and reasons only — never a value. Without them an
    // operator has no way to tell which secret the deployment is missing.
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
  if (error instanceof ZodError || error instanceof AnswerValidationError) {
    return NextResponse.json(
      { error: "Please review your confirmations and answers." },
      { status: 400, headers: noStore },
    );
  }
  return NextResponse.json(
    { error: "We could not reach your private storage. Please try again." },
    { status: 500, headers: noStore },
  );
}

export async function POST(req: NextRequest) {
  try {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: noStore });
    }
    if (!(await rateLimit(req, "create", 12, 60))) {
      return NextResponse.json(
        { error: "Too many profiles were created from this connection. Please try again later." },
        { status: 429, headers: noStore },
      );
    }

    const parsed = createProfileSchema.parse(await req.json());
    validateAnswers(parsed.answers);

    const result = scoreQuiz(parsed.answers, parsed.tone);
    const owner = generateOwnerToken();
    const desireCode = generateDesireCode();
    const alias = sanitizeAlias(parsed.alias);
    const expiresAt = new Date(Date.now() + parsed.retentionDays * 86_400_000);

    const payload: ProfilePayload = {
      answers: parsed.answers,
      result,
      desireCode,
      alias,
      tone: parsed.tone,
      consentTimestamp: new Date().toISOString(),
      quizVersion: QUIZ_VERSION,
      retentionDays: parsed.retentionDays,
      shareMode: "mutual_only",
    };

    await createStoredProfile(owner, desireCode, payload, expiresAt.toISOString());
    await setOwnerCookie(owner, parsed.retentionDays * 86_400);

    // Expired rows are removed opportunistically, after the caller's own work
    // has succeeded, so cleanup can never cost someone their result.
    void purgeExpired().catch((error: unknown) => logServerError("profile:purge", error));

    return NextResponse.json(
      { result, desireCode, alias, expiresAt: expiresAt.toISOString(), shareMode: "mutual_only" },
      { status: 201, headers: noStore },
    );
  } catch (error) {
    return failure("profile:create", error);
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await rateLimit(req, "retrieve", 60, 10))) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429, headers: noStore });
    }

    const owner = await ownerCookie();
    if (!owner) {
      return NextResponse.json({ error: "No active profile." }, { status: 401, headers: noStore });
    }

    const found = await byOwner(owner);
    if (!found) {
      return NextResponse.json({ error: "No active profile." }, { status: 404, headers: noStore });
    }

    return NextResponse.json(
      {
        result: found.payload.result,
        desireCode: found.payload.desireCode,
        alias: found.payload.alias,
        expiresAt: found.row.expires_at,
        shareMode: found.payload.shareMode,
      },
      { headers: noStore },
    );
  } catch (error) {
    return failure("profile:read", error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await rateLimit(req, "delete", 10, 10))) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429, headers: noStore });
    }

    const owner = await ownerCookie();
    if (owner) await removeOwner(owner);
    await clearOwnerCookie();

    return NextResponse.json({ success: true }, { headers: noStore });
  } catch (error) {
    return failure("profile:delete", error);
  }
}
