# DesireDNA

DesireDNA is a production-oriented, mobile-first private preference and shared-interest alignment quiz for consenting adults 18+. It creates no public profiles and stores no media.

> **Before any public or commercial launch:** obtain specialist legal and privacy review. Sexual-preference data can be highly sensitive, and obligations vary by jurisdiction. This repository is engineering work, not a compliance certification.

## Safety model

Every participant must be 18+, capable, voluntary, sober enough to consent, informed about observation or recording, and able to stop at any time. A match never represents consent. Hard limits are never an invitation to persuade. The curated bank excludes illegal/non-consensual material and dangerous-act instructions.

## Stack and local setup

Node.js 24.x (configured in Vercel Project Settings), Next.js App Router, strict TypeScript, React, Tailwind, Zod, server-only Supabase JS, AES-256-GCM, and Vitest. Keep local and hosted builds on the same Node major; `package.json` intentionally does not override the Vercel setting. The audited native install scripts for `esbuild` and `unrs-resolver` are explicitly allowed in `package.json`.

```bash
npm ci                 # a complete package-lock.json is committed
cp .env.example .env.local
npm run dev            # http://localhost:3000
npm run check          # lint + typecheck + unit/integration tests
npm run build
```

Individual commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

### End-to-end tests

`npm run test:e2e` drives the whole mobile journey in a real browser: consent
gate, quiz, skipping, the calculation sequence, the result page, a two-person
DesireCode comparison, and deletion. It runs the app against
`tests/e2e/postgrest-stub.mjs`, an in-memory stand-in for Supabase, using
throwaway keys defined in `playwright.config.ts` — no real project or secret is
involved. Install the browser once with `npx playwright install chromium`, or
point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an existing Chromium binary.

The end-to-end run sets `NEXT_PUBLIC_E2E_SHORT_QUIZ=true`, which reduces the
bank to one question per category. That flag is ignored whenever
`NODE_ENV=production`, so it cannot shorten a deployed quiz.

Apply `supabase/migrations/202609040001_initial_schema.sql` in a new Supabase project (CLI `supabase db push`, or the SQL editor), then configure the environment. The migration enables RLS, revokes client roles, and has no public policies. Only the service-role server client is used.

## Environment

| Variable | Purpose / format |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Canonical deployment URL |
| `NEXT_PUBLIC_PRIVACY_CONTACT` | Operator-configured privacy/security contact text |
| `NEXT_PUBLIC_ENABLE_RACE_SENSITIVE_ITEMS` | Keep `false` unless a reviewed deployment intentionally enables it |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key |
| `PROFILE_ENCRYPTION_KEY` | Exactly 32 random bytes, base64 |
| `PROFILE_ENCRYPTION_KEY_VERSION` | Positive integer, initially `1` |
| `SHARE_CODE_HMAC_KEY` | Independent high-entropy base64 secret |
| `OWNER_TOKEN_HMAC_KEY` | Independent high-entropy base64 secret |
| `RATE_LIMIT_HMAC_KEY` | Independent high-entropy base64 secret |
| `CRON_SECRET` | Independent bearer secret |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Optional Cloudflare Turnstile pair |

Generate every secret independently; never reuse values:

```bash
openssl rand -base64 32 # encryption and each HMAC key
openssl rand -base64 48 # CRON_SECRET
```

The encryption key must decode to exactly 32 bytes. Rotation requires retaining old keys by version while records remain, deploying multi-key decryption, re-encrypting active records, and only then retiring the old key. The initial implementation deliberately fails closed for unknown configuration and supports one active key.

## Display aliases

When someone begins the quiz the browser assigns a random, non-identifying
alias such as `Velvet Orchid 4821`, drawn from the fixed word lists in
`src/lib/quiz/alias.ts`. It is shown during the quiz, on the result page, and
beside both people in a comparison. The server re-validates every submitted
alias against those same lists and replaces anything else with a fresh one, so
a partner can never be shown attacker-supplied text. The alias is stored inside
the encrypted payload and carries no personal data.

## Privacy lifecycle

The result page is rendered on the server from the owner cookie, so finishing
the quiz lands directly on the outcome with no client fetch that could fail.
`GET /api/profile` returns the same projection for programmatic use.

The server creates a 256-bit owner token in an HttpOnly, Secure-in-production, SameSite=Strict cookie. It stores only separate HMAC hashes for ownership and code lookup. The complete answer/result/code payload is AES-256-GCM encrypted. Selected expiry is at most 30 days; reads exclude expired/revoked rows, owner deletion hard-deletes immediately, and the purge route performs physical cleanup.

## Vercel, cron, and Turnstile

1. Import the GitHub repository in Vercel and select Next.js.
2. Add every variable above to Production/Preview as appropriate. Secrets must never be `NEXT_PUBLIC_`.
3. `vercel.json` schedules `GET /api/maintenance/purge` daily. Vercel sends `Authorization: Bearer $CRON_SECRET` when that project variable is configured; an external scheduler must send the same header.
4. **Turnstile is not ready to enable.** `/api/compare` verifies a token server-side whenever `TURNSTILE_SECRET_KEY` is set, but the browser widget is not rendered yet and the CSP does not allow Cloudflare's script. Setting the secret today makes every comparison fail with "Verification failed." Leave both keys unset until the widget, the CSP entry, and the token round trip are implemented together.
5. Deploy a preview, run mobile/keyboard checks, confirm CSP and no-store headers, test expiry/deletion, and inspect logs for sensitive-data absence.

## Rate limits

Database-backed, keyed on a daily-rotating HMAC of the request identity — raw
IP addresses are never stored. Current budgets: 12 profile creations per hour,
60 result reads and 10 deletions per 10 minutes, 10 comparison attempts per 10
minutes, and 30 comparisons per profile per day. If the rate-limit table itself
is unreachable the request is allowed and the failure is logged: a broken
counter must not be the reason someone loses the result they just produced.

## Manual pre-launch checklist

- Legal review of consent, privacy notice, terms, sensitive-data processing, age gate, retention, and relevant jurisdictions.
- Threat model and external security review; rotate all staging secrets before production.
- Configure privacy/security contact, Supabase backups/region/access, abuse response, Turnstile verification, monitoring without intimate metadata, and cron alerting.
- Verify owner-cookie behavior over HTTPS, database role grants, rate limits, restoration/deletion behavior, accessibility (WCAG 2.2 AA), and 360–430 px layouts.
- Confirm operator policies with Vercel, Supabase, and Cloudflare for this data category.

See `docs/` for architecture, security, question-bank, and deployment details.
