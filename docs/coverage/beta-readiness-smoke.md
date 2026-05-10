# Beta Readiness Foundry Smoke

Last updated: 2026-05-10.

This is the launch-readiness live smoke layer for Wayfinder. It complements unit tests by exercising the built module inside a real Foundry world against live PF2E compendia.

## Harness

Run from the repo root after `npm run build`:

```powershell
$env:FOUNDRY_USER = "<local Foundry user>"
$env:FOUNDRY_PASSWORD = "<local password if needed>"
npm run smoke:foundry
```

To pass harness arguments through npm on this machine, use an extra separator:

```powershell
npm run smoke:foundry -- -- --list
npm run smoke:foundry -- -- --case wizard-l1-l5-apply-rerun
```

The harness:

- Logs into the local Foundry world at `FOUNDRY_URL` or `http://localhost:30000`.
- Creates disposable actors with the `WF Smoke Harness` prefix.
- Builds drafts from live PF2E compendium options.
- Applies through Wayfinder's normal apply lifecycle.
- Verifies actor level, duplicate source IDs, native dialog count, draft cleanup, and rerun pending steps.
- Deletes fixtures by default.
- Writes JSON and Markdown artifacts under `.wayfinder-smoke/`, which is intentionally gitignored.

Credentials are local environment variables only. Do not commit Foundry user names, passwords, storage state, or world-specific secrets.

## 2026-05-10 Matrix

Command:

```powershell
$env:FOUNDRY_USER = "<local Foundry user>"
$env:FOUNDRY_PASSWORD = "<local only>"
node tools/foundry-smoke/run-foundry-smoke.mjs --out .wayfinder-smoke/beta-green-matrix-final-4
```

Environment:

- Foundry VTT: 14.360
- PF2E system: 8.1.1
- World: `testing-world`
- Module: `pf2e-wayfinder`, active

| Case | Result | Target level | Planned steps | Rerun steps | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| Fighter | Pass | 5 | 19 | 0 | Class feats, skill feats, general feat, ancestry feat, boosts, skill increases, Fighter Weapon Mastery, apply cleanup |
| Investigator | Pass | 5 | 21 | 0 | Skill-heavy cadence, methodology branch, class feats, skill feats, skill increases, apply cleanup |
| Wizard | Pass | 5 | 28 | 0 | Arcane school, arcane thesis, spellbook/curriculum spell choices, class/skill/general/ancestry feats, apply cleanup |
| Cleric | Pass | 5 | 23 | 0 | Deity, sanctification, doctrine, divine font, prepared spell choices, class/skill/general/ancestry feats, apply cleanup |
| Sorcerer | Pass | 5 | 18 | 0 | Bloodline branch and non-spell level-up cadence; spontaneous repertoire remains PF2E-native/manual |

Selector pairs such as Doctrine plus Cloistered Cleric, Deity plus Deity (Cleric), Arcane School plus the selected school, and grant-choice source plus granted item intentionally share a Wayfinder slot ID. The harness treats duplicate source IDs as failures, while allowing those selector/granted pairs when rerun produces no pending steps.

## Beta Caveats

- Direct feat/class-branch options with embedded `ChoiceSet` rules are hidden unless Wayfinder has a supported follow-up path. Examples include direct skill feat picks such as Additional Lore or Assurance, and class-branch options such as Empiricism Methodology.
- Grant-choice paths remain allowed for supported embedded choices because Wayfinder can build the dependent follow-up step, as with General Training into Additional Lore.
- Class archetype branch options are filtered out of normal class-branch choices. Free Archetype and class archetypes need their own variant or archetype lanes before they should appear as guided choices.
- Sorcerer/spontaneous spell repertoire progression is still PF2E-native/manual. The smoke case proves that Wayfinder does not leave stale steps after supported non-spell progression; it does not claim guided repertoire selection.
