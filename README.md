# Wayfinder

Wayfinder is a Foundry VTT module for Pathfinder 2e that guides players through initial character creation and later level-up milestones from inside the character sheet.

## Current Scope

This first implementation is a working vertical slice with:

- PF2E-only support on Foundry VTT 13 / PF2E 7.10.1
- An actor-sheet header action for owned PF2E character actors
- Draft-based guided selection for ancestry, heritage, background, class, common feat milestones, and level-1 creation boosts
- Generic singleton-item `ChoiceSet` support for supported ancestry, heritage, background, class, and deity-owned decisions
- Guided bonus-language selection after creation boosts so the step can use final effective Intelligence
- Contributor-backed class spell-choice support, with the deepest guided coverage currently living in wizard and cleric flows
- Rarity and source filtering in the selection panes so large compendium choice sets stay usable
- Configurable extra compendium allowlisting beyond official PF2E packs
- Actor flag persistence for resumable drafts
- Guided manual checkpoints for ability boosts and skill increases where the module intentionally defers to PF2E/native sheet workflows instead of forcing brittle automation

For a grounded snapshot of what is and is not currently guided at level 1, see [the level-1 coverage matrix](docs/coverage/level1-coverage-matrix.md).

## Architecture

Wayfinder now has explicit seams for future growth:

- `src/wayfinder/domain/` owns typed workflow rules such as step kinds, decisions, slot IDs, completion, and invalidation.
- `src/wayfinder/application/` owns actor-aware orchestration such as plan building, pane assembly, selection commands, and draft lifecycle.
- `src/actor-updater/` owns apply-side mutations and spellcasting synchronization.
- `src/build-state.ts` plus `src/shared/` own effective document resolution and reusable Foundry/PF2E-neutral helpers.
- For new class-specific flows, see [the class-flow guide](docs/architecture/adding-a-class-flow.md).
- For current level-1 scope and remaining gaps, see [the level-1 coverage matrix](docs/coverage/level1-coverage-matrix.md).

When extending the module, prefer adding new focused services and tests in those seams instead of pushing more policy into `src/wayfinder/app-shell.ts` or the large choice services.

## Development

Install dependencies and build:

```powershell
npm install
npm run build
```

Run tests:

```powershell
npm test
```

For local Foundry development, the repo is intended to be linked into:

`C:\Users\iomancer\AppData\Local\FoundryVTT\Data\modules\pf2e-wayfinder`

## Notes

Wayfinder deliberately reuses PF2E compendium data and actor item application where possible. It does not attempt to replace PF2E's full rules engine, and some guided flows still depend on PF2E item rules exposing supported selector or `ChoiceSet` shapes.
