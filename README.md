# Wayfinder

A guided Pathfinder 2e character builder for Foundry VTT.

Wayfinder takes the parts of PF2E character building that fragment your attention — class tables, compendium browsing, feat slots, boosts, spell choices, and source exceptions — and turns them into a single guided flow you open from the character sheet. Think Pathbuilder, but living inside your game world: it knows which sources your GM enabled, applies the supported rule shapes it can prove, and writes its output straight to the actor. No JSON export, no re-import, no "why is my sheet wrong."

> **Status:** early access. Wayfinder is being built slice-by-slice, class by class. Some flows are deeply guided; others hand you back to the PF2E sheet on purpose. The [level-1 coverage matrix](docs/coverage/level1-coverage-matrix.md), [level-up coverage matrix](docs/coverage/levelup-coverage-matrix.md), and [beta smoke matrix](docs/coverage/beta-readiness-smoke.md) are the honest answer to "does it support my class yet."

## Why use it

- **You're new to PF2E.** It explains what each choice does before you commit and keeps the next step visible without hiding the rules.
- **You've built characters before.** Search, pick, next. Earlier picks filter later ones, so you stop scrolling past feats you can't take anyway.
- **You're a GM onboarding friends.** Wayfinder respects your enabled sources where it has support, and clearly hands off optional variants it cannot yet model.

It is not a replacement for the PF2E system. It is a planning layer on top of it. The actor and items remain the source of truth; Wayfinder's job is to get you to a clean, valid state without making you click through twelve places to do it.

## What's working today

The first vertical slice covers level-1 creation and level-up milestones, with:

- Ancestry, heritage, background, and class selection
- Class branch and grant-driven choices for the classes that have a flow built (see the coverage matrix)
- Common feat milestones and level-1 creation boosts
- Skill training reconciled across class, background, ancestry, heritage, and feat grants
- Bonus-language selection that uses your final effective Intelligence
- Spell-choice flows for the casters with built-in support — wizard and cleric are deepest right now
- Rarity and source filtering on every picker, with optional GM allowlists for non-official packs
- Resumable drafts persisted on the actor, so you can leave and come back

Where Wayfinder can't model a choice confidently, it says so and points you at the right native PF2E control. No silent omissions.

## Install

Paste this manifest URL into Foundry's package installer:

```text
https://github.com/bestlux/wayfinder/releases/latest/download/module.json
```

Foundry's package updater will follow it for future versions. Older releases stay installable from their own release pages.

**Compatibility:** Foundry VTT 14.360 with the PF2E system 8.0.3.

## Use it

1. Open an owned PF2E character actor.
2. Click the Wayfinder action in the sheet header.
3. Walk the steps. Save drafts as you go.
4. Apply when you're ready — Wayfinder writes the changes back to the actor.

## Develop

```powershell
npm install
npm run build
npm test
```

For local Foundry testing, link the repo into:

```text
C:\Users\<you>\AppData\Local\FoundryVTT\Data\modules\pf2e-wayfinder
```

Before closing meaningful work, run `npm run check` — it covers formatting, lint, build, tests, and strict typecheck in one pass.

For live Foundry release smoke, build first and then run:

```powershell
$env:FOUNDRY_USER = "<local Foundry user>"
$env:FOUNDRY_PASSWORD = "<local password if needed>"
npm run smoke:foundry
```

See [docs/coverage/beta-readiness-smoke.md](docs/coverage/beta-readiness-smoke.md) for harness setup, safety rules, and the current launch matrix.

## Architecture

The codebase is organized so new features land in focused seams instead of growing the app shell:

- `src/wayfinder/domain/` — typed workflow rules: step kinds, decisions, slot IDs, completion, invalidation.
- `src/wayfinder/application/` — actor-aware orchestration: plan building, pane assembly, selection commands, draft lifecycle.
- `src/actor-updater/` — apply-side mutations and spellcasting sync.
- `src/build-state.ts` and `src/shared/` — effective document resolution and reusable helpers.

When you're adding a new class flow, start with [the class-flow guide](docs/architecture/adding-a-class-flow.md). For current ownership boundaries and cleanup guardrails, see [the architecture maintenance notes](docs/architecture/maintenance.md). When in doubt, prefer extending one of those seams over adding more responsibility to `app-shell.ts` or the large choice services.

## Release & packaging

Maintainer-only. The checked-in `module.json` is the development manifest; release builds patch in version-specific URLs. See [docs/release-packaging.md](docs/release-packaging.md) for the full procedure.

## License & credits

Wayfinder reuses PF2E compendium data and the PF2E system's actor/item application paths wherever it can. It does not attempt to replace the PF2E rules engine, and it depends on the system's rule shapes (`ChoiceSet`, selectors, grant items) being well-formed for the content it guides.

Issues and feedback: <https://github.com/bestlux/wayfinder/issues>
