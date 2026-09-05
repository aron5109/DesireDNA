import type { Metadata } from "next";
import Link from "next/link";

import { ResultView, type ProfileView } from "@/components/ResultExperience";
import { ownerCookie } from "@/lib/server/cookies";
import { logServerError } from "@/lib/server/logging";
import { byOwner } from "@/lib/server/profile-store";

export const metadata: Metadata = {
  title: "Your private result",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * The result is read, decrypted, and rendered on the server using the owner
 * cookie, so finishing the quiz always lands on the outcome itself. The
 * projection below is deliberate: answers never reach the browser.
 */
export default async function Results() {
  let profile: ProfileView | null = null;
  let unavailable = false;

  try {
    const owner = await ownerCookie();
    const found = owner ? await byOwner(owner) : null;
    if (found) {
      profile = {
        result: found.payload.result,
        desireCode: found.payload.desireCode,
        alias: found.payload.alias,
        expiresAt: found.row.expires_at,
        shareMode: found.payload.shareMode,
      };
    }
  } catch (error) {
    logServerError("results:page", error);
    unavailable = true;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {profile ? (
        <ResultView profile={profile} />
      ) : unavailable ? (
        <div className="card p-8 text-center" role="alert">
          <h1 className="text-2xl font-semibold">Your result could not be loaded</h1>
          <p className="mt-3 text-muted">
            We could not reach your private storage just now. Your profile has not been deleted — please reload this
            page in a moment.
          </p>
          <Link href="/results" className="btn btn-primary mt-6">
            Reload
          </Link>
        </div>
      ) : (
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-semibold">No private result available</h1>
          <p className="mt-3 text-muted">
            No active profile was found in this browser. It may have expired, been deleted, or been created on another
            device. Results are tied to a private cookie on the device that took the quiz — they are never public.
          </p>
          <Link href="/quiz" className="btn btn-primary mt-6">
            Take the quiz
          </Link>
        </div>
      )}
    </main>
  );
}
