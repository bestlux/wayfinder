# Beta Readiness Foundry Smoke

Last updated: 2026-05-11.

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

The companion static class audit checks the maintained smoke matrix against the local PF2E class pack inventory:

```powershell
npm run audit:classes
```

## 2026-05-11 All-Class Matrix

Command:

```powershell
$env:FOUNDRY_USER = "<local Foundry user>"
$env:FOUNDRY_PASSWORD = "<local only>"
node tools/foundry-smoke/run-foundry-smoke.mjs --out .wayfinder-smoke/all-class-l1-l5-attempt-3
```

Environment:

- Foundry VTT: 14.360
- PF2E system: 8.1.1
- World: `testing-world`
- Module: `pf2e-wayfinder`, active

| Case | Result | Target level | Planned steps | Rerun steps | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| Alchemist | Pass | 5 | 19 | 0 | Research field, formulas, feats, skills, boosts, apply cleanup |
| Animist | Pass | 5 | 20 | 0 | Apparition/caster profile, feats, skills, boosts, apply cleanup |
| Barbarian | Pass | 5 | 20 | 0 | Instinct branch, feats, skills, boosts, apply cleanup |
| Bard | Pass | 5 | 24 | 0 | Muse branch, occult repertoire/cantrips, feats, skills, boosts, apply cleanup |
| Champion | Pass | 5 | 22 | 0 | Deity, sanctification, cause, blessing, feats, skills, boosts, apply cleanup |
| Cleric | Pass | 5 | 23 | 0 | Deity, sanctification, doctrine, divine font, prepared spells, feats, skills, boosts, apply cleanup |
| Commander | Pass | 5 | 23 | 0 | Multi-tactic branch choices, feats, skills, boosts, apply cleanup |
| Druid | Pass | 5 | 21 | 0 | Order branch, primal prepared spells, feats, skills, boosts, apply cleanup |
| Exemplar | Pass | 5 | 22 | 0 | Multiple ikon choices, feats, skills, boosts, apply cleanup |
| Fighter | Pass | 5 | 19 | 0 | Weapon mastery, feats, skills, boosts, apply cleanup |
| Guardian | Pass | 5 | 18 | 0 | Class cadence, feats, skills, boosts, apply cleanup |
| Gunslinger | Pass | 5 | 20 | 0 | Way branch, feats, skills, boosts, apply cleanup |
| Inventor | Pass | 5 | 21 | 0 | Innovation branch, nested armor choices, class-feature grant, equipment grant, apply cleanup |
| Investigator | Pass | 5 | 21 | 0 | Skill-heavy cadence, methodology branch, feats, skills, boosts, apply cleanup |
| Kineticist | Pass | 5 | 29 | 0 | Dual gate, second element, threshold fork, impulse grants, feats, skills, boosts, apply cleanup |
| Magus | Pass | 5 | 24 | 0 | Hybrid study, bounded spellbook/cantrips, feats, skills, boosts, apply cleanup |
| Monk | Pass | 5 | 18 | 0 | Class cadence, feats, skills, boosts, apply cleanup |
| Oracle | Pass | 5 | 24 | 0 | Mystery branch, divine repertoire/cantrips, feats, skills, boosts, apply cleanup |
| Psychic | Pass | 5 | 25 | 0 | Conscious/subconscious minds, occult repertoire/cantrips, feats, skills, boosts, apply cleanup |
| Ranger | Pass | 5 | 19 | 0 | Hunter's edge, feats, skills, boosts, apply cleanup |
| Rogue | Pass | 5 | 22 | 0 | Racket branch, level-1 skill feat cadence, feats, skills, boosts, apply cleanup |
| Sorcerer | Pass | 5 | 24 | 0 | Bloodline branch, spontaneous repertoire/cantrips, feats, skills, boosts, apply cleanup |
| Summoner | Pass | 5 | 25 | 0 | Eidolon branch, bounded spontaneous casting, feats, skills, boosts, apply cleanup |
| Swashbuckler | Pass | 5 | 20 | 0 | Style branch, feats, skills, boosts, apply cleanup |
| Thaumaturge | Pass | 5 | 21 | 0 | Implement choices, nested static class-feature choice, feats, skills, boosts, apply cleanup |
| Witch | Pass | 5 | 20 | 0 | Patron branch, prepared spells/cantrips, feats, skills, boosts, apply cleanup |
| Wizard | Pass | 5 | 29 | 0 | Arcane school, arcane thesis, spellbook/curriculum choices, feats, skills, boosts, apply cleanup |

Selector pairs such as Doctrine plus Cloistered Cleric, Deity plus Deity (Cleric), Arcane School plus the selected school, and grant-choice source plus granted item intentionally share a Wayfinder slot ID. The harness treats duplicate source IDs as failures, while allowing those selector/granted pairs when rerun produces no pending steps.

## Beta Caveats

- The all-class matrix is one deterministic legal path per PF2E class through level 5. It does not exhaustively prove every subclass, racket, muse, patron, order, mystery, eidolon, implement, or future high-level branch.
- Direct feat/class-branch options with embedded `ChoiceSet` rules are hidden unless Wayfinder has a supported follow-up path. Supported selected class-feature follow-ups are now preselected before PF2E native rules run.
- Grant-choice paths remain allowed for supported embedded choices because Wayfinder can build the dependent follow-up step, as with General Training into Additional Lore.
- Class archetype branch options are filtered out of normal class-branch choices. Free Archetype and class archetypes need their own variant or archetype lanes before they should appear as guided choices.
- Daily preparations, starting gear beyond class-feature grants, purchasing, retraining, and table-specific campaign systems remain PF2E-native/manual.
