# Beta Readiness Foundry Smoke

Last updated: 2026-07-04.

This is the launch-readiness live smoke layer for Wayfinder. It complements unit tests by exercising the built module inside a real Foundry world against live PF2E compendia.

## Harness

Run from the repo root after `npm run build`:

```powershell
$env:FOUNDRY_USER = "<local Foundry user>"
$env:FOUNDRY_PASSWORD = "<local password if needed>"
$env:FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE = "1"
$env:FOUNDRY_SMOKE_WORLD_ID = "<expected local world id>"
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
- Deletes fixtures by default only when `FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE=1` and `FOUNDRY_SMOKE_WORLD_ID` matches the connected world. Use `--keep-actors` for non-destructive local debugging.
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
$env:FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE = "1"
$env:FOUNDRY_SMOKE_WORLD_ID = "testing-world"
node tools/foundry-smoke/run-foundry-smoke.mjs --out .wayfinder-smoke/beta-green-0.1.2-final-3 --incremental-case fighter-l1-l5-apply-rerun --incremental-case cleric-l1-l5-apply-rerun --incremental-case sorcerer-l1-l5-apply-rerun --incremental-case kineticist-l1-l5-apply-rerun
```

Environment:

- Foundry VTT: 14.360
- PF2E system: 8.1.1
- World: `testing-world`
- Module: `wayfinder-pf2e`, active

Current upstream target checked on 2026-07-04 is Foundry VTT 14.364 and PF2E 8.2.0. The 0.1.6 hotfix passed the full live smoke matrix against that pair in `.wayfinder-smoke/2026-07-04T18-00-52Z`, with 27 class cases passing and no classified/manual failures. This adds live coverage for Natural Ambition visibility, Scholar/Assurance preselection, Animist base spellcasting counts, and selected feat-owned grant choices such as Druid Order Explorer.

Artifact: `.wayfinder-smoke/beta-green-0.1.2-final-3`.

Result: 31 pass, 0 fail, 0 classified/manual. This includes the all-class matrix below plus the targeted incremental existing-character reruns.

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

## 2026-07-04 Post-Embedded-ChoiceSet Full Matrix

After the embedded-`ChoiceSet` coverage work (per-rule classifier, feat config-string choices, widened static UUID packs, predicate-backed branch policy fix), the full matrix reran green against Foundry VTT 14.364 / PF2E 8.2.0: 28 cases passing — all 27 class cases plus the new `fighter-samsaran-weapon-memory-l1-l5-apply-rerun` variant, which drafts Samsaran Weapon Memory through its two `baseWeaponTypes` config choices and verifies the singleton follow-up steps render, apply, and rerun cleanly. The animist and commander paths now organically draft Additional Lore through a direct skill-feat slot, exercising a feat-sourced embedded lore choice at apply. Artifacts: `.wayfinder-smoke/full-matrix-final-a` and `.wayfinder-smoke/full-matrix-final-b`.

## 2026-05-11 Incremental Existing-Character Reruns

These cases first applied a level 1 actor, reopened Wayfinder against that existing actor, advanced to level 5, applied, and reran at level 5. They are targeted safety checks for actor-owned class-feature replay, prepared spellcasting entry expansion, branch-derived spontaneous spell choices, predicate-gated grants, duplicate prevention, native popup suppression, and draft cleanup.

| Case | Result | Initial steps | Incremental steps | Rerun steps | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| Fighter | Pass | 9 | 9 | 0 | Martial existing-character rerun; Weapon Mastery surfaced from actor state and no duplicate source IDs |
| Cleric | Pass | 14 | 9 | 0 | Prepared caster rerun; existing prepared entry expanded through level 5 without duplicate PF2E-native dialogs |
| Sorcerer | Pass | 11 | 13 | 0 | Branch-derived spontaneous caster rerun; level-2 rank-1 repertoire choice stayed visible and bloodline-derived repertoire choices stayed connected |
| Kineticist | Pass | 16 | 13 | 0 | Class-choice-dependent branch rerun; Gate's Threshold predicate kept stale Gate Junction choices out |

## Beta Caveats

- The all-class matrix is one deterministic legal path per PF2E class through level 5. It does not exhaustively prove every subclass, racket, muse, patron, order, mystery, eidolon, implement, or future high-level branch.
- The matrix proves plan/fill/apply/rerun behavior for the maintained blank level-1-to-level-5 smoke cases. It is not exhaustive path coverage and should not be described as proving every legal build for every class.
- Direct feat options and tag-based class-branch options with embedded `ChoiceSet` rules are shown only when every embedded choice is covered by a guided follow-up lane; predicate-backed branch steps keep their curated options visible. Supported feat-owned and selected class-feature follow-ups are preselected before PF2E native rules run.
- Remaining embedded-`ChoiceSet` caveats are selected-item and equipment predicates, injected same-item selection predicates, cross-item dependency graphs, and class archetype lanes.
- Class archetype branch options are filtered out of normal class-branch choices. Free Archetype and class archetypes need their own variant or archetype lanes before they should appear as guided choices.
- Daily preparations, starting gear beyond class-feature grants, purchasing, retraining, and table-specific campaign systems remain PF2E-native/manual.
