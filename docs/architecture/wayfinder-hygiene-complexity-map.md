# Wayfinder Hygiene Complexity Map

This pass maps current complexity and duplication pressure after the AP and side-book level-1 audit. It intentionally keeps implementation scope small: only obvious repeated helper seams were refactored here, and larger architecture work is listed as follow-up work.

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
| 839 | `src/pack-service.ts` | Pack access, filter evaluation, option shaping, and picker state remain mixed. |
| 828 | `src/actor-updater/selection-application.ts` | Multiple apply-side behaviors share one large mutation module. |
| 767 | `src/wayfinder/skill-training/source-discovery.ts` | Several PF2E skill/lore rule shapes are parsed in one file. |
| 562 | `src/wayfinder/domain/step-types.ts` | The step union is explicit but large and still carries many factory helpers. |
| 536 | `src/wayfinder/application/wayfinder-plan-builder-service.ts` | Plan assembly coordinates many source families directly. |
| 437 | `src/wayfinder/class-choice/rule-discovery.ts` | Class-feature selectors, skill training, deity choices, and branch choices share a rule parser. |
| 398 | `src/actor-updater/spellcasting-entry-support.ts` | Spellcasting entry creation and reconciliation is specialized and Foundry-heavy. |
| 392 | `src/wayfinder/view-models.ts` | Pane/view model shaping still has wide switch pressure. |
| 383 | `src/wayfinder/application/selection-command-service.ts` | Selection commands, dependency clearing, and active-step transitions are closely coupled. |

File size is not automatically a defect, but these files are the places where new level-1 and later-level behavior is most likely to become brittle.

## Duplication Map

| Pattern | Before this pass | Action in this pass | Remaining risk |
| --- | --- | --- | --- |
| Compendium item UUID parsing | Repeated in spell-choice, class-choice, and grant-choice code. | Added `src/shared/compendium.ts` and reused it from the existing call sites. | Future document-type parsing should extend this helper rather than add another regex. |
| Rule-array extraction and `ChoiceSet` key normalization | Duplicated between grant-choice and singleton-choice discovery. | Added `src/wayfinder/rule-data.ts` for shared rule extraction, choice-key extraction, level normalization, predicate guards, record guards, and trimmed strings. | Class-choice and skill-training still have nearby helpers, but their surrounding behavior is broader. Pulling them in should be a separate tested slice. |
| PF2E `rulesSelections` writes | Spread across singleton, training, selector, grant-choice, and spell apply modules. | No behavior change. Documented as a native PF2E ownership seam. | Needs a later "selection persistence adapter" if more rule families are added. |
| Grant item creation policy | Native and manual paths are separated but still understood by multiple apply modules. | No behavior change. | Needs a clearer apply operation model before supporting more item types. |
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

This keeps UUID handling in one place for static grant choices, class feature item references, and spell-choice source references.

### Shared rule-data helpers

New helper:

- `src/wayfinder/rule-data.ts`

Updated call sites:

- `src/wayfinder/grant-choice/rule-discovery.ts`
- `src/wayfinder/singleton-choice/rule-discovery.ts`

Coverage:

- `tests/wayfinder-rule-data.test.ts`
- existing grant-choice and singleton-choice discovery tests

This removes duplicated low-level shape checks without changing supported rule behavior.

## Prioritized Implementation Goals

### 1. Apply-side operation model

Problem:

`src/actor-updater/selection-application.ts` handles ordinary selections, singleton grants, native grant-choice preseeding, manual grant creation, skill-linked grants, and source stamping in one flow.

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

Done when:

- current source families are registered explicitly
- each contributor has a small input/output contract
- adding a later-level feat or class-feature contributor does not require editing the central planner's inner loops

### 3. Pack service split

Problem:

`src/pack-service.ts` mixes pack indexing, document fetching, filtering, option rendering, picker state, and static UUID allowlist handling.

Recommended goal:

Split into a pack/document gateway plus option filtering and option view-model modules. Keep Foundry global and compendium access at the gateway boundary.

Done when:

- query/filter behavior has targeted tests independent of picker rendering
- Foundry pack access is isolated behind one adapter
- static UUID allowlists and predicate filters use the same option-shaping path

### 4. Skill and lore source discovery slices

Problem:

`src/wayfinder/skill-training/source-discovery.ts` has accumulated several supported PF2E rule and text shapes, including background/class skills, feat-granted skills, lore choices, fixed lore, and Additional Lore style parsing.

Recommended goal:

Extract rule-shape parsers behind named functions with fixture tests from real PF2E content. Avoid expanding supported lore text parsing during the extraction.

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
- Keep behavior refactors paired with focused tests before running the full `npm run check` gate.
- Avoid broad `app-shell.ts` work unless a behavior is truly UI lifecycle-specific.

## Validation For This Pass

Targeted checks run before the full gate:

```text
npm test -- tests/shared-compendium.test.ts tests/wayfinder-rule-data.test.ts tests/wayfinder-grant-choice-step-builders.test.ts tests/wayfinder-singleton-rule-discovery.test.ts tests/wayfinder-class-rule-discovery.test.ts
```

Result:

- 5 test files passed
- 23 tests passed

Full gate for this pass:

```text
npm run check
```

Result:

- `format:check` passed
- `lint` passed
- `build` passed and synced generated `scripts/`
- 57 test files passed
- 284 tests passed
- `check:strict` passed
