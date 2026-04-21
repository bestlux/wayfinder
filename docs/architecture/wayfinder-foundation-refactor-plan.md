# Wayfinder Foundation Refactor Plan

> Status: Stages 1-7 of this plan are complete on `master` as of 2026-04-20. Keep this document as the historical foundation roadmap; use `docs/architecture/wayfinder-post-foundation-plan.md` for follow-on slices and extension guidance.

## Goal

Turn Wayfinder from a promising vertical slice into a maintainable, testable, and aggressively extensible module with clear boundaries between:

- workflow/domain rules
- Foundry/PF2E adapters
- UI/presentation
- actor-application side effects

## Context

Current repo evidence:

- `npm run format:check` passes
- `npm run lint` passes
- `npm run build` passes
- `npm test` passes with 16 files / 79 tests
- `src/wayfinder/app-shell.ts` is 1512 lines
- `src/actor-updater.ts` is 1058 lines
- `src/wayfinder/class-choice-service.ts` is 604 lines
- `src/wayfinder/spell-choice-service.ts` is 626 lines
- `tests/actor-updater.test.ts` is 3063 lines
- `src/` currently contains 257 `any` usages
- `tests/` currently contain 114 `any` usages

Important static-analysis findings:

- `tsconfig.json` keeps `strict: false` and `noImplicitAny: false`
- `eslint.config.mjs` explicitly disables `@typescript-eslint/no-explicit-any`
- `biome.jsonc` has formatting enabled but linting disabled
- a stricter TypeScript run against the eslint/test config immediately exposes config and fixture typing gaps, especially:
  - `tsconfig.eslint.json` inheriting `rootDir: "src"`
  - test globals such as `globalThis.game`
  - test fixtures that no longer satisfy the current step/meta types

## Constraints

- Backward compatibility is not a design constraint for this effort.
- Existing actor/draft persistence may be broken intentionally if the new model is materially better.
- `src/` remains the source of truth and `scripts/` remains generated output.
- Foundry/PF2E integration still matters, but it should live at the edges rather than dominate the core model.

## Done When

This foundation work is done when:

- `WayfinderApp` is a thin UI shell, not the workflow brain
- actor application is split into focused mutation modules with deterministic ownership
- slot identifiers, step kinds, and draft decisions are modeled explicitly instead of as scattered string conventions
- domain logic is testable without Foundry globals
- static analysis enforces the intended direction instead of merely formatting code
- adding a new class-specific rule no longer requires touching half a dozen unrelated modules

## Phase 1: Assumption Autopsy

### Assumption 1

The codebase is still small enough that a few large files are acceptable.

Source:
status quo / proof-of-concept gravity

Why it is dangerous:
large files are not the disease, but here they are a symptom of mixed responsibilities. `app-shell.ts` and `actor-updater.ts` are each acting as coordinator, parser, policy engine, and adapter at the same time.

### Assumption 2

Foundry/PF2E integration requires broad `any` usage across the whole repo.

Source:
legacy process / tooling avoidance

Why it is dangerous:
the true dynamic boundary is narrow: compendium documents, actor items, globals, and a few PF2E structures. The rest can be modeled explicitly.

### Assumption 3

Draft state should stay split across many parallel maps because each step kind is different.

Source:
incremental accretion

Why it is dangerous:
parallel maps are driving duplicated completion logic, clear/invalidate logic, and selected-value lookup logic.

### Assumption 4

Class-feature selection, class-branch selection, spell choices, and general pick-item flows are different enough to justify duplicated helper families.

Source:
local optimization

Why it is dangerous:
the code shows the opposite. Selector creation, source stamping, source-id matching, clone helpers, and preselected stripping are repeated with small variations.

### Assumption 5

Passing current lint/build/test means the codebase is structurally healthy.

Source:
risk aversion / current gate bias

Why it is dangerous:
the current gates mostly prove the proof of concept still behaves as expected. They do not strongly constrain architecture drift.

## Phase 2: Irreducible Truths

1. Wayfinder is fundamentally a deterministic workflow engine: actor snapshot + draft + compendium context -> ordered steps, choices, invalidations, and final mutations.
2. The core business rules are small in number: progression planning, dependency filtering, draft decision storage, step completion, invalidation, and actor application.
3. Foundry and PF2E are integration boundaries, not the domain itself.
4. Stable step identity matters because planning, invalidation, draft persistence, and apply logic all key off slot identity.
5. Class-specific complexity will keep growing. The current architecture will get worse non-linearly as more classes and rules are added.
6. UI rendering and actor mutation are the most expensive places to debug. Those areas should consume precomputed domain/application results, not invent rules inline.

## Phase 3: Reconstruction From Zero

### Approach A: Continue incremental extractions from the current files

Core idea:
keep the current model and peel off more helpers until the large files shrink.

Advantage:
lowest short-term disruption.

Tradeoff:
likely to produce smaller files that still share the same accidental architecture and stringly contracts.

### Approach B: Rebuild around a domain-first workflow core

Core idea:
make the domain explicit first, then let UI and Foundry adapters depend on it.

Advantage:
puts the complexity where it belongs and creates a stable place for future class logic.

Tradeoff:
requires a deliberate draft-model rewrite and some aggressive deletions.

### Approach C: Full event-sourced/state-machine system

Core idea:
represent every choice and mutation as events and reducers.

Advantage:
excellent auditability and deterministic replay.

Tradeoff:
too much machinery for this repo right now.

### Recommendation

Choose Approach B.

It preserves the useful part of the current implementation, but rejects the proof-of-concept assumption that the UI shell and actor updater should own the model.

## Phase 4: Assumption vs. Truth Map

| Original assumption | First-principles replacement | Practical implication |
| --- | --- | --- |
| `app-shell` can stay as the orchestration center | UI should consume prebuilt workflow state | move planning, invalidation, and selection policy out of the UI |
| `any` is the practical answer to Foundry | only boundary adapters need `any` | introduce typed gateway/parser modules |
| parallel draft maps are manageable | decisions should be modeled per step identity | replace fragmented decision storage with a typed decision model |
| duplicated selector helpers are acceptable | branch/feature application is one behavior family | merge them into a unified selector-application engine |
| current tests are sufficient | current tests are behavior-preserving but architecture-hostile | split giant tests into targeted suites with shared builders |

## Phase 5: The Aristotelian Move

Stop treating Wayfinder as "a UI that happens to mutate actors."

Treat it as "a workflow engine with a Foundry UI and a Foundry apply adapter."

The single highest-leverage action is to introduce a real domain model for steps and draft decisions, then force both planning and applying code to consume that model.

## Highest-Value Smells To Remove First

### 1. God-object UI shell

`src/wayfinder/app-shell.ts` currently owns:

- plan construction
- step activation
- pane selection
- option-context assembly
- draft mutation
- dependency invalidation
- user status messaging
- persistence/apply commands

This is the primary structural problem.

### 2. Apply-side orchestration blob

`src/actor-updater.ts` currently owns:

- singleton replacement
- feat insertion
- training application
- spell-choice reconciliation
- spellcasting entry provisioning
- cleric-specific native spellcasting sync
- boost application
- skill increase application

This is a second god object with heavy PF2E coupling.

### 3. One behavior family split into multiple near-duplicates

`src/class-branch-service.ts` and `src/class-feature-choice-service.ts` repeat:

- selector item lookup
- source-id matching
- clone helpers
- selector source seeding
- granted-item repair
- preselected child stripping

These should become one selector application subsystem.

### 4. Stringly typed workflow contracts

The repo relies heavily on:

- slot-id prefixes
- `step.kind` switches
- optional metadata fields hanging off a broad `PendingStep`
- manual invalidation by string prefix

This is why completion/status/clearing/invalidation logic keeps repeating.

### 5. Mixed old and current type models

`src/types.ts` still contains apparently unused legacy interfaces such as:

- `ActorSummary`
- `StepSelection`
- `WayfinderDraft`
- `WayfinderStep`
- `SourceFilter`

These should be deleted or replaced with the real current model, not kept as fossilized alternate shapes.

### 6. Shared helpers duplicated across layers

The repo currently duplicates helpers such as:

- `cloneData`
- `itemMatchesSourceId`
- `sourceIdOf`
- `slugifyName`

That is small duplication on the surface, but it signals missing shared boundaries.

### 7. Boolean-flagged view models

`src/wayfinder/view-models.ts` encodes pane identity with both `kind` and many `isX` flags.

That is a smell. Prefer a discriminated union with optional derived booleans only where the template engine truly requires them.

### 8. Tests that preserve behavior but resist refactoring

`tests/actor-updater.test.ts` is currently an integration mega-file. It proves a lot, but it also makes refactoring harder because the test surface is monolithic and fixture-heavy.

## Target Architecture

Recommended end-state shape:

```text
src/
  shared/
    cloning.ts
    ids.ts
    text.ts
  foundry/
    globals.ts
    actor-gateway.ts
    compendium-gateway.ts
    pf2e-document-parsers.ts
  wayfinder/
    domain/
      step-types.ts
      decision-types.ts
      slot-ids.ts
      progression-rules.ts
      invalidation-rules.ts
      completion-rules.ts
    application/
      build-plan.ts
      build-option-context.ts
      build-pane-model.ts
      apply-draft.ts
      selector-application.ts
      spellcasting-application.ts
    ui/
      app-shell.ts
      actions.ts
      panes/
      view-models.ts
```

Key rules:

- `wayfinder/domain` is pure and test-first.
- `wayfinder/application` orchestrates domain + adapter calls.
- `foundry/*` is where `any`, globals, compendium lookups, and PF2E object-shape weirdness are allowed.
- `wayfinder/ui` renders and dispatches commands, but does not invent rules.

## Model Changes To Make Deliberately

### Replace broad `PendingStep` with a true discriminated union

Instead of one type with many optional fields, define:

- `PickItemStep`
- `ManualStep`
- `BoostStep`
- `SkillIncreaseStep`
- `SkillTrainingStep`
- `ClassBranchStep`
- `ClassChoiceStep`
- `SpellChoiceStep`

This will shrink switch-heavy code and make impossible states unrepresentable.

### Replace fragmented draft maps with a typed decision store

Current design:

- `draft.selections`
- `draft.branchSelections`
- `draft.classChoices`
- `draft.spellChoices`
- `draft.skillTrainings`
- `draft.skillIncreases`
- `draft.manual`

Recommended design:

- keep boosts in a dedicated boost model
- replace the rest with `draft.decisionsBySlotId`
- each decision is a discriminated union keyed by step kind / slot family

That one change removes a large amount of repeated clear/complete/status logic.

### Centralize slot identity

Introduce one module for:

- constructing slot ids
- parsing slot ids
- grouping slot ids into dependency families
- comparing slot ids

This removes hard-coded string prefixes from invalidation and apply logic.

### Unify selector application

Class-feature selectors and class-branch selectors should share one application engine with pluggable policies for:

- selector source
- grant policy
- rule-selection updates
- child-item attachment

### Separate read model from write model

The repo needs a clean distinction between:

- actor/build snapshot queries
- draft/workflow planning
- final actor mutation commands

Read-side modules should not mutate. Write-side modules should not rediscover planning rules.

## Refactor Sequence

### Stage 0: Clean staging ground

- Create `docs/architecture/` and keep this plan there.
- Add a short architecture note to README once the new structure exists.
- Decide up front that old drafts can be invalidated by version bump instead of migrated.

### Stage 1: Delete dead contracts and extract shared utilities

- Remove unused legacy interfaces from `src/types.ts`.
- Extract shared helpers:
  - clone
  - source-id lookup/matching
  - slug normalization
  - slot-id helpers
- Add focused tests for those shared utilities.

Expected outcome:
duplication drops immediately and future extraction work gets easier.

### Stage 2: Fix the static-analysis runway

- Split TypeScript configs by responsibility:
  - source build config
  - source strict-check config
  - test config
- stop inheriting `rootDir: "src"` into test-focused configs
- add explicit test global typings for `globalThis.game`, `CONFIG`, etc.
- turn on stricter checking for newly extracted modules first
- change `@typescript-eslint/no-explicit-any` from off to a ratcheted policy:
  - allowed in `foundry/*`
  - disallowed in new domain/application modules

Expected outcome:
quality gates begin enforcing the architecture instead of just formatting it.

### Stage 3: Rebuild the domain model

- create true step unions
- create typed decision unions
- create slot-id helpers
- move completion/status/invalidation rules into domain modules
- write tests around pure step/decision behavior before reconnecting UI

Expected outcome:
the workflow engine becomes independent of Foundry rendering.

### Stage 4: Thin the UI shell

- reduce `WayfinderApp` to:
  - loading actor/draft context
  - invoking application services
  - rendering pane view models
  - dispatching user commands
- move option-context and picker assembly into application services
- move invalidation policy into domain/application logic
- keep `src/wayfinder-app.ts` as a thin public entrypoint

Expected outcome:
`app-shell.ts` should become boring.

### Stage 5: Rebuild the apply path

- split `actor-updater.ts` into focused modules:
  - singleton application
  - training application
  - feat application
  - selector application
  - spell-choice application
  - native spellcasting synchronization
  - boost application
  - skill increase application
- remove cross-layer dependency on `src/wayfinder/spell-choice-service.ts`
- make apply operations consume domain/application results instead of recomputing policy

Expected outcome:
apply behavior becomes understandable, idempotent, and easier to extend for new classes.

### Stage 6: Rebuild test structure

- split `tests/actor-updater.test.ts` by subsystem
- create reusable builders/fixtures for:
  - actors
  - compendium entries
  - steps
  - decisions/drafts
- keep a smaller number of end-to-end integration tests
- add many more focused domain/application tests

Expected outcome:
tests become a refactor accelerant instead of a drag coefficient.

### Stage 7: Raise the quality bar permanently

- enable stricter TypeScript for domain/application modules
- consider enabling Biome linting or expanding ESLint rules for:
  - explicit `any`
  - duplicate branches
  - overly broad switch defaults
  - dead exports
- add a second CI/local command for stronger analysis, for example:
  - normal build/test path
  - stricter architecture check path

Expected outcome:
future regressions get blocked close to the source.

## Practical First Slice

If this starts tomorrow, the best first implementation slice is:

1. Extract shared helper modules and delete unused legacy types.
2. Introduce a dedicated slot-id module.
3. Replace fragmented decision lookup/clear logic with a typed decision helper layer.
4. Move invalidation rules out of `WayfinderApp`.
5. Split selector application into one subsystem.

That slice attacks the highest-duplication and highest-leverage smells without trying to solve every class-specific rule at once.

## What To Break On Purpose

Because backward compatibility is not required, prefer the cleaner path when these tradeoffs appear:

- bump `DRAFT_VERSION` instead of writing migration glue for a bad draft model
- rename modules and folders to reflect actual boundaries
- delete stale types instead of preserving alternate models
- drop proof-of-concept helper functions that exist only because the model is weak

## What Not To Do

- Do not introduce a generic repository/service/factory maze.
- Do not move code into more files without changing the underlying model.
- Do not let Foundry globals leak back into the domain.
- Do not preserve today’s slot-id string conventions if a central slot-id model replaces them.
- Do not keep `any` in new pure modules just because Foundry is dynamic elsewhere.

## Definition Of A Respectable Foundation

Wayfinder becomes respectable when a new class-specific workflow can be added by:

1. expressing new domain rules
2. exposing them through application services
3. wiring a pane/presenter if needed
4. adding focused tests

It is not respectable if adding one new rule still requires editing:

- `app-shell.ts`
- `actor-updater.ts`
- multiple duplicated selector helpers
- multiple string-prefix invalidation branches
- multiple test mega-fixtures

That is the line this refactor should cross.
