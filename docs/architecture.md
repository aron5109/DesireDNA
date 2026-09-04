# Architecture

The App Router serves public informational pages and noindexed quiz/result/comparison pages. `QuizExperience` keeps unfinished answers only in `sessionStorage`; after submission the server validates IDs/options, computes the authoritative result, encrypts one payload, and clears client progress. Route handlers are the sole sensitive data boundary. Supabase receives ciphertext, lookup HMACs, lifecycle metadata, and pseudonymous rate events. Comparisons decrypt two compatible versions in server memory and return only derived fields allowed by the intersection of both sharing modes; they are never persisted.

## Where the result comes from

`/results` is a server component: it reads the owner cookie, loads and decrypts
the profile, and renders the outcome in the first response. There is no client
fetch on the critical path, so a slow or failing round trip cannot leave someone
staring at a spinner after finishing the quiz. `GET /api/profile` returns the
same projection (result, DesireCode, alias, expiry, sharing mode) for
programmatic use. Neither path ever sends raw answers to the browser.

## Display aliases

`src/lib/quiz/alias.ts` is shared by the browser and the server. The browser
assigns an alias when the quiz starts; the server re-validates it against the
same curated word lists and substitutes a fresh one if it does not match, so
comparison output can never contain attacker-supplied text.

## Failure handling

Server errors are classified rather than collapsed: missing or invalid
configuration returns 503, rejected input returns 400, and storage problems
return 500. `src/lib/server/logging.ts` writes only a scope and an error
identity — a Zod failure is reduced to the names of the invalid fields, because
its default message embeds the offending input.
