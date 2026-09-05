# Question bank

`src/data/questions.ts` is versioned source-of-truth data. Stable IDs must never be reused with changed meaning; release a new quiz version instead. Standard options encode explicit interest scores, hard boundaries, and exclusion. Skips and `prefer_not_to_answer` are absent from scoring/comparison. Category means are calculated first so large categories cannot dominate. Communication is reported separately from Adventure Index. Adult-media taxonomy is curated; the race/ethnicity-sensitive item is non-scoring, non-comparing, tagged, and feature-disabled by default.

## Roles and intensity

`role` is derived from the topic wording so giving, receiving, watching, and
being-watched variants stay distinguishable in the data model, and `intensity`
is assigned per category. Both are metadata: neither affects scoring today.

## Tests

`tests/question-bank.test.ts` enforces unique stable IDs and sort order,
required categories, a minimum bank size, complete metadata, valid answer
values, role coverage, and the absence of forbidden framing (age-related terms,
non-consent, breath play, and the other excluded topics) across the bank and the
media taxonomy.
