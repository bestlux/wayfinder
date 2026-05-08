# AP And Side-Book Level 1 Audit

This audit maps non-core PF2E level-1 content against Wayfinder's current rule-support seams.

It is intentionally content-shape focused. The goal is not bespoke Adventure Path support; it is to decide which side-book and AP rule patterns already fit the generic Wayfinder workflows, which reasonable patterns deserve new generic support, and which content should stay PF2E-native or manual for now.

## Evidence Source

- Audit source: `D:\Source\pf2e\packs\pf2e`
- Audit date: 2026-05-08
- Core/default excluded from this pass: `Pathfinder Player Core`, `Pathfinder Player Core 2`, `Pathfinder Core Rulebook`, `Pathfinder Advanced Player's Guide`, and `Pathfinder Beginner Box: Hero's Handbook`
- Non-core scope counted: `1,434` level-1-relevant documents
- Generated scratch evidence: `.tmp/ap-sidebook-audit-summary.json` and `.tmp/ap-sidebook-wayfinder-support.json`

## Content Inventory

| Content kind | Lost Omens | Rulebook side-book | AP / OP / player guides | Unknown | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ancestries | 24 | 9 | 1 | 0 | 34 |
| Heritages | 162 | 48 | 6 | 0 | 216 |
| Backgrounds | 133 | 101 | 192 | 0 | 426 |
| Ancestry feats | 279 | 87 | 12 | 0 | 378 |
| Class feats | 10 | 89 | 2 | 0 | 101 |
| General feats | 0 | 0 | 2 | 0 | 2 |
| Skill feats | 7 | 4 | 5 | 0 | 16 |
| Miscellaneous feats | 0 | 4 | 0 | 0 | 4 |
| Classes | 0 | 11 | 0 | 0 | 11 |
| Class features | 36 | 189 | 21 | 0 | 246 |

## Current Coverage Matrix

| Wayfinder seam | Current result | Count | Representative content | Notes |
| --- | --- | ---: | --- | --- |
| Pick item / PF2E-native effects | Works when no guided creation choice is needed | 845 | passive ancestries, heritages, feats, and class features | Wayfinder can select the item. PF2E owns passive rule elements, roll options, effects, and later-use behavior. |
| Skill-training and lore discovery | Guided | 524 | AP backgrounds, Lost Omens backgrounds, many ancestry feats | Covers structured `trainedSkills`, skill `ChoiceSet`s, `ActiveEffectLike` skill ranks, fixed lore, custom lore, and Additional Lore text shapes already supported by the training seam. |
| Generic singleton choices | Guided when structured as flat non-grant `ChoiceSet`s | 44 | `Automaton`, `Fleshwarp`, `Mottle-Coat Centaur`, `Magical Experiment`, `Toymaker`, `Elemental Wrath` | Grant selector `ChoiceSet`s are now excluded so they are not duplicated as singleton steps. |
| Filtered grant choices | Guided when structured as filtered item `ChoiceSet` plus `GrantItem` | 26 | `Nascent`; many rulebook side-book class-feature grants | Existing grant-choice seam handles predicates, dependency timing, and apply-side preselection. |
| Static UUID grant choices | Guided for non-predicate feat/class-feature UUID lists | 14 | `Wanderlust`, `Sponsored by a Stranger`, `Old-Blood Vishkanya`, `Steadfast Tanuki`, `School of Rooted Wisdom` | New in this audit: explicit UUID allowlists are represented as grant-choice steps instead of PF2E popups or generic singleton choices. |
| Feat-owned innate spell choices | Guided for current supported innate cantrip shape | 2 | `Arcane Tattoos`, `Dragon Spit` | Works when the feat exposes the innate arcane cantrip shape already handled by the spell-choice seam. |

## Newly Supported Shape

This audit found a small, generalizable gap: static `ChoiceSet` arrays of explicit compendium item UUIDs followed by a matching `GrantItem`.

Wayfinder now supports this when:

- the `ChoiceSet` values are compendium item UUIDs
- the matching `GrantItem` references `rulesSelections.<flag>`
- the choices are not individually predicate-gated
- the target pack maps to a supported item type, currently feats, class features, or deities

Covered by this new path:

| Bucket | Content | Granted choices |
| --- | --- | --- |
| AP / player guide backgrounds | `Corpse Stitcher`, `Dreams of Vengeance`, `Lost Loved One`, `Sense of Belonging`, `Total Power`, `Wanderlust`, `Wish for Riches`, `Sponsored by a Stranger`, `Verduran City Folk` | Explicit feat pairs such as deviant feats or skill feats |
| Lost Omens backgrounds | `Professional Letter Writer` | Explicit skill feat pair |
| Lost Omens heritages | `Old-Blood Vishkanya`, `Steadfast Tanuki` | Explicit skill or ancestry feat pair |
| Lost Omens class features | `School of Rooted Wisdom`, `School of Thassilonian Rune Magic` | Explicit class-feature branch lists |

## Reasonable But Not Audit-Sized

These shapes are supportable, but they need a larger design slice than this audit should absorb.

| Gap | Examples | Why deferred |
| --- | --- | --- |
| Predicate-gated static grant choices | `Molten Wit`, `Weapon Innovation` | Need option-level predicate evaluation against earlier drafted rule selections and actor roll options. Showing all UUID choices would be wrong. |
| Static equipment grants | `Armor Innovation` | Needs item-type and pack support beyond feats/class features, plus apply-side confidence for equipment grants. |
| Config-backed non-skill catalogs | `Samsaran Weapon Memory` using `choices.config = "baseWeaponTypes"` | Needs a generic config catalog resolver beyond the current skills-oriented support. |
| Multiple connected `ChoiceSet` chains | 42 non-core docs, including Season of Ghosts backgrounds, kineticist gates, inventor innovations, and War of Immortals class features | Needs graph-like choice dependency handling, stale-selection clearing, and stronger predicate vocabulary. |
| Full side-book class subsystems | `Animist`, `Commander`, `Exemplar`, `Guardian`, `Gunslinger`, `Inventor`, `Kineticist`, `Magus`, `Psychic`, `Summoner`, `Thaumaturge` | Generic class-feature discovery catches some selectors, but these classes need class-specific contributors before Wayfinder can claim deep support. |

## PF2E-Native Or Manual For Now

These should not be pulled into Wayfinder yet:

- passive feats, heritages, ancestries, and class features where PF2E item rules apply after selection
- AP-specific story, campaign, or organization context that is not expressed as structured level-1 rules
- starting gear, purchasing, daily preparations, and other non-creation decision surfaces
- optional campaign systems such as Free Archetype
- content requiring bespoke AP policy instead of a reusable rule-shape seam

## Prioritized Follow-Up List

1. Live-smoke static UUID grants in Foundry: `Wanderlust`, `Sponsored by a Stranger`, `Old-Blood Vishkanya`, and one Rival Academies school branch.
2. Add predicate-aware option filtering for static grant choices, then cover `Molten Wit` before touching larger class-feature chains.
3. Add a generic config catalog resolver if `Samsaran Weapon Memory` is worth bringing into guided scope.
4. Add item-pack support for non-feat static grants only after an equipment/class-feature grant acceptance test proves the apply path.
5. Build side-book class contributors one class at a time, starting with the class whose level-1 choices are most structurally regular.
6. Revisit the 42 multiple-`ChoiceSet` canaries after predicate-aware grant choices and side-book class contributors exist.

## Validation

Targeted checks added with this audit:

- `tests/wayfinder-grant-choice-step-builders.test.ts` covers AP static UUID feat grants, static UUID class-feature grants, and skips predicate-gated static UUID grants.
- `tests/pack-service.test.ts` covers explicit UUID allowlist filtering against Foundry-style ID UUIDs and PF2E source-data name UUIDs.
- `tests/wayfinder-singleton-rule-discovery.test.ts` covers skipping grant selector `ChoiceSet`s so grant-choice owns them.

The default level-1 regression gate still needs to pass before this audit is complete.
