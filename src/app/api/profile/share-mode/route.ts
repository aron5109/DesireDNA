import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ownerCookie } from "@/lib/server/cookies";
import { ConfigurationError, logServerError } from "@/lib/server/logging";
import { setShareMode } from "@/lib/server/profile-store";
import { RequestRejectedError, assertSameOrigin, readJsonBody } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const bodySchema = z.object({ shareMode: z.enum(["mutual_only", "full_comparison"]) }).strict();

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);

    const { shareMode } = bodySchema.parse(await readJsonBody(req, 2048));
    const owner = await ownerCookie();
    if (!owner || !(await setShareMode(owner, shareMode))) {
      return NextResponse.json({ error: "No active profile." }, { status: 401, headers: noStore });
    }
    return NextResponse.json({ shareMode }, { headers: noStore });
  } catch (error) {
    logServerError("profile:share-mode", error);
    if (error instanceof RequestRejectedError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
    }
    const status = error instanceof ConfigurationError ? 503 : 400;
    return NextResponse.json({ error: "Unable to update sharing." }, { status, headers: noStore });
  }
}
