# Security and privacy model

AES-256-GCM provides payload confidentiality and authentication with a fresh 96-bit IV. Separate HMAC-SHA-256 keys isolate owner, share-code, and rotating request-identity domains. Codes contain 80 bits of randomly selected symbol entropy; owner tokens contain 256 random bits. Raw inputs, codes, answers, keys, results, and comparisons must never be logged. Sensitive responses are `no-store`; pages are noindexed and framed content is blocked. RLS plus revoked client grants provides defense in depth.

Current limitations: infrastructure still observes request metadata; age is self-attested; browser/server compromise can expose data in use; the single-key implementation requires the documented multi-key migration before rotation; and Turnstile server verification must be completed before enabling it. Rate limiting is database-backed but requires operational tuning.
