# Security and privacy model

AES-256-GCM provides payload confidentiality and authentication with a fresh 96-bit IV. Separate HMAC-SHA-256 keys isolate owner, share-code, and rotating request-identity domains. Codes contain 80 bits of randomly selected symbol entropy; owner tokens contain 256 random bits. Raw inputs, codes, answers, keys, results, and comparisons must never be logged. Sensitive responses are `no-store`; pages are noindexed and framed content is blocked. RLS plus revoked client grants provides defense in depth.

Current limitations: infrastructure still observes request metadata; age is self-attested; browser/server compromise can expose data in use; the single-key implementation requires the documented multi-key migration before rotation; and Turnstile must stay disabled until its browser widget and CSP entry are implemented (the server check is enforced, so setting only the secret blocks every comparison). Rate limiting is database-backed but requires operational tuning.

## Content Security Policy

The production policy is `default-src 'self'` with no external origins;
`'unsafe-inline'` remains for scripts because the App Router injects inline
hydration data, and moving to nonces is tracked work. React's development build
requires `eval`, so `'unsafe-eval'` and a websocket connect-src are added only
when `NODE_ENV !== "production"` — without that, `next dev` serves a page that
never hydrates.

## Rate limiting

Keyed on a daily-rotating HMAC of the request identity; raw IPs are never
stored. Storage failures are logged and allowed through, because a broken
counter must not cost a consenting adult the result they just produced.
Configuration errors still fail closed.
