# Deployment

Provision Supabase, apply the timestamped migration, and verify anon/authenticated cannot select either table. Put server secrets and public configuration into Vercel, connect the GitHub branch, and deploy. Configure a daily authenticated purge request. Preview-test cookie persistence, create/retrieve/delete, two-profile comparison, expiry, rate limiting, CSP, and mobile accessibility. Never expose the service role or cryptographic keys. Complete legal/vendor review before production. See README for key generation and rotation.

## Before pushing

`npm run check` runs lint, type checking, and the unit/integration suite;
`npm run test:e2e` runs the browser journey against the in-memory stub. A
complete `package-lock.json` is committed, so Vercel's `npm ci` install
succeeds — an incomplete lockfile fails the build before any code runs.

## Cron

`vercel.json` schedules `GET /api/maintenance/purge` daily. Vercel sends
`Authorization: Bearer $CRON_SECRET`; any external scheduler must send the same
header. Expired rows are also removed opportunistically after successful API
calls, and expired profiles are never returned even before cleanup runs.

## Diagnosing a misconfigured deployment

`GET /api/health` returns 200 `{"status":"ok"}` when every server variable is
present and usable, and 503 with the names of whatever is missing or invalid
otherwise. It returns names and reasons only — never a value — and touches
neither the database nor any profile. Profile creation returns the same list in
`missingConfiguration` / `invalidConfiguration`, which the quiz renders, so the
failure names its own cause rather than dead-ending.

Environment variables apply at build time on Vercel: after adding them, trigger
a new deployment, or the running one keeps its old (empty) values.

## Manual checklist

### Vercel

1. Framework preset: **Next.js**. Node.js version **24.x**, matching the README
   and the CI workflow.
2. Install command `npm ci`, build command `npm run build`. The lockfile is
   committed and must stay committed — `npm ci` fails without it.
3. Add every variable from `.env.example` under **Settings → Environment
   Variables**. Server secrets must never carry the `NEXT_PUBLIC_` prefix.
4. Use **separate values for Preview and Production**, pointing at separate
   Supabase projects. A preview deployment must never read production profiles.
5. Set `NEXT_PUBLIC_APP_URL` to the canonical production URL and
   `NEXT_PUBLIC_PRIVACY_CONTACT` to a real contact.
6. Leave `NEXT_PUBLIC_ENABLE_RACE_SENSITIVE_ITEMS` unset or `false`.
7. Leave both Turnstile keys unset until you have tested the widget end to end
   on a preview deployment; the server rejects one key without the other.
8. Redeploy after any variable change — a running deployment keeps the values it
   was built with.
9. Verify: `curl -I https://<app>/results` shows `cache-control: no-store` and
   `x-robots-tag: noindex`, and `GET /api/health` returns `{"status":"ok"}`.

### Supabase

1. Apply both migrations in order, from `supabase/migrations/`, via
   `supabase db push` or the SQL editor.
2. Confirm RLS is on and the client roles have nothing:
   ```sql
   select relname, relrowsecurity from pg_class
    where relname in ('quiz_profiles','rate_limit_events');
   select grantee, privilege_type from information_schema.role_table_grants
    where table_name in ('quiz_profiles','rate_limit_events');
   ```
   Both tables must show `relrowsecurity = true` and no grants to `anon` or
   `authenticated`.
3. Confirm the limiter function is not callable by clients:
   ```sql
   select proname, proacl from pg_proc where proname = 'consume_rate_limit';
   ```
4. Choose the database region deliberately and review the provider's backup
   retention — see the note on deletion below.

### Cron

`vercel.json` already schedules `GET /api/maintenance/purge` daily at 03:17 UTC.
Verify it rather than adding a second job. To test authorization:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/maintenance/purge   # 200 with counts
curl -i https://<app>/api/maintenance/purge                                          # 401
```

### GitHub

`.github/workflows/ci.yml` runs install, lint, type checking, tests, build, and
the browser suite with `permissions: contents: read` and synthetic secrets.

Recommended repository settings (a maintainer has to apply these; they were not
changed for you):

- Require a pull request before merging to `main`.
- Require the `checks` and `e2e` jobs to pass.
- Require conversations to be resolved.
- Block force pushes and deletion of `main`.
- Enable Dependabot alerts and secret scanning.

For a solo maintainer, leave "required approvals" at 0 — requiring a second
reviewer would make merging impossible.

## What deletion and expiry actually mean

Three separate things, and the docs should not blur them:

1. **Access ends immediately.** Every read filters on `expires_at > now()` and
   `revoked_at is null`, so an expired or deleted profile stops resolving the
   moment it expires, before any cleanup runs.
2. **Rows are removed** by the scheduled purge, and opportunistically after a
   successful profile creation. Deletion by the owner removes the row straight
   away.
3. **Provider backups persist longer.** Supabase keeps point-in-time backups on
   its own schedule; a deleted row can survive there until those backups roll
   over. Say so honestly rather than claiming instant erasure everywhere.

## Rotating the encryption key

Records store the key version they were written with.

1. Generate a new key and set `PROFILE_ENCRYPTION_KEY` to it, raising
   `PROFILE_ENCRYPTION_KEY_VERSION` by one.
2. Keep the previous key available as `PROFILE_ENCRYPTION_KEY_V<old version>`.
3. Redeploy. New records use the new key; existing records keep decrypting with
   the old one.
4. Remove the old key only once every record written under it has expired — at
   most 30 days.
