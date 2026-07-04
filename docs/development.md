# Developing Wayfinder

Notes for working on the module locally. Visitor-facing information lives in the [readme](../README.md).

## Build and test

```powershell
npm install
npm run build
npm test
```

Before closing meaningful work, run `npm run check` — it covers formatting, lint, build, tests, and strict typecheck in one pass.

## Local Foundry testing

Link (or copy) the repo into your local Foundry data directory:

```text
C:\Users\<you>\AppData\Local\FoundryVTT\Data\modules\wayfinder-pf2e
```

## Live smoke harness

For live Foundry release smoke, build first and then run:

```powershell
$env:FOUNDRY_USER = "<local Foundry user>"
$env:FOUNDRY_PASSWORD = "<local password if needed>"
$env:FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE = "1"
$env:FOUNDRY_SMOKE_WORLD_ID = "<expected local world id>"
npm run smoke:foundry
```

See [coverage/beta-readiness-smoke.md](coverage/beta-readiness-smoke.md) for harness setup, safety rules, and the current launch matrix.

## Architecture

The codebase is organized so new features land in focused seams instead of growing the app shell:

- `src/wayfinder/domain/` — typed workflow rules: step kinds, decisions, slot IDs, completion, invalidation.
- `src/wayfinder/application/` — actor-aware orchestration: plan building, pane assembly, selection commands, draft lifecycle.
- `src/actor-updater/` — apply-side mutations and spellcasting sync.
- `src/build-state.ts` and `src/shared/` — effective document resolution and reusable helpers.

When adding a new class flow, start with [the class-flow guide](architecture/adding-a-class-flow.md). For current ownership boundaries and cleanup guardrails, see [the architecture maintenance notes](architecture/maintenance.md). When in doubt, prefer extending one of those seams over adding more responsibility to `app-shell.ts` or the large choice services.

## Release and packaging

Maintainer-only. The checked-in `module.json` is the development manifest; release builds patch in version-specific URLs. See [release-packaging.md](release-packaging.md) for the full procedure.
