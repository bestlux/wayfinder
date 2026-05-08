# Wayfinder Hygiene Complexity Map

This document maps current complexity and duplication pressure after the AP and side-book level-1 audit and the follow-up DRY passes. It intentionally separates behavior-preserving helper/policy refactors from larger architecture work that should remain explicit feature/refactor goals.

## Evidence Source

- Wayfinder repo: `D:\Source\foundryvtt\character-gen`
- Audit date: 2026-05-08
- PF2E reference repo: `D:\Source\pf2e`, branch `v14-dev`, commit `b77619817d1`
- Foundry reference checkout: `D:\Source\foundryvtt-repo`, branch `master`, commit `cf73d64`

The local Foundry checkout available for this pass contains release notes and public repo material rather than Foundry application source. Source-level comparison against Foundry internals was therefore limited. The Foundry-side guidance in this document comes from the runtime APIs Wayfinder already uses and tests around: `ApplicationV2`, `DialogV2`, actor `createEmbeddedDocuments`, item `updateSource`, `flags.core.sourceId`, and `_stats.compendiumSource`.

## Reference Findings

PF2E's native rule ownership still points Wayfinder toward preseeding PF2E-owned item state rather than duplicating the system's grant behavior.

- `D:\Source\pf2e\src\module\item\base\document.ts` initializes `flags.pf2e.rulesSelections` and `flags.pf2e.itemGrants` on item sources that need them.
- `D:\Source\pf2e\src\module\rules\rule-element\choice-set\rule-element.ts` writes `rulesSelections.<flag>` when a `ChoiceSet` resolves.
- `D:\Source\pf2e\src\module\rules\rule-element\grant-item\rule-element.ts` ties `GrantItem` output back to `itemGrants` and can consume `ChoiceSet` selections.

The current Wayfinder direction matches that model when it:

- writes collected choices to the source item before creation
- records source IDs through Foundry/PF2E source fields
- lets PF2E native `GrantItem` behavior create child grants when the source item is a real PF2E item with supported rules

The risky direction is any new path that manually creates or strips granted items without a clear native boundary and regression test.

## Hotspot Inventory

Largest source files after this pass:

| Lines | File | Current pressure |
| ---: | --- | --- |
| 984 | `src/wayfinder/app-shell.ts` | UI shell still owns too much lifecycle, command routing, apply flow, and status handling. |
| 813 | `src/pack-service.ts` | Pack access, filter evaluation, option shaping, and picker state remain mixed. |
| 786 | `src/actor-updater/selection-application.ts` | Multiple apply-side behaviors share one large mutation module. |
| 765 | `src/wayfinder/skill-training/source-discovery.ts` | Several PF2E skill/lore rule shapes are parsed in one file. |
| 562 | `src/wayfinder/domain/step-types.ts` | The step union is explicit but large and still carries many factory helpers. |
| 537 | `src/wayfinder/application/wayfinder-plan-builder-service.ts` | Plan assembly coordinates many source families directly. |
| 417 | `src/wayfinder/class-choice/rule-discovery.ts` | Class-feature selectors, skill training, deity choices, and branch choices share a rule parser. |
| 398 | `src/actor-updater/spellcasting-entry-support.ts` | Spellcasting entry creation and reconciliation is specialized and Foundry-heavy. |
| 392 | `src/wayfinder/view-models.ts` | Pane/view model shaping still has wide switch pressure. |
| 383 | `src/wayfinder/application/selection-command-service.ts` | Selection commands, dependency clearing, and active-step transitions are closely coupled. |

File size is not automatically a defect, but these files are the places where new level-1 and later-level behavior is most likely to become brittle.

## Duplication Map

| Pattern | Before this pass | Action in this pass | Remaining risk |
| --- | --- | --- | --- |
| Compendium item UUID parsing | Repeated in spell-choice, class-choice, grant-choice, pack, existing-selection, build-state, selector, and planner code. | Added `src/shared/compendium.ts` and reused it for item UUID parsing/construction across core selection, planning, and pack paths. | Residual regexes are content parsers for spell-description UUID markup, not generic item-source parsing. |
| Rule-array extraction and `ChoiceSet` key normalization | Duplicated between grant-choice and singleton-choice discovery. | Added `src/wayfinder/rule-data.ts` for shared rule extraction, choice-key extraction, level normalization, predicate guards, record guards, trimmed strings, predicate-tree evaluation, and predicate string search. | Remaining local helpers are tied to module-specific object models such as draft persistence and spell metadata parsing. |
| PF2E `rulesSelections` writes | Spread across singleton, training, selector, grant-choice, and spell apply modules. | Added `src/shared/pf2e-item-source.ts` for source-side rule selections and queued actor item rule-selection updates. Singleton, training, grant-choice, and feat spell source paths now use the same helper. | Selector application still has some staged update writes because it combines rule persistence, grant creation ordering, and creation-rule pruning in one transaction. |
| Grant item creation policy | Native and manual paths are separated but still understood by multiple apply modules. | Centralized granted item source stamping, granted item update records, and `itemGrants` record construction in `src/shared/pf2e-item-source.ts`. | A full apply-operation model is still deferred because it changes orchestration shape, not just duplicated helper policy. |
| Step identity and dependency invalidation | Slot-prefix conventions are now centralized in some domain helpers but still interpreted in plan, command, invalidation, and apply services. | No behavior change. | Later-level support will multiply this unless each new step kind registers its dependency shape explicitly. |

## Small Refactors Landed

### Shared compendium UUID parser

New helper:

- `src/shared/compendium.ts`

Updated call sites:

- `src/wayfinder/grant-choice/rule-discovery.ts`
- `src/wayfinder/class-choice/rule-discovery.ts`
- `src/wayfinder/spell-choice/source-utils.ts`

Coverage:

- `tests/shared-compendium.test.ts`

This keeps UUID handling in one place for static grant choices, class feature item references, spell-choice source references, pack option UUID construction, existing actor source resolution, and planner source recovery.

### Shared rule-data helpers

New helper:

- `src/wayfinder/rule-data.ts`

Updated call sites:

- `src/wayfinder/grant-choice/rule-discovery.ts`
- `src/wayfinder/singleton-choice/rule-discovery.ts`

Coverage:

- `tests/wayfinder-rule-data.test.ts`
- existing grant-choice and singleton-choice discovery tests

This removes duplicated low-level shape checks and predicate recursion without changing supported rule behavior.

### Shared PF2E item-source policy

New helper:

- `src/shared/pf2e-item-source.ts`

Updated call sites:

- `src/actor-updater/selection-application.ts`
- `src/actor-updater/singleton-choice-application.ts`
- `src/actor-updater/training-application.ts`
- `src/selector-application.ts`

Coverage:

- `tests/shared-pf2e-item-source.test.ts`
- existing actor-updater singleton/training/integration tests

This centralizes source stamping, granted item stamping, `itemGrants` record creation, source-side `rulesSelections`, and queued actor item rule-selection updates.

### Shared predicate-tree evaluation

Expanded helper:

- `src/wayfinder/rule-data.ts`

Updated call sites:

- `src/pack-service.ts`
- `src/wayfinder/singleton-choice-service.ts`
- `src/wayfinder/class-choice/rule-discovery.ts`
- `src/wayfinder/grant-choice/rule-discovery.ts`

Coverage:

- `tests/wayfinder-rule-data.test.ts`
- existing pack, singleton, class-choice, and grant-choice tests

This keeps the predicate tree semantics in one place while letting each caller own its string-level predicate vocabulary.

## Prioritized Implementation Goals

### 1. Apply-side operation model

Problem:

`src/actor-updater/selection-application.ts` still handles ordinary selections, singleton grants, native grant-choice preseeding, manual grant creation, and skill-linked grants in one flow.

Current status:

The repeated PF2E item-source policy is now shared. The remaining duplication is orchestration-level, not helper-level.

Recommended goal:

Introduce explicit apply operations such as `create-selected-item`, `preseed-native-grant`, `create-manual-grant`, `persist-rules-selection`, and `repair-existing-selection`. Keep PF2E document mutation in one adapter layer and keep operation planning pure enough to unit test.

Done when:

- each supported item application path maps to a named operation
- native PF2E grant ownership is visible in the operation type
- existing grant-choice, singleton-choice, skill-training, and spell-choice integration tests still pass

### 2. Rule-shape contributor registry

Problem:

`wayfinder-plan-builder-service` directly knows about many source families: ancestry, heritage, background, class, class features, selected feats, grant choices, singleton choices, skills, spells, and drafted static grants.

Recommended goal:

Add a small contributor registry for source families that can emit pending steps from a shared context. Start with existing level-1 contributors only. Do not introduce plugin machinery or side-book-specific code.

Current status:

Deferred. The central planner still has repeated source-family loops, but abstracting them safely requires a contributor contract and fixture coverage for each source family. This is larger than a DRY helper pass.

Done when:

- current source families are registered explicitly
- each contributor has a small input/output contract
- adding a later-level feat or class-feature contributor does not require editing the central planner's inner loops

### 3. Pack service split

Problem:

`src/pack-service.ts` mixes pack indexing, document fetching, filtering, option rendering, picker state, and static UUID allowlist handling.

Recommended goal:

Split into a pack/document gateway plus option filtering and option view-model modules. Keep Foundry global and compendium access at the gateway boundary.

Current status:

Partially reduced. Generic compendium UUID construction and predicate-tree recursion now live in shared helpers. The remaining pack-service pressure is a real module-boundary split, not low-risk line duplication.

Done when:

- query/filter behavior has targeted tests independent of picker rendering
- Foundry pack access is isolated behind one adapter
- static UUID allowlists and predicate filters use the same option-shaping path

### 4. Skill and lore source discovery slices

Problem:

`src/wayfinder/skill-training/source-discovery.ts` has accumulated several supported PF2E rule and text shapes, including background/class skills, feat-granted skills, lore choices, fixed lore, and Additional Lore style parsing.

Recommended goal:

Extract rule-shape parsers behind named functions with fixture tests from real PF2E content. Avoid expanding supported lore text parsing during the extraction.

Current status:

Deferred. Low-level string normalization now uses the shared rule-data helper, but the remaining opportunities are parser-boundary work around real PF2E skill/lore shapes and should be a dedicated fixture-driven slice.

Done when:

- each supported shape has a named parser and fixture
- skill-training assembly reads parser results instead of parsing every shape inline
- existing Additional Lore and Skilled Human smoke-tested paths stay covered

### 5. Foundry compatibility cleanup

Problem:

Recent live smoke found compatibility warnings around legacy template loading, global text editor access, and forced-deletion update keys.

Recommended goal:

Make a compatibility-only slice for Foundry v13/v14-facing APIs. Do not combine it with rule-support changes.

Done when:

- deprecated API calls are replaced or wrapped behind compatibility helpers
- behavior remains unchanged under the current local Foundry install
- live smoke confirms Wayfinder still opens, applies, and closes

## Guardrails For Future Refactors

- Treat PF2E `rulesSelections` and `itemGrants` as native item state, not Wayfinder-owned parallel state.
- Prefer preseeding source items and allowing PF2E `GrantItem` to run when the selected source is a real PF2E item.
- Do not add another regex for compendium item UUIDs.
- Do not add new rule-discovery helpers to a feature folder until checking `src/wayfinder/rule-data.ts`.
- Do not add new apply-side source stamping, granted item stamping, or rule-selection update helpers until checking `src/shared/pf2e-item-source.ts`.
- Keep behavior refactors paired with focused tests before running the full `npm run check` gate.
- Avoid broad `app-shell.ts` work unless a behavior is truly UI lifecycle-specific.

## Validation For This Pass

Targeted checks run before the full gate:

```text
npm test -- tests/shared-compendium.test.ts tests/shared-pf2e-item-source.test.ts tests/wayfinder-rule-data.test.ts tests/actor-updater-singleton-choice-application.test.ts tests/actor-updater-training-application.test.ts tests/actor-updater-integration.test.ts tests/wayfinder-plan-builder-service.test.ts tests/pack-service.test.ts tests/existing-selection-service.test.ts tests/build-state-singleton-resolution.test.ts tests/singleton-choice-service.test.ts tests/wayfinder-class-rule-discovery.test.ts tests/wayfinder-grant-choice-step-builders.test.ts
```

Result:

- 13 test files passed
- 84 tests passed

Full gate for this pass:

```text
npm run check
```

Result:

- `format:check` passed
- `lint` passed
- `build` passed and synced generated `scripts/`
- 58 test files passed
- 291 tests passed
- `check:strict` passed

## Residual DRY Verdict

After the follow-up DRY pass, the remaining worthwhile opportunities are not "obvious abstraction from multiple call sites" cleanup. They are larger ownership changes:

- apply operations for actor mutation
- source-family contributors for plan building
- pack gateway/filter/view-model split
- fixture-driven skill/lore parser slices
- selector transaction cleanup

Those should be tackled as named implementation goals with their own tests. The low-level repeated policies that were safe to centralize now have shared seams.
