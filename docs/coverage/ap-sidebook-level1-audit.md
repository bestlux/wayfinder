# AP And Side-Book Level 1 Audit

This audit maps non-core PF2E level-1 content against Wayfinder's current rule-support seams.

It is intentionally content-shape focused. The goal is not bespoke Adventure Path support; it is to decide which side-book and AP rule patterns already fit the generic Wayfinder workflows, which reasonable patterns deserve new generic support, and which content should stay PF2E-native or manual for now.

## Evidence Source

- Audit source: local PF2E pack data
- Audit date: 2026-05-08
- Core/default excluded from this pass: `Pathfinder Player Core`, `Pathfinder Player Core 2`, `Pathfinder Core Rulebook`, `Pathfinder Advanced Player's Guide`, and `Pathfinder Beginner Box: Hero's Handbook`
- Non-core scope counted: `1,434` level-1-relevant documents
- Generated scratch evidence was used during the audit and intentionally not retained in the repo.

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
| Static UUID grant choices | Guided for feat/class-feature UUID lists with supported predicates | 14+ | `Wanderlust`, `Sponsored by a Stranger`, `Old-Blood Vishkanya`, `Steadfast Tanuki`, `School of Rooted Wisdom`, `Molten Wit` | Explicit UUID allowlists are represented as grant-choice steps instead of PF2E popups or generic singleton choices, with option-level filtering for the supported predicate subset. |
| Feat-owned innate spell choices | Guided for current supported innate cantrip shape | 2 | `Arcane Tattoos`, `Dragon Spit` | Works when the feat exposes the innate arcane cantrip shape already handled by the spell-choice seam. |

## Newly Supported Shape

This audit found a small, generalizable gap: static `ChoiceSet` arrays of explicit compendium item UUIDs followed by a matching `GrantItem`.

Wayfinder now supports this when:

- the `ChoiceSet` values are compendium item UUIDs
- the matching `GrantItem` references `rulesSelections.<flag>`
- the choices are either unpredicated or gated by supported static-grant predicates
- the target pack maps to a supported item type, currently feats, class features, or deities

Supported static-grant predicates currently include item predicates, actor ancestry/class predicates, actor skill-rank predicates, and active roll options created by earlier drafted `ChoiceSet` selections. This covers Molten Wit-style static feat grants without item-name special cases.

Covered by this new path:

| Bucket | Content | Granted choices |
| --- | --- | --- |
| AP / player guide backgrounds | `Corpse Stitcher`, `Dreams of Vengeance`, `Lost Loved One`, `Sense of Belonging`, `Total Power`, `Wanderlust`, `Wish for Riches`, `Sponsored by a Stranger`, `Verduran City Folk` | Explicit feat pairs such as deviant feats or skill feats |
| Lost Omens backgrounds | `Professional Letter Writer` | Explicit skill feat pair |
| Lost Omens heritages | `Old-Blood Vishkanya`, `Steadfast Tanuki` | Explicit skill or ancestry feat pair |
| Lost Omens class features | `School of Rooted Wisdom`, `School of Thassilonian Rune Magic` | Explicit class-feature branch lists |

## Live Static UUID Grant Smoke

Live smoke was run in Foundry on 2026-05-08 after rebuilding the module.

| Case | Actor | Flow | Expected grant options | Result | Placement / close evidence |
| --- | --- | --- | --- | --- | --- |
| AP / player-guide background | `WF Static 002` | Human / Aiuvarin / `Wanderlust` / Fighter | `Overclock Senses`, `Titan Swing` | Pass | Selected `Titan Swing`; PF2E placed the granted deviant feat under bonus feats with its nested grants, normal ancestry/class/skill feats landed in their sheet sections, Wayfinder closed after Foundry `DialogV2` confirmation, and no PF2E-native choice popup appeared. |
| Lost Omens heritage | `WF Static 001` | Tanuki / `Steadfast Tanuki` / Acolyte / Fighter | `Everyday Form`, `Teakettle Form` | Pass | Selected `Everyday Form`; `Tanuki Lore`, `Sudden Charge`, `Student of the Canon`, and `Everyday Form` appeared on the Feats tab in the expected sections, Wayfinder closed, and no PF2E-native choice popup appeared. |
| Lost Omens class-feature branch | `WF Static 003` | Human / Aiuvarin / Acolyte / Wizard / `School of Rooted Wisdom` | `Cascade Bearers`, `Emerald Boughs`, `Rain-Scribes`, `Tempest-Sun Mages`, `Uzunjati` | Pass after small fix | Selected `Cascade Bearers`; the branch fed the curriculum spell step with `Alarm`, `Force Barrage`, and `Mystic Armor`, then applied cleanly. The sheet nested `Cascade Bearers` under `School of Rooted Wisdom` in Class Features, and Wayfinder closed without a PF2E-native choice popup. |

Live smoke also exposed two audit-sized regressions that are now covered:

- Native `window.confirm` blocked browser-driven smoke at apply time. Wayfinder now uses Foundry `DialogV2.confirm` when available, with an async lifecycle test.
- Static class-feature grant selections need to be available as planning context before PF2E creates the native granted item. Wayfinder now feeds drafted class-feature grant documents into spell-step construction without treating them as ordinary feat sources.

## Live Predicate-Gated Static UUID Grant Smoke

Live smoke was run in Foundry on 2026-05-09 after rebuilding the module.

| Case | Actor | Flow | Expected grant options | Result | Placement / close evidence |
| --- | --- | --- | --- | --- | --- |
| Lost Omens ancestry feat | `WF Predicate 002` | Human / Naari / Acolyte / Fighter / `Molten Wit`; selected `Deception` in the source skill choice | `Charming Liar` only | Pass after small fix | The `Molten Wit feat grant` step stayed hidden until the source skill choice was drafted, then rendered one option. Selected `Charming Liar`; apply closed Wayfinder, no PF2E-native choice popup appeared, `Molten Wit` landed in Ancestry Feats, and `Charming Liar` was nested under it. `Sudden Charge` landed in Class Feats. |

Live smoke exposed one predicate-timing regression that is now covered:

- Predicate-gated static grants that reference a source-owned roll option must not render before that source choice exists in the draft. Wayfinder now delays those grant steps until the source roll-option selection has been drafted, preventing an earlier dead step with zero legal options.

## Reasonable But Not Audit-Sized

These shapes are supportable, but they need a larger design slice than this audit should absorb.

| Gap | Examples | Why deferred |
| --- | --- | --- |
| Equipment-derived predicate context for static grant choices | `Weapon Innovation` | Molten Wit-style active roll-option predicates are supported. Weapon Innovation also needs selected-weapon item context such as weapon category, group, traits, and handedness before all options can be guided safely. |
| Static equipment grants | `Armor Innovation` | The live all-class smoke now proves the Armor Innovation path, including nested armor and modification choices. Other equipment-derived predicates still need content-specific audit before broad claims. |
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

1. Audit selected-item and equipment-derived roll-option contexts before widening Weapon Innovation-style initial-modification support.
2. Add a generic config catalog resolver if `Samsaran Weapon Memory` is worth bringing into guided scope.
3. Add item-pack support for non-feat static grants only after an equipment/class-feature grant acceptance test proves the apply path.
4. Build side-book class contributors one class at a time, starting with the class whose level-1 choices are most structurally regular.
5. Revisit the 42 multiple-`ChoiceSet` canaries after side-book class contributors and selected-item predicate context exist.

## Validation

Targeted checks added with this audit:

- `tests/wayfinder-grant-choice-step-builders.test.ts` covers AP static UUID feat grants, static UUID class-feature grants, and predicate-gated static UUID grants.
- `tests/grant-choice-service.test.ts` covers delaying source-roll-option-gated static grants until the upstream rule choice is drafted.
- `tests/pack-options.test.ts` covers explicit UUID allowlist filtering against Foundry-style ID UUIDs, PF2E source-data name UUIDs, active roll-option predicates, and skill-rank predicates.
- `tests/wayfinder-option-context-service.test.ts` covers active roll-option context from drafted training rule choices.
- `tests/wayfinder-selection-invalidation-service.test.ts` covers stale grant-choice invalidation when a source item's upstream rule selection changes.
- `tests/wayfinder-singleton-rule-discovery.test.ts` covers skipping grant selector `ChoiceSet`s so grant-choice owns them.
- `tests/actor-updater-integration.test.ts` covers leaving static UUID feat grants to PF2E native `GrantItem` creation.
- `tests/actor-updater-selection-application.test.ts` covers apply-side preseeding for predicate-gated static grant choices.
- `tests/wayfinder-draft-lifecycle-service.test.ts` covers async Foundry confirmation before apply-side mutation.
- `tests/wayfinder-spell-choice-step-builders.test.ts` covers merging static class-feature branch curriculum into wizard spell-choice steps.
- `tests/wayfinder-plan-builder-service.test.ts` covers passing drafted static class-feature grant documents into spell planning.

Full gate passed after the live-smoke fixes: `npm run check`.
