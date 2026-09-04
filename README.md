# DesireDNA

DesireDNA is a production-oriented, mobile-first private preference and shared-interest alignment quiz for consenting adults 18+. It creates no public profiles and stores no media.

> **Before any public or commercial launch:** obtain specialist legal and privacy review. Sexual-preference data can be highly sensitive, and obligations vary by jurisdiction. This repository is engineering work, not a compliance certification.

## Safety model

Every participant must be 18+, capable, voluntary, sober enough to consent, informed about observation or recording, and able to stop at any time. A match never represents consent. Hard limits are never an invitation to persuade. The curated bank excludes illegal/non-consensual material and dangerous-act instructions.

## Stack and local setup

Node.js 20.9+, Next.js App Router, strict TypeScript, React, Tailwind, Zod, server-only Supabase JS, AES-256-GCM, and Vitest.

```bash
npm ci
cp .env.example .env.local
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

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

## Privacy lifecycle

The server creates a 256-bit owner token in an HttpOnly, Secure-in-production, SameSite=Strict cookie. It stores only separate HMAC hashes for ownership and code lookup. The complete answer/result/code payload is AES-256-GCM encrypted. Selected expiry is at most 30 days; reads exclude expired/revoked rows, owner deletion hard-deletes immediately, and the purge route performs physical cleanup.

## Vercel, cron, and Turnstile

1. Import the GitHub repository in Vercel and select Next.js.
2. Add every variable above to Production/Preview as appropriate. Secrets must never be `NEXT_PUBLIC_`.
3. Schedule `GET /api/maintenance/purge` daily and send `Authorization: Bearer $CRON_SECRET` (Vercel Cron or an external scheduler).
4. If enabling Turnstile, create a widget for the deployment domains and configure both keys. Complete server verification before public launch; the UI fields are reserved but no production bypass exists.
5. Deploy a preview, run mobile/keyboard checks, confirm CSP and no-store headers, test expiry/deletion, and inspect logs for sensitive-data absence.

## Manual pre-launch checklist

- Legal review of consent, privacy notice, terms, sensitive-data processing, age gate, retention, and relevant jurisdictions.
- Threat model and external security review; rotate all staging secrets before production.
- Configure privacy/security contact, Supabase backups/region/access, abuse response, Turnstile verification, monitoring without intimate metadata, and cron alerting.
- Verify owner-cookie behavior over HTTPS, database role grants, rate limits, restoration/deletion behavior, accessibility (WCAG 2.2 AA), and 360–430 px layouts.
- Confirm operator policies with Vercel, Supabase, and Cloudflare for this data category.

See `docs/` for architecture, security, question-bank, and deployment details.
