# Question bank audit — 2026.2 → 2026.3

## Counts

| | 2026.2 | 2026.3 |
|---|---|---|
| Cards in the bank | 169 | 78 |
| Cards on the default path | 169 | 74 |
| Conditional cards (shown only after a gate) | 0 | 4 |
| Required answer decisions | 169 | 0 — every card can be skipped |
| Cards using the 7-option list | 168 | 0 |
| Cards using the three swipe actions | 0 | 61 |
| Single-select cards | 0 | 8 |
| Multi-select cards | 1 | 5 |
| Distinct activities compared | 169 | 61 |

Counts come from `tests/question-bank.test.ts`, which fails if the default path
falls outside 55–80 cards.

## What changed and why

### Identifiers

2026.2 derived ids from array positions (`everyday_07`), so removing or
reordering a topic silently reassigned that id to a different question. 2026.3
uses stable semantic ids (`everyday.initiating`) plus an explicit `activityId`
and `role`. Ids are never reused for a different topic; a changed meaning means
a new id.

Roles were previously inferred with regular expressions over the prompt text.
They are now declared per card.

### Consolidated duplication

| Removed / merged (2026.2) | Now (2026.3) | Reason |
|---|---|---|
| `anal_08` anal plugs, `anal_09` other anal toys, `toys_03` anal plugs | `anal.toys` | The same equipment appeared in two categories and as two near-identical cards. |
| `power_06` hand restraints, `power_07` handcuffs, `power_08` rope bondage, `power_09` being restrained | `power.restraint_receiving` + optional `power.restraint_equipment` | Four consecutive cards about one activity. The role distinction is kept (`power.restraint_giving`); equipment moved to an optional conditional card. |
| `power_23` safe words, `communication_03` using a safe word | `comm.safe_word` | Duplicated across two categories. Kept in Communication, where it is scored separately. |
| `power_24`/`power_25` aftercare, `communication_11` aftercare | `comm.aftercare` | Same duplication. |
| `everyday_16`/`everyday_17` praise, `power_21` praise-oriented dynamics | `everyday.praise` | Praise appeared in both categories. |
| `anal_12`, `anal_13`, `groups_14` double penetration | `groups.double_penetration` | Three cards for one activity. |
| `watching_05`/`groups_15` watching a partner with another adult; `watching_06`/`groups_16` a partner watching you | `groups.partner_with_other`, `groups.watched_with_other` | Identical pairs across two categories. Both roles kept, once each. |
| `groups_06` same-room, `groups_07` couple swapping, `groups_08` swinging | `groups.swinging` | Three labels for one arrangement. |
| `watching_11`–`watching_15` five recording cards | `watching.recording_together`, `watching.being_recorded`, `watching.recording_partner` | Recording, being recorded, and recording someone are genuinely different, so three remain. Near-identical wordings were dropped. |
| `everyday_19`/`everyday_20` sending and receiving images | `everyday.intimate_images` | An exchange in practice; one card with a consent note. |
| `power_14` hair pulling, `power_15` scratching, `power_16` biting | `power.rough_sensation` | One sensation family. |
| `toys_01` vibrators, `toys_02` dildos, `toys_05` remote toys | `toys.types` (multi-select) | Equipment list, better as chips than three swipes. |
| `everyday_08` quick encounters, `everyday_09` long sessions | `everyday.session_length` (single-select) | A pace preference, not a measure of adventurousness. |
| `oral_04`/`oral_05` face-sitting both ways | `oral.face_sitting` | Kept as one card covering either direction. |
| `everyday_22`–`everyday_25` shower/hotel/car/outdoor | `everyday.places` (multi-select) | Four swipes for one question about location. |
| `physical_03`–`physical_08` six position cards | `physical.positions` (multi-select) | A list, not six separate preferences. |
| `communication_01`–`communication_17` seventeen cards | five `comm.*` cards | The rest were non-negotiable consent expectations (respecting a stop, sober consent, permission to record). Those moved into the opening consent screen, where they are stated rather than offered as preferences. |
| `watching_14` watching a recording back, `physical_17` eye contact, `physical_09` gentle pace | removed | Lower value than the cards they sat beside. |

### Role distinctions kept

These were **not** merged, because the two sides are different questions:
giving/receiving oral, giving/receiving anal fingering, giving/receiving anal
penetration, giving/receiving rimming, dominant/submissive, restraining/being
restrained, blindfolding/being blindfolded, spanking/being spanked, wearing a
strap-on/partner wearing one, using toys on a partner/a partner using them,
watching/being watched, recording/being recorded, initiating/being pursued,
guiding/being guided, giving/receiving watersports, on top/partner on top.

### Controls matched to the question

`everyday.frequency` and `everyday.session_length` are single-selects; timing,
places, positions, toy types, restraint equipment, threesome make-up, and the
media taxonomy are multi-selects with an explicit "None of these"; the
communication cards use a comfort scale. Only genuine preference questions use
the three swipe actions.

### Conditional cards

`power.restraint_equipment`, `groups.threesome_shape`, `media.categories`, and
the flagged `media.ethnicity` appear only after their gate is answered a
particular way. A card that was never shown is stored as unasked — the API
rejects an answer to a card whose gate was not met, so a hidden card can never
be read as a "no".

### Sensitive items

`media.ethnicity` stays behind `NEXT_PUBLIC_ENABLE_RACE_SENSITIVE_ITEMS`, which
is off by default, and is `scoringEnabled: false` and `comparisonEnabled: false`
regardless. No new demographic fields were added.

## Version safety

`src/data/bank/v2-frozen.ts` holds the 2026.2 bank unchanged, so existing
profiles still resolve their own ids. `src/data/bank/registry.ts` chooses the
bank by the version stored on the profile.

The two versions record different things — 2026.2 has no separation between
interest and experience — so `versionsAreComparable` returns false across them
and a comparison between a 2026.2 and a 2026.3 profile is refused with a message
that reveals nothing about the other profile. Stored results from 2026.2 keep
displaying, because a saved result is stored in the profile and needs no bank.
