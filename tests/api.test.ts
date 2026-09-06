import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSupabase } from "./support/fake-supabase";

const database = new FakeSupabase();

/** Deterministic test secrets. None of these are used by any deployment. */
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests-only";
process.env.PROFILE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.PROFILE_ENCRYPTION_KEY_VERSION = "1";
process.env.SHARE_CODE_HMAC_KEY = "share-code-hmac-key-for-tests-only";
process.env.OWNER_TOKEN_HMAC_KEY = "owner-token-hmac-key-for-tests-only";
process.env.RATE_LIMIT_HMAC_KEY = "rate-limit-hmac-key-for-tests-only";
process.env.CRON_SECRET = "cron-secret-value-for-tests-only";

vi.mock("@/lib/server/supabase", () => ({ db: () => database }));

/** A cookie jar standing in for the browser's HttpOnly owner cookie. */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

type ProfileRoute = typeof import("@/app/api/profile/route");
type CompareRoute = typeof import("@/app/api/compare/route");
type ShareModeRoute = typeof import("@/app/api/profile/share-mode/route");

let profileRoute: ProfileRoute;
let compareRoute: CompareRoute;
let shareModeRoute: ShareModeRoute;
let cardIds: string[];
let quizVersion: string;

const post = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(body),
  });

const get = (url: string) => new NextRequest(url, { method: "GET" });

type Responses = Record<string, unknown>;

function submission(responses: Responses, alias?: string) {
  return {
    ageConfirmed: true,
    explicitContentConfirmed: true,
    storageConsent: true,
    deletionUnderstood: true,
    quizVersion,
    retentionDays: 7,
    tone: "playful",
    ...(alias ? { alias } : {}),
    responses,
  };
}

/** A handful of plain "Into it" answers on interest cards. */
function keen(count = 3): Responses {
  return Object.fromEntries(cardIds.slice(0, count).map((id) => [id, { kind: "interest", interest: "yes" }]));
}

/** Creates a profile and returns its response body plus its owner cookie. */
async function createProfile(responses: Responses, alias?: string) {
  jar.delete("ddna_owner");
  const response = await profileRoute.POST(post("http://localhost/api/profile", submission(responses, alias)));
  const body = (await response.json()) as { desireCode?: string; alias?: string; error?: string };
  const cookie = jar.get("ddna_owner");
  return { status: response.status, body, cookie };
}

beforeAll(async () => {
  profileRoute = await import("@/app/api/profile/route");
  compareRoute = await import("@/app/api/compare/route");
  shareModeRoute = await import("@/app/api/profile/share-mode/route");
  const { getCards, CURRENT_QUIZ_VERSION } = await import("@/data/bank/registry");
  quizVersion = CURRENT_QUIZ_VERSION;
  cardIds = getCards().filter((card) => card.responseType === "interest").map((card) => card.id);
});

beforeEach(() => {
  database.reset();
  jar.clear();
});

describe("POST /api/profile", () => {
  it("stores an encrypted profile and returns the owner's result", async () => {
    const created = await createProfile(keen());

    expect(created.status).toBe(201);
    expect(created.body.desireCode).toMatch(/^DDNA-(?:[A-HJ-NP-Z2-9]{4}-){3}[A-HJ-NP-Z2-9]{4}$/);
    expect(created.cookie).toBeTruthy();

    const [row] = database.rows("quiz_profiles");
    expect(row.payload_ciphertext).toBeTruthy();
    // Nothing sensitive may be readable in the stored row.
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(created.body.desireCode as string);
    expect(stored).not.toContain("interest");
    expect(stored).not.toContain(created.cookie as string);
  });

  it("assigns a random alias when the client does not send one", async () => {
    const created = await createProfile(keen());
    expect(created.body.alias).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/);
  });

  it("replaces an alias that is not from the curated word list", async () => {
    const created = await createProfile(keen(), "<script>evil</script>");
    expect(created.body.alias).not.toContain("script");
    expect(created.body.alias).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/);
  });

  it("rejects unknown question IDs", async () => {
    const created = await createProfile({ not_a_real_question: { kind: "interest", interest: "yes" } });
    expect(created.status).toBe(400);
    expect(database.rows("quiz_profiles")).toHaveLength(0);
  });

  it("rejects answer values a question does not offer", async () => {
    const created = await createProfile({ [cardIds[0]]: { kind: "interest", interest: "absolutely_not_an_option" } });
    expect(created.status).toBe(400);
    expect(database.rows("quiz_profiles")).toHaveLength(0);
  });

  it("rejects a submission without every consent confirmation", async () => {
    const body = { ...submission(keen()), ageConfirmed: false };
    const response = await profileRoute.POST(post("http://localhost/api/profile", body));
    expect(response.status).toBe(400);
    expect(database.rows("quiz_profiles")).toHaveLength(0);
  });

  it("reports storage failures as a server error rather than bad input", async () => {
    database.failure = "connection refused";
    const response = await profileRoute.POST(
      post("http://localhost/api/profile", submission(keen())),
    );
    expect(response.status).toBe(500);
  });

  it("names a missing table instead of failing opaquely", async () => {
    // What an unapplied initial migration actually looks like.
    database.failure = 'relation "public.quiz_profiles" does not exist';
    const response = await profileRoute.POST(post("http://localhost/api/profile", submission(keen())));
    database.failure = null;

    const body = (await response.json()) as { error: string; storageProblem?: string; hint?: string };
    expect(response.status).toBe(500);
    expect(body.storageProblem).toContain("quiz_profiles");
    expect(body.hint).toContain("/api/health");
  });

  it("never passes a stored value through the storage reason", async () => {
    const { describeStorageError } = await import("@/lib/server/logging");

    // Postgres puts key values in `details`; only code and message may escape.
    const pgError = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "quiz_profiles_share_code_hash_key"',
      details: "Key (share_code_hash)=(deadbeefcafe) already exists.",
      hint: "some hint",
    };

    const described = describeStorageError(pgError) as string;
    expect(described).toContain("23505");
    expect(described).not.toContain("deadbeefcafe");
    expect(described).not.toContain("some hint");
  });
});

describe("GET /api/profile", () => {
  it("returns the owner's own result and never caches it", async () => {
    await createProfile(keen());
    const response = await profileRoute.GET(get("http://localhost/api/profile"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { result: { scoredCount: number }; responses?: unknown };
    expect(body.result.scoredCount).toBe(3);
    expect(body.responses).toBeUndefined();
  });

  it("refuses a wrong owner token", async () => {
    await createProfile(keen());
    jar.set("ddna_owner", "an-owner-token-that-was-never-issued");

    const response = await profileRoute.GET(get("http://localhost/api/profile"));
    expect(response.status).toBe(404);
  });

  it("refuses a request with no owner cookie", async () => {
    await createProfile(keen());
    jar.delete("ddna_owner");

    const response = await profileRoute.GET(get("http://localhost/api/profile"));
    expect(response.status).toBe(401);
  });

  it("refuses an expired profile even before cleanup has run", async () => {
    await createProfile(keen());
    database.rows("quiz_profiles")[0].expires_at = new Date(Date.now() - 60_000).toISOString();

    const response = await profileRoute.GET(get("http://localhost/api/profile"));
    expect(response.status).toBe(404);
  });

  it("refuses a revoked profile", async () => {
    await createProfile(keen());
    database.rows("quiz_profiles")[0].revoked_at = new Date().toISOString();

    const response = await profileRoute.GET(get("http://localhost/api/profile"));
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/profile", () => {
  it("hard-deletes the row and clears the cookie", async () => {
    await createProfile(keen());
    expect(database.rows("quiz_profiles")).toHaveLength(1);

    const response = await profileRoute.DELETE(new NextRequest("http://localhost/api/profile", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(database.rows("quiz_profiles")).toHaveLength(0);
    expect(jar.get("ddna_owner")).toBeUndefined();
  });
});

describe("profile lifecycle", () => {
  it("issues a replacement code and stops the old one working", async () => {
    const created = await createProfile(keen());
    const oldCode = created.body.desireCode as string;

    const rotated = await profileRoute.PATCH(
      new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        headers: { origin: "http://localhost", host: "localhost" },
      }),
    );
    const { desireCode: newCode } = (await rotated.json()) as { desireCode: string };

    expect(rotated.status).toBe(200);
    expect(newCode).not.toBe(oldCode);
    // Still exactly one profile, still owned by the same person.
    expect(database.rows("quiz_profiles")).toHaveLength(1);

    const partnerLookup = await profileRoute.GET(get("http://localhost/api/profile"));
    expect(((await partnerLookup.json()) as { desireCode: string }).desireCode).toBe(newCode);

    // The old code no longer resolves for anyone.
    const owner = jar.get("ddna_owner") as string;
    const other = await createProfile(keen());
    jar.set("ddna_owner", owner);
    void other;
    jar.set("ddna_owner", owner);

    const stale = await compareRoute.POST(post("http://localhost/api/compare", { desireCode: oldCode }));
    expect(stale.status).toBe(404);
  });

  it("keeps the existing profile when a replacement cannot be saved", async () => {
    await createProfile(keen());
    const before = database.rows("quiz_profiles")[0];

    database.failure = "connection refused";
    const response = await profileRoute.POST(
      post("http://localhost/api/profile", { ...submission(keen()), replaceExisting: true }),
    );
    database.failure = null;

    expect(response.status).toBe(500);
    // Nothing was removed on the way to a failure.
    expect(database.rows("quiz_profiles")).toContain(before);
  });

  it("refuses a cross-site state change", async () => {
    await createProfile(keen());
    const foreign = new NextRequest("http://localhost/api/profile", {
      method: "DELETE",
      headers: { origin: "https://evil.example", host: "localhost", "sec-fetch-site": "cross-site" },
    });

    const response = await profileRoute.DELETE(foreign);
    expect(response.status).toBe(403);
    expect(database.rows("quiz_profiles")).toHaveLength(1);
  });

  it("enforces the size limit on bytes actually received", async () => {
    const huge = "x".repeat(200_000);
    const response = await profileRoute.POST(
      new NextRequest("http://localhost/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
        body: JSON.stringify({ ...submission(keen()), alias: huge }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await profileRoute.POST(
      new NextRequest("http://localhost/api/profile", {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "http://localhost", host: "localhost" },
        body: "hello",
      }),
    );
    expect(response.status).toBe(415);
  });

  it("rejects contradictory answer details", async () => {
    const response = await profileRoute.POST(
      post("http://localhost/api/profile", {
        ...submission({ [cardIds[0]]: { kind: "interest", interest: "yes", details: { hardLimit: true } } }),
      }),
    );
    expect(response.status).toBe(400);
    expect(database.rows("quiz_profiles")).toHaveLength(0);
  });

  it("rejects an answer to a question that was never asked", async () => {
    const response = await profileRoute.POST(
      post("http://localhost/api/profile", {
        ...submission({
          "media.watches": { kind: "choice", value: "no" },
          "media.categories": { kind: "multi", values: ["romantic"] },
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a submission for an old quiz version", async () => {
    const response = await profileRoute.POST(
      post("http://localhost/api/profile", { ...submission(keen()), quizVersion: "2026.2" }),
    );
    expect(response.status).toBe(400);
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the budget is spent", async () => {
    await createProfile(keen());
    let last: Response | null = null;

    for (let attempt = 0; attempt < 12; attempt++) {
      last = await compareRoute.POST(
        post("http://localhost/api/compare", { desireCode: "DDNA-ABCD-EFGH-JKLM-NPQR" }),
      );
    }

    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("fails closed for code lookups when the limiter is unavailable", async () => {
    await createProfile(keen());
    database.failure = "limiter down";

    const response = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: "DDNA-ABCD-EFGH-JKLM-NPQR" }),
    );
    database.failure = null;

    // Never an unlimited guessing window.
    expect(response.status).toBe(503);
  });
});

describe("POST /api/compare", () => {
  /** Creates a partner profile, then restores the caller's own cookie. */
  async function withPartner(partnerAnswers: Responses) {
    const owner = jar.get("ddna_owner");
    const partner = await createProfile(partnerAnswers);
    if (owner) jar.set("ddna_owner", owner);
    else jar.delete("ddna_owner");
    return partner;
  }

  it("requires the caller to have their own profile", async () => {
    const response = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: "DDNA-ABCD-EFGH-JKLM-NPQR" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns only derived data and never the partner's raw answers", async () => {
    await createProfile({
      [cardIds[0]]: { kind: "interest", interest: "yes" },
      [cardIds[1]]: { kind: "interest", interest: "no", details: { hardLimit: true } },
    });
    const partner = await withPartner({
      [cardIds[0]]: { kind: "interest", interest: "yes" },
      [cardIds[1]]: { kind: "interest", interest: "yes" },
    });

    const response = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: partner.body.desireCode }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { comparison: Record<string, unknown> };
    const serialised = JSON.stringify(body);
    expect(body.comparison.answers).toBeUndefined();
    expect(serialised).not.toContain("hardLimit");
    expect(serialised).not.toContain("questionId");
    // Mutual-only is the default, so no difference may be disclosed — not the
    // entries, and not a count of them.
    expect(body.comparison.mode).toBe("mutual_only");
    expect(body.comparison.talkItThrough).toBeUndefined();
    expect(body.comparison.boundaryMismatches).toBeUndefined();
    expect(serialised).not.toContain("sharedBoundaries");
  });

  it("discloses differences only when both profiles opt into full comparison", async () => {
    await createProfile({
      [cardIds[0]]: { kind: "interest", interest: "yes" },
      [cardIds[1]]: { kind: "interest", interest: "no", details: { hardLimit: true } },
    });
    await shareModeRoute.POST(post("http://localhost/api/profile/share-mode", { shareMode: "full_comparison" }));

    const partner = await withPartner({
      [cardIds[0]]: { kind: "interest", interest: "yes" },
      [cardIds[1]]: { kind: "interest", interest: "yes" },
    });

    const oneSided = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: partner.body.desireCode }),
    );
    const oneSidedBody = (await oneSided.json()) as { comparison: { mode: string; boundaryMismatches?: string[] } };
    expect(oneSidedBody.comparison.mode).toBe("mutual_only");
    expect(oneSidedBody.comparison.boundaryMismatches).toBeUndefined();

    // Opt the partner in as well, then compare again.
    const owner = jar.get("ddna_owner") as string;
    jar.set("ddna_owner", partner.cookie as string);
    await shareModeRoute.POST(post("http://localhost/api/profile/share-mode", { shareMode: "full_comparison" }));
    jar.set("ddna_owner", owner);

    const mutual = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: partner.body.desireCode }),
    );
    const mutualBody = (await mutual.json()) as { comparison: { mode: string; boundaryMismatches?: string[] } };
    expect(mutualBody.comparison.mode).toBe("full_comparison");
    expect(mutualBody.comparison.boundaryMismatches).toHaveLength(1);
  });

  it("gives one generic answer for unknown, malformed, and expired codes", async () => {
    await createProfile(keen());
    const partner = await withPartner(keen());

    const malformed = await compareRoute.POST(post("http://localhost/api/compare", { desireCode: "nope" }));
    const unknown = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: "DDNA-ABCD-EFGH-JKLM-NPQR" }),
    );

    // Expire the partner, then reuse their real (previously valid) code.
    const partnerRow = database
      .rows("quiz_profiles")
      .find((row) => row.owner_token_hash !== undefined && row.id !== database.rows("quiz_profiles")[0].id);
    if (partnerRow) partnerRow.expires_at = new Date(Date.now() - 60_000).toISOString();
    const expired = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: partner.body.desireCode }),
    );

    const messages = await Promise.all(
      [malformed, unknown, expired].map(async (response) => {
        expect(response.status).toBe(404);
        return ((await response.json()) as { error: string }).error;
      }),
    );
    expect(new Set(messages).size).toBe(1);
  });

  it("refuses to compare a profile with itself", async () => {
    const own = await createProfile(keen());
    const response = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: own.body.desireCode }),
    );
    expect(response.status).toBe(404);
  });

  it("accepts a partner code pasted without hyphens or in lower case", async () => {
    await createProfile(keen());
    const partner = await withPartner(keen());
    const messy = ` ${(partner.body.desireCode as string).replaceAll("-", "").toLowerCase()} `;

    const response = await compareRoute.POST(post("http://localhost/api/compare", { desireCode: messy }));
    expect(response.status).toBe(200);
  });
});
