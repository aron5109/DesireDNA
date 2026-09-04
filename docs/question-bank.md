# Question bank

`src/data/questions.ts` is versioned source-of-truth data. Stable IDs must never be reused with changed meaning; release a new quiz version instead. Standard options encode explicit interest scores, hard boundaries, and exclusion. Skips and `prefer_not_to_answer` are absent from scoring/comparison. Category means are calculated first so large categories cannot dominate. Communication is reported separately from Adventure Index. Adult-media taxonomy is curated; the race/ethnicity-sensitive item is non-scoring, non-comparing, tagged, and feature-disabled by default.
