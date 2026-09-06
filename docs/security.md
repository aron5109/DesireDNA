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

## Comparison formulas and their limits

- **Shared interest** = activities where both people answered "Into it", over
  the activities both answered. Reported only at 8 or more comparable
  activities.
- **Preference similarity** = the average closeness of the two answers per
  activity, on the 0/50/100 interest scale. This one *does* rise when both
  people reject the same things, which is why it is reported separately and
  never called compatibility.
- **Complementary roles** are matched through `activityId` + `role`, so one
  person giving and another receiving is recognised as fitting together, and two
  people in the same role are not.
- Below the threshold both percentages are `null` and the interface says "Not
  enough comparable answers" rather than showing 0%.

Boundary mismatches are evaluated across *every* role pairing for an activity,
so a hard limit recorded against one role cannot be hidden by a different role
matching.

## What mutual-only mode withholds

Nothing about a difference leaves the server: no talk-it-through list, no
boundary mismatches, **no count of them**, and no per-category alignment. An
earlier build leaked the mismatch count through a field labelled "shared
boundaries"; `tests/comparison.test.ts` now asserts that no such value appears
anywhere in the response.

Full comparison additionally suppresses any category aggregate computed from
fewer than three answers, because a one- or two-answer average would expose the
individual answers behind it.

A DesireCode is a lookup credential, not an inference-proof channel: someone who
holds a code learns whatever the permitted comparison shows. Share it only with
an adult you trust.

## Rate limiting

`consume_rate_limit` counts the window and records the attempt inside one
Postgres function, under an advisory lock on the key, so concurrent requests
cannot both observe a count below the limit.

| Operation | Budget | Window | Scope |
|---|---|---|---|
| Create profile | 12 | 1 hour | request address |
| Read result | 60 | 10 minutes | request address |
| Delete | 10 | 10 minutes | request address |
| Compare | 40 | 10 minutes | request address |
| Compare | 60 | 24 hours | owner token |
| Codes that did not match | 20 | 24 hours | owner token |
| Replace code | 5 | 1 hour | owner token |

The owner-scoped budgets key on the owner token, so changing network address
does not reset them. The address itself is only ever a hint: `x-forwarded-for`
can be prepended to by a caller, which is why the per-owner budget exists.

Comparison requires an owner cookie, so the per-profile budget is the real
control and the per-address one is only a coarse flood guard — deliberately
generous, because several people behind one home or office connection share a
single address and a tight limit there punishes them for each other's use
without stopping anyone determined.

Codes that do not resolve have their own tighter budget: guessing is the abuse
worth bounding, not comparing with codes someone was actually given. That budget
is enforced, not merely recorded — an exhausted guessing budget returns 429
rather than another indistinguishable 404.

Identity is a keyed HMAC that rotates daily; no raw address is stored.

**On limiter failure the two paths differ deliberately.** Code lookups fail
closed with 503 — a limiter that cannot be consulted must never become an
unlimited window for guessing at other people's codes. Saving a completed quiz
is allowed through, because losing a limiter must not cost someone the answers
they just spent ten minutes giving.

## Turnstile

Verification runs on the server whenever both keys are configured; one key
without the other is rejected as a misconfiguration. The browser widget requests
a token close to submission and resets after each use, so a token minted at the
start of a long quiz is never relied on. Verification failures are surfaced, never
silently skipped, and the development bypass cannot activate in a production build.
