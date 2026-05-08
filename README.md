# Wayfinder

Wayfinder is a Foundry VTT module for Pathfinder 2e that guides players through initial character creation and later level-up milestones from inside the character sheet.

## Current Scope

This first implementation is a working vertical slice with:

- PF2E-only support on Foundry VTT 14.360 / PF2E 8.0.3
- An actor-sheet header action for owned PF2E character actors
- Draft-based guided selection for ancestry, heritage, background, class, common feat milestones, and level-1 creation boosts
- Generic singleton-item `ChoiceSet` support for supported ancestry, heritage, background, class, and deity-owned decisions
- Non-class grant-choice support for structured filtered feat grants such as Ancient Elf and similar PF2E rule shapes
- Consolidated skill-training guidance that accounts for class, background, ancestry, heritage, selected feat, and lore grants
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
- For special-case default rules and optional-rule sequencing, see [the variant rules and special-cases plan](docs/architecture/wayfinder-variant-rules-and-special-cases-plan.md).

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

## Installation

Once a GitHub release exists, install Wayfinder in Foundry from this manifest URL:

```text
https://github.com/bestlux/wayfinder/releases/latest/download/module.json
```

That stable URL is also the update URL stored in release manifests. Each released manifest points its `download` field at the matching version-specific `module.zip`, so existing users can update through Foundry's package updater and older releases remain installable from their own release pages.

## Release Packaging

The checked-in `module.json` is the source manifest for local development. The release package step patches it into an installable Foundry manifest with a version-specific `download` URL.

Create a local package:

```powershell
npm run package
```

For CI or release dry runs after validation has already passed:

```powershell
node tools/release/prepare-package.mjs --version 0.1.0 --tag v0.1.0 --repo bestlux/wayfinder
```

Package outputs are written to `dist/release/`:

- `module.json` is the release manifest to upload to GitHub Releases and register with Foundry package admin for that exact version.
- `module.zip` is the Foundry-installable archive.
- `package-manifest.json` records the emitted URLs, zip SHA-256, and exact archive entries for inspection.

The archive intentionally includes only installable module assets: `module.json`, generated `scripts/`, `styles/`, `templates/`, `lang/`, and optional top-level release docs such as this README. It excludes `src/`, `tests/`, `node_modules/`, source maps, build config, workflow files, and other development-only content.

To publish through GitHub, bump `package.json` and `module.json` to the same version, run `npm run check`, tag the commit as `vX.Y.Z`, and push the tag. `.github/workflows/release.yml` validates the repo, builds the package, and attaches the release manifest and zip to the GitHub Release.

For Foundry's package listing, register the version-specific manifest URL, not the `/latest/` URL:

```text
https://github.com/bestlux/wayfinder/releases/download/vX.Y.Z/module.json
```

Foundry's Package Release API requires a private package token. Keep that token in repository secrets if automation is added later; do not hardcode it into this repository.

## Notes

Wayfinder deliberately reuses PF2E compendium data and actor item application where possible. It does not attempt to replace PF2E's full rules engine, and some guided flows still depend on PF2E item rules exposing supported selector or `ChoiceSet` shapes.
