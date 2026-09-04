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
