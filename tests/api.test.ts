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
let questionIds: string[];

const post = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const get = (url: string) => new NextRequest(url, { method: "GET" });

function submission(answers: { questionId: string; value: string | string[] }[], alias?: string) {
  return {
    ageConfirmed: true,
    explicitContentConfirmed: true,
    storageConsent: true,
    deletionUnderstood: true,
    retentionDays: 7,
    tone: "playful",
    ...(alias ? { alias } : {}),
    answers,
  };
}

/** Creates a profile and returns its response body plus its owner cookie. */
async function createProfile(answers: { questionId: string; value: string | string[] }[], alias?: string) {
  jar.delete("ddna_owner");
  const response = await profileRoute.POST(post("http://localhost/api/profile", submission(answers, alias)));
  const body = (await response.json()) as { desireCode?: string; alias?: string; error?: string };
  const cookie = jar.get("ddna_owner");
  return { status: response.status, body, cookie };
}

beforeAll(async () => {
  profileRoute = await import("@/app/api/profile/route");
  compareRoute = await import("@/app/api/compare/route");
  shareModeRoute = await import("@/app/api/profile/share-mode/route");
  const { questions } = await import("@/data/questions");
  questionIds = questions.map((question) => question.id);
});

beforeEach(() => {
  database.reset();
  jar.clear();
});

describe("POST /api/profile", () => {
  it("stores an encrypted profile and returns the owner's result", async () => {
    const created = await createProfile([{ questionId: questionIds[0], value: "like_it" }]);

    expect(created.status).toBe(201);
    expect(created.body.desireCode).toMatch(/^DDNA-(?:[A-HJ-NP-Z2-9]{4}-){3}[A-HJ-NP-Z2-9]{4}$/);
    expect(created.cookie).toBeTruthy();

    const [row] = database.rows("quiz_profiles");
    expect(row.payload_ciphertext).toBeTruthy();
    // Nothing sensitive may be readable in the stored row.
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(created.body.desireCode as string);
    expect(stored).not.toContain("like_it");
    expect(stored).not.toContain(created.cookie as string);
  });

  it("assigns a random alias when the client does not send one", async () => {
    const created = await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    expect(created.body.alias).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/);
  });

  it("replaces an alias that is not from the curated word list", async () => {
    const created = await createProfile([{ questionId: questionIds[0], value: "like_it" }], "<script>evil</script>");
    expect(created.body.alias).not.toContain("script");
    expect(created.body.alias).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/);
  });

  it("rejects unknown question IDs", async () => {
    const created = await createProfile([{ questionId: "not_a_real_question", value: "like_it" }]);
    expect(created.status).toBe(400);
    expect(database.rows("quiz_profiles")).toHaveLength(0);
  });

  it("rejects answer values a question does not offer", async () => {
    const created = await createProfile([{ questionId: questionIds[0], value: "absolutely_not_an_option" }]);
    expect(created.status).toBe(400);
    expect(database.rows("quiz_profiles")).toHaveLength(0);
  });

  it("rejects a submission without every consent confirmation", async () => {
    const body = { ...submission([{ questionId: questionIds[0], value: "like_it" }]), ageConfirmed: false };
    const response = await profileRoute.POST(post("http://localhost/api/profile", body));
    expect(response.status).toBe(400);
    expect(database.rows("quiz_profiles")).toHaveLength(0);
  });

  it("reports storage failures as a server error rather than bad input", async () => {
    database.failure = "connection refused";
    const response = await profileRoute.POST(
      post("http://localhost/api/profile", submission([{ questionId: questionIds[0], value: "like_it" }])),
    );
    expect(response.status).toBe(500);
  });
});

describe("GET /api/profile", () => {
  it("returns the owner's own result and never caches it", async () => {
    await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    const response = await profileRoute.GET(get("http://localhost/api/profile"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { result: { adventureIndex: number }; answers?: unknown };
    expect(body.result.adventureIndex).toBe(100);
    expect(body.answers).toBeUndefined();
  });

  it("refuses a wrong owner token", async () => {
    await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    jar.set("ddna_owner", "an-owner-token-that-was-never-issued");

    const response = await profileRoute.GET(get("http://localhost/api/profile"));
    expect(response.status).toBe(404);
  });

  it("refuses a request with no owner cookie", async () => {
    await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    jar.delete("ddna_owner");

    const response = await profileRoute.GET(get("http://localhost/api/profile"));
    expect(response.status).toBe(401);
  });

  it("refuses an expired profile even before cleanup has run", async () => {
    await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    database.rows("quiz_profiles")[0].expires_at = new Date(Date.now() - 60_000).toISOString();

    const response = await profileRoute.GET(get("http://localhost/api/profile"));
    expect(response.status).toBe(404);
  });

  it("refuses a revoked profile", async () => {
    await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    database.rows("quiz_profiles")[0].revoked_at = new Date().toISOString();

    const response = await profileRoute.GET(get("http://localhost/api/profile"));
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/profile", () => {
  it("hard-deletes the row and clears the cookie", async () => {
    await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    expect(database.rows("quiz_profiles")).toHaveLength(1);

    const response = await profileRoute.DELETE(new NextRequest("http://localhost/api/profile", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(database.rows("quiz_profiles")).toHaveLength(0);
    expect(jar.get("ddna_owner")).toBeUndefined();
  });
});

describe("POST /api/compare", () => {
  /** Creates a partner profile, then restores the caller's own cookie. */
  async function withPartner(partnerAnswers: { questionId: string; value: string | string[] }[]) {
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
    const answers = [
      { questionId: questionIds[0], value: "like_it" },
      { questionId: questionIds[1], value: "hard_limit" },
    ];
    await createProfile(answers);
    const partner = await withPartner([
      { questionId: questionIds[0], value: "like_it" },
      { questionId: questionIds[1], value: "like_it" },
    ]);

    const response = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: partner.body.desireCode }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { comparison: Record<string, unknown> };
    const serialised = JSON.stringify(body);
    expect(body.comparison.answers).toBeUndefined();
    expect(serialised).not.toContain("questionId");
    expect(serialised).not.toContain("hard_limit");
    // Mutual-only is the default, so no difference may be disclosed.
    expect(body.comparison.mode).toBe("mutual_only");
    expect(body.comparison.talkItThrough).toBeUndefined();
    expect(body.comparison.boundaryMismatches).toBeUndefined();
    expect(body.comparison.sharedBoundaries).toBe(1);
  });

  it("discloses differences only when both profiles opt into full comparison", async () => {
    await createProfile([
      { questionId: questionIds[0], value: "like_it" },
      { questionId: questionIds[1], value: "hard_limit" },
    ]);
    await shareModeRoute.POST(post("http://localhost/api/profile/share-mode", { shareMode: "full_comparison" }));

    const partner = await withPartner([
      { questionId: questionIds[0], value: "like_it" },
      { questionId: questionIds[1], value: "like_it" },
    ]);

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
    await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    const partner = await withPartner([{ questionId: questionIds[0], value: "like_it" }]);

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
    const own = await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    const response = await compareRoute.POST(
      post("http://localhost/api/compare", { desireCode: own.body.desireCode }),
    );
    expect(response.status).toBe(404);
  });

  it("accepts a partner code pasted without hyphens or in lower case", async () => {
    await createProfile([{ questionId: questionIds[0], value: "like_it" }]);
    const partner = await withPartner([{ questionId: questionIds[0], value: "like_it" }]);
    const messy = ` ${(partner.body.desireCode as string).replaceAll("-", "").toLowerCase()} `;

    const response = await compareRoute.POST(post("http://localhost/api/compare", { desireCode: messy }));
    expect(response.status).toBe(200);
  });
});
