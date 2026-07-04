# Level 1 Coverage Matrix

This document tracks what Wayfinder currently guides at level 1, what is only partly guided, and what is still intentionally out of scope.

It is meant to stay grounded in the current repo, not to describe aspirational future behavior.

For the current repo-plus-compendium side-book audit, see [AP And Side-Book Level 1 Audit](./ap-sidebook-level1-audit.md).

## Status Legend

- `Guided`: Wayfinder plans, renders, drafts, invalidates, and applies this flow today.
- `Guided when PF2E rule data is structured`: the workflow exists, but it depends on PF2E item rules exposing a supported shape.
- `Partial / deferred`: Wayfinder helps, but still intentionally relies on PF2E-native workflows or manual interpretation for part of the step.
- `Manual / PF2E-native`: Wayfinder intentionally hands this to the PF2E sheet for now.
- `Not covered`: no dedicated guided workflow yet.

## Audit Evidence

- Static source audit: local PF2E pack data, scoped to `Pathfinder Player Core` and `Pathfinder Player Core 2`.
- Scratch evidence was generated during the audit and intentionally not retained in the repo.
- PC/PC2 inventory from that audit: 16 ancestries, 106 heritages, 63 backgrounds, 16 classes, 163 level-1 class features, 165 level-1 ancestry feats, 102 level-1 class feats, 69 level-1 skill feats, and 14 level-1 general feats.
- Targeted regression evidence added in this audit: class-derived level-1 skill feat planning, projected draft skill training in option context, and skill-feat prerequisite filtering against trained skills and lores.
- All-class live smoke evidence on 2026-05-11: `.wayfinder-smoke/beta-green-0.1.2-final-3` applied every class from the local PF2E class pack inventory from blank level 1 to target level 5 in Foundry 14.360 / PF2E 8.1.1, with 27 passing all-class cases, four passing targeted incremental existing-character reruns, zero duplicate source IDs, zero rerun pending steps, and no classified/manual failures.
- Current upstream target checked on 2026-07-04: Foundry VTT 14.364 and PF2E 8.2.0. The 0.1.6 hotfix passed the full live smoke matrix in `.wayfinder-smoke/2026-07-04T18-00-52Z`, adding live coverage for Natural Ambition visibility, Scholar/Assurance preselection, Animist base spellcasting counts, and selected feat-owned grant choices such as Druid Order Explorer.
- Full repo gate from this audit: `npm run check`.
- Existing live-smoke evidence remains in the AP/side-book audit for static UUID grants, predicate-gated grants, apply-side preseeding, and clean close behavior.

## Level 1 Core Flow

| Area | Status | Current handling | Notes |
| --- | --- | --- | --- |
| Ancestry selection | Guided | Pick-item step | Part of the base progression skeleton. |
| Heritage selection | Guided | Pick-item step | Filtered from drafted ancestry plus versatile heritages. |
| Background selection | Guided | Pick-item step | Planned in the base skeleton. |
| Class selection | Guided | Pick-item step | Planned in the base skeleton. |
| Creation boosts | Guided | Dedicated boost step | Guided inside Wayfinder before the draft is applied. |
| Level 1 ancestry feat | Guided | Pick-item step | Comes from the progression skeleton and filters against ancestry, versatile heritage, and spellcasting-class prerequisites. |
| Level 1 class feat | Guided when the selected class grants one | Class-derived pick-item step | Comes from the selected class document's `classFeatLevels`. |
| Level 1 skill feat | Guided when the selected class grants one | Class-derived pick-item step | Covers Rogue-style level-1 skill feat progression. Skill-feat options are filtered for supported `trained in ...` skill and lore prerequisite text. |
| Class skill training | Guided | Dedicated class-training steps | Covers fixed and rule-driven training choices exposed by PF2E data, including projected background, ancestry, heritage, and feat-granted training. |
| Class branches | Guided when PF2E rule data is structured | Branch-discovery and branch-selection steps | Works when the class exposes selector-style branch rules cleanly. Class archetypes and branch options with embedded `ChoiceSet` rules are filtered unless every embedded choice is covered by an existing guided lane. |
| Class-owned granted selections | Guided when PF2E rule data is structured | Granted-item and class-choice steps | Includes flows like deity-linked or class-linked granted selections when discoverable from rules. |
| Class-owned spell choices | Guided when PF2E rule data is structured | Shared caster profiles plus class contributor seam | Current live matrix covers prepared, spontaneous, bounded, and spellbook families for one deterministic level 1-5 path per PF2E class. Daily preparation and untested branch variants remain PF2E-native/manual. |
| Singleton `ChoiceSet` decisions from ancestry, heritage, background, class, deity, or selected feat sources | Guided when PF2E rule data is structured | Generic singleton-choice workflow | Supports planning, draft storage, invalidation, and apply-side persistence for supported `ChoiceSet` rules. |
| Non-class filtered feat grants | Guided when PF2E rule data is structured | Grant-choice workflow | Covers filtered `ChoiceSet` plus `GrantItem` paths such as Ancient Elf, Versatile Human, Nascent, General Training, and Natural Ambition. |
| Static UUID-backed grants | Guided when PF2E rule data is a UUID list with supported predicates | Grant-choice workflow with explicit UUID allowlists and predicate-aware option filtering | Covers AP/player-guide background feat pairs, side-book heritage feat pairs, selected class-feature branch lists, and Molten Wit-style active roll-option gates that use static compendium UUID choices. |
| Bonus languages after creation boosts | Guided | Dedicated language-choice step | Uses effective post-boost state, so the final Intelligence modifier can affect count. |
| Background or ancestry lore choices | Guided when PF2E rule data is structured | Generic singleton-choice or skill-training workflow | Works when PF2E expresses the choice as a supported singleton `ChoiceSet`, lore training rule, or supported text shape. |
| Background or ancestry free-skill choices | Guided when PF2E rule data is structured | Generic singleton-choice workflow plus training projection where a skill-rank rule exists | Some choices only persist the rules selection; they do not always imply a skill rank by themselves. |
| Level 1 rarity and source filtering while picking | Guided | Composable picker filters | Available in the selection panes as UI filtering, not as separate progression steps. |
| Existing level-1 actor re-open / draft resume | Guided with test coverage | Existing selection readers plus actor flags | Existing selections are read to skip already-resolved singleton, branch, class-choice, grant-choice, language, and spell-choice steps when possible. |
| Reset or re-run after upstream changes | Guided with test coverage | Draft invalidation and recently-invalidated step markers | Supported for the rule shapes already represented in the draft model. |
| Level 1 skill increases | Partial / deferred | Dedicated checkpoint step | Wayfinder tracks the milestone and applies drafted increases, but this is not a blank-character level-1 decision. |
| Starting gear or item purchasing | Not covered | None | Still outside the guided creation flow. |
| Daily preparations | Not covered | None | Still intentionally out of scope. |
| Optional campaign systems such as Free Archetype | Manual / PF2E-native | None | Free Archetype starts at level 2 and needs a separate PF2E `archetype` feat-group implementation before Wayfinder can guide it. |

## Launch-Readiness Matrix

| Track | Scenario | Setup | Action | Expected outcome | Evidence | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| Default path | PC/PC2 ancestry, heritage, and class inventory | Blank actor, PC/PC2 packs represented in fixture data | Build plan and picker options | Baseline ancestries, heritages, classes, and effective build state resolve | `tests/wayfinder-level1-breadth.test.ts` | merge |
| Default path | Martial creation with background lore and post-boost class training | Human / Acolyte / Fighter-style path | Draft boosts, training, and apply | Fixed and chosen skills plus lore apply once, no spell steps appear | `tests/wayfinder-golden-path-integration.test.ts` | merge |
| Default path | Rogue-style level-1 skill feat | Class document has `skillFeatLevels.value = [1, ...]` | Build class-derived skill feat steps | `skill-feat-level-1` appears and skips if already fulfilled | `tests/class-choice-service.test.ts` | merge |
| Default path | Level-1 skill feat filtering | Drafted training gives skill and lore ranks | Open skill-feat picker | Supported `trained in ...` prerequisites filter against projected ranks | `tests/pack-options.test.ts`, `tests/wayfinder-option-context-service.test.ts` | merge |
| Default path | Wizard creation | Elf / Wizard / school and thesis / spellbook | Draft branches, training, languages, spells, and apply | Wizard class features, spellbook entry, curriculum spells, languages, and lore apply | `tests/wayfinder-golden-path-integration.test.ts` | merge |
| Default path | Cleric deity path | Cleric with deity, sanctification, divine font, prepared spells | Draft choices and apply | Cleric choices, divine font entry, prepared entry, and spells apply | `tests/wayfinder-golden-path-integration.test.ts`, `tests/actor-updater-native-spellcasting-application.test.ts` | merge |
| Default path | Spellcasting classes | Bard, cleric, druid, magus, oracle, psychic, sorcerer, summoner, witch, wizard, and animist | Select class and complete target level 5 | Supported spellbook, prepared, spontaneous, and bounded choices render, apply, and rerun cleanly for the deterministic smoke paths | `.wayfinder-smoke/beta-green-0.1.2-final-3`, spell-choice builder tests | release |
| Upgrade path | Existing actor with resolved choices | Actor already has items and Wayfinder flags | Re-open Wayfinder | Already resolved singleton, branch, class-choice, grant-choice, language, and spell-choice steps are skipped unless the draft overrides them | Existing-selection and plan-builder tests | merge |
| Reset / re-run | Upstream selection changes | Draft contains dependent selections | Change ancestry, heritage, class, branch, or source rule choice | Dependent stale choices clear and affected steps surface as needing attention | Invalidation, draft adjustment, grant-choice, and singleton tests | merge |
| Failure mode | Unsupported structured rule shape | Content exposes unsupported selected-item, equipment, dynamic config, injected same-item, cross-item, or multi-ChoiceSet graph dependencies | Build plan | Wayfinder avoids guessing; unsupported choices remain PF2E-native/manual | AP/side-book audit gap table | release |
| Failure mode | Direct feat or branch embeds an unsupported `ChoiceSet` | A selected feat or class-branch option needs an internal choice Wayfinder cannot yet render | Build picker options | Option is hidden from direct guided pickers unless every embedded `ChoiceSet` is covered by a guided follow-up lane | `tests/pack-options.test.ts`, live smoke harness | release |
| Failure mode | PF2E-native grant popup duplication | Static or filtered grant choice is drafted before apply | Apply draft | Wayfinder preseeds supported rule selections so PF2E does not ask again | Actor-updater selection/integration tests and previous live smoke | merge |
| Failure mode | Live Foundry apply/rerun regression | Representative level 1 through 5 flows for martial, skill-heavy, prepared caster, and spontaneous caster paths | Run repo-owned smoke harness | Disposable actors apply, rerun with zero pending steps, and clean up fixtures | `docs/coverage/beta-readiness-smoke.md` | release |

## Coverage Strengths

- The level-1 plan no longer stops at the bare progression skeleton. The app-facing planner layers singleton choices, grant choices, languages, class branches, class-owned choices, skill training, class-derived feat milestones, and spell choices on top of the base progression steps.
- Generic singleton `ChoiceSet` support is real infrastructure instead of one-off UI logic. That makes ancestry, heritage, background, class, deity, and feat-owned singleton choices extensible without pushing policy back into `app-shell.ts`.
- Non-class grant-choice support covers filtered feat-grant shapes and static UUID allowlists, including predicate-gated static choices that depend on drafted roll options or actor skill ranks.
- Skill training now feeds later option filtering. That matters for Rogue-style level-1 skill feats and for future level-2 skill-feat work.
- Class-specific spell behavior now routes through shared caster profiles and focused contributors instead of one-off planner branches.
- Level-1 picker usability is materially better than the original proof of concept because rarity and source filters are now first-class pane state instead of just richer text search.

## Known Partial Areas

- Spellcasting coverage is smoke-proven for one deterministic level 1-5 path per class, but not exhaustive across every subclass-derived tradition, focus spell, granted spell, or later-level class feature branch.
- Some level-1 choices are only as good as the PF2E rule data that drives them. If a background, ancestry, heritage, feat, or class does not expose a supported `ChoiceSet`, grant-choice, selector, or skill-training shape, Wayfinder cannot infer a guided step automatically.
- Direct feat and class-branch options that embed their own `ChoiceSet` rules now surface only when every embedded choice is claimed by a guided lane: grant choice, singleton choice, skill training, or supported class-choice discovery. Unsupported selected-item, equipment, dynamic config, injected same-item, and cross-item dependency shapes remain hidden from guided pickers for now.
- Skill-feat prerequisite filtering covers supported `trained in ...` skill and lore text. It does not yet evaluate every prerequisite kind, such as ability thresholds, follower/deity requirements, equipment requirements, or table-specific access.
- Background or ancestry singleton choices do not always project a trained skill rank. Wayfinder only projects training when the owning item rules actually drive a skill-rank effect or a supported training source.
- Predicate-gated singleton follow-up chains are supported when predicates are driven by earlier singleton roll-option selections. Injected same-item selection predicates and broader actor-roll-option predicates still need content-driven audit before being called broadly covered.
- Predicate-gated static UUID grants are supported for item predicates, actor ancestry/class predicates, actor skill-rank predicates, and active roll options created by drafted rule selections. Selected-item or equipment-derived predicates beyond the live-smoked innovation path still need content-driven expansion.
- Class coverage is structurally extensible and now smoke-proven through level 5 for one deterministic path per PF2E class. Remaining risk is breadth across alternate subclass paths, later-level mechanics, variants, and uncommon rule shapes.

## Level 2+ Readiness List

For the current level-up audit, see [Level 2+ Coverage Matrix](./levelup-coverage-matrix.md).

1. Keep class and skill feat planning anchored to selected-class progression data and exact fulfilled slot ids.
2. Expand alternate subclass/branch coverage beyond the deterministic all-class smoke path, especially where tradition, focus, granted spells, or nested grants change downstream choices.
3. Add Free Archetype as a distinct variant-rule feat group, using PF2E's `archetype` group rather than consuming normal class feat slots.
4. Tighten archetype legality beyond the current dedication/follow-up split: active archetype family, dedication lockout, and GM override/table policy need a clear model before level 2+ archetype choices are guided.
5. Broaden option-context predicates for selected items and equipment-derived roll options beyond the live-smoked Armor Innovation path.
6. Broaden the config catalog resolver only when a real creation blocker needs a specific preseedable PF2E config record beyond the explicitly supported scalar records.
7. Keep starting gear, purchasing, daily preparations, and AP-specific story context out of this module until the core creation and level-up surfaces are stable.
