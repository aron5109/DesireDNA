import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { compareProfiles } from "@/lib/quiz/comparison";
import { normalizeDesireCode } from "@/lib/server/codes";
import { ownerCookie } from "@/lib/server/cookies";
import { ConfigurationError, logServerError } from "@/lib/server/logging";
import { byCode, byOwner, purgeExpired } from "@/lib/server/profile-store";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * One generic message covers every unusable code. A caller must not be able to
 * tell a typo from a deleted, expired, revoked, or never-existing profile.
 */
const NOT_FOUND = "This DesireCode was not found or has expired.";

const bodySchema = z.object({
  desireCode: z.string().max(40),
  turnstileToken: z.string().max(2048).optional(),
});

async function verifyTurnstile(token: string | undefined, req: NextRequest): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
  });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  const data = (await response.json()) as { success?: boolean };
  return data.success === true;
}

export async function POST(req: NextRequest) {
  try {
    const owner = await ownerCookie();
    if (!owner) {
      return NextResponse.json(
        { error: "Complete your own quiz before comparing." },
        { status: 401, headers: noStore },
      );
    }

    const [shortWindow, dailyWindow] = await Promise.all([
      rateLimit(req, "compare", 10, 10),
      rateLimit(req, "compare_owner_daily", 30, 1440, owner),
    ]);
    if (!shortWindow || !dailyWindow) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: noStore },
      );
    }

    const { desireCode, turnstileToken } = bodySchema.parse(await req.json());
    if (!(await verifyTurnstile(turnstileToken, req))) {
      return NextResponse.json({ error: "Verification failed." }, { status: 400, headers: noStore });
    }

    const code = normalizeDesireCode(desireCode);
    if (!code) {
      await rateLimit(req, "invalid_code", 10, 10);
      return NextResponse.json({ error: NOT_FOUND }, { status: 404, headers: noStore });
    }

    const [self, partner] = await Promise.all([byOwner(owner), byCode(code)]);
    if (!self) {
      return NextResponse.json(
        { error: "Complete your own quiz before comparing." },
        { status: 401, headers: noStore },
      );
    }
    if (!partner || self.row.id === partner.row.id || self.payload.quizVersion !== partner.payload.quizVersion) {
      await rateLimit(req, "invalid_code", 10, 10);
      return NextResponse.json({ error: NOT_FOUND }, { status: 404, headers: noStore });
    }

    // Derived only, never stored: the comparison is recalculated on demand and
    // the partner's raw answers never leave the server.
    const comparison = compareProfiles(self.payload, partner.payload);

    void purgeExpired().catch((error: unknown) => logServerError("compare:purge", error));

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
    return NextResponse.json({ error: NOT_FOUND }, { status: 400, headers: noStore });
  }
}
