# Beta Readiness Foundry Smoke

Last updated: 2026-08-21.

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
npm run smoke:foundry -- -- --free-archetype on --case free-archetype-fighter-archer-dedication
npm run smoke:foundry -- -- --campaign-feat-sections ancestry-paragon --case ancestry-paragon-fighter-l1-l5-apply-rerun
npm run smoke:foundry -- -- --gradual-boosts on --case gradual-boosts-fighter-l1-l5-apply-rerun
```

The harness:

- Logs into the local Foundry world at `FOUNDRY_URL` or `http://localhost:30000`.
- Creates disposable actors with the `WF Smoke Harness` prefix.
- Builds drafts from live PF2E compendium options.
- Applies through Wayfinder's normal apply lifecycle.
- Verifies actor level, duplicate source IDs, native dialog count, draft cleanup, and rerun pending steps.
- Deletes fixtures by default only when `FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE=1` and `FOUNDRY_SMOKE_WORLD_ID` matches the connected world. Use `--keep-actors` for non-destructive local debugging.
- Can temporarily force PF2E's Free Archetype world setting to `on` or `off` only under the same destructive/world guard, verifies the prepared PF2E state, and restores the original value in `finally`.
- Writes JSON and Markdown artifacts under `.wayfinder-smoke/`, which is intentionally gitignored.

Credentials are local environment variables only. Do not commit Foundry user names, passwords, storage state, or world-specific secrets.

Foundry 14.366 replaced the legacy user `<select>` on the world login screen with a username autocomplete input. The harness accepts both forms so it can verify the current stable release without dropping compatibility with earlier Foundry 14 builds.

The companion static class audit checks the maintained smoke matrix against the local PF2E class pack inventory:

```powershell
npm run audit:classes
```

## 2026-08-21 Release 0.8.0 Candidate Feature Gates

The required Starting Equipment behavior through Wave 4 is live-proven against Foundry VTT 14.366 / PF2E 8.4.1 in `testing-world`:

- Wave 2 acquisition run `6a8d72f7-0008-4451-8ca4-4ecf1ef34272` passed all ten cases, including forced retry boundaries, lost final acknowledgement, separate-session GM review, and non-GM native Dwarf Clan Dagger and Sarangay Head Gem grants with zero acquisition item-create writes. The pinned source scan at commit `bf1502676d863c73d67fd615af78c73ff908c10f` matched the checked-in physical-grant registry with no missing or unexpected routes.
- Wave 3 rerun `.wayfinder-smoke/wave3-equipment-294f38f0-9443-48ab-9641-b18209caa075` reconfirmed higher-level recipes, GM authority, configured equipment, ABP boundaries, and zero-write handoff. The earlier implementation-gate artifact `37822635-f308-4f9e-80a3-2dd8ef13ec8f` remains the focused original proof.
- Wave 4 functional artifact `.wayfinder-smoke/wave4-equipment-cd91505f-004b-4e57-be7c-fd21c5e75c79` passed price, stack, actor-size, Adventurer's Pack, retry, and source-isolation cases.
- Experience artifact `.wayfinder-smoke/wf43-experience-4a9289b8-95b3-4da8-a31b-6d25aeb77f2b` passed English and Chinese through GM and player provider paths, all 12 states at four widths each, exact keyboard Apply/retry and focus behavior, and cleanup.
- Two independent full catalogue profiles each passed 840/840 samples with zero long tasks. `.wayfinder-interaction/equipment-2026-08-21T14-52-41-226Z-8a239870-0ad2-4e88-ba8d-73b1d32130b6` recorded overall p95 60.3 ms and a worst-width cold-open p95 of 70.2 ms; `.wayfinder-interaction/equipment-2026-08-21T15-31-56-723Z-36ef9d7f-d05a-435a-953c-4052130b270c` recorded overall p95 58.8 ms and a worst-width cold-open p95 of 67.1 ms.
- The candidate contract now includes an exact existing-character import lane: imported history suppresses the creation-only equipment pane, clears stale cart/request intent, preserves unrelated choices and actor flags, and performs no item, currency, or manifest writes. Its draft-replacement lane exercises choose, save, clear, replace, save, and reload through production controls. Skill projection is compiled from ordered actor/source/draft facts so fixed training and later increases agree across the pane and Apply.
- Physical-grant support is source-owned by one executable 51-route registry. All 162 scanner discoveries have an explicit disposition, and a changed or new scanner key cannot pass without a supported route, a typed handoff route, or an explicit reviewed non-physical classification. Unsupported higher-level grant routes are rejected before acquisition identity, policy, or GM judgment mutation.
- Adjacent 0.8.0 player-trust coverage includes PF2E-prepared fixed ancestry flaws: Lizardfolk Intelligence and Elf Constitution affect projected abilities and downstream choices, while alternate ancestry boosts exclude the printed flaw set. This is contract coverage for issue #32, not a claim that the final exact-candidate live matrix has passed.

This is feature-gate evidence, not a publication claim. The automated release contract and exact coordinator/package binder are built and reviewed, but the full `WF-080-51` exact-candidate matrix and `WF-080-52` installed-package proof remain pending. No 0.8.0 tag, push, Foundry registration, or publication is represented here.

## 2026-08-18 Release 0.7.5 Focused Matrix

The exact `v0.7.5` candidate passed three focused live cases against Foundry VTT 14.366 / PF2E 8.4.0 in `testing-world`, with zero classified/manual cases and zero failures:

- `fighter-l1-l5-apply-rerun` — representative level-5 creation, Apply, cleanup, and zero-step rerun;
- `fighter-ancient-elf-necromancer-l1-apply-rerun` — grant-choice ancestry and prose-backed dedication follow-ons; and
- `fighter-apply-safety-failure-retry` — deliberate late Apply failure followed by an idempotent retry.

The artifact `.wayfinder-smoke/v0.7.5-release` reports Wayfinder 0.7.5, Foundry 14.366, PF2E 8.4.0, three passes, and a schema-v3 qualification with zero findings. A separate live source-corpus audit exercised every enabled official and Battlezoo ancestry pack: all 78 reviewed player roots remained visible, including unusual aberration, beast, construct, ooze, outsider, object, and untyped ancestries, while synthetic Companion Compendia fixtures proved minion, eidolon, companion-flag, and direct creature-statblock exclusions. This is focused change coverage; the broader 0.7.3 matrix remains the current full-regression live baseline.

## 2026-08-14 Release 0.7.3 Full Matrix

The exact `v0.7.3` candidate passed 55 live executions representing 54 unique scenarios against Foundry VTT 14.366 / PF2E 8.4.0 in `testing-world`, with zero classified/manual cases and zero failures:

- `.wayfinder-smoke/release-0.7.3-rc-baseline`: 41 direct baseline and depth scenarios.
- `.wayfinder-smoke/release-0.7.3-rc-incremental`: eight executions—one repeated Fighter control plus seven unique existing-character upgrades.
- `.wayfinder-smoke/release-0.7.3-rc-free-archetype`: three Free Archetype paths with the variant enabled.
- `.wayfinder-smoke/release-0.7.3-rc-ancestry-paragon`: one Ancestry Paragon campaign-section path.
- `.wayfinder-smoke/release-0.7.3-rc-gradual-boosts`: one Gradual Ability Boosts path.
- `.wayfinder-smoke/release-0.7.3-rc-apply-safety`: one deliberate late-phase Apply failure and retry.

Every artifact reports Wayfinder 0.7.3, Foundry 14.366, and PF2E 8.4.0. The Apply-safety probe failed intentionally at `source-flag-restoration`, confirmed that the draft remained saved and the actor remained level 1, then retried the same draft successfully to level 5 with no duplicate slot IDs, duplicate source IDs, repeated skill increases, or remaining steps.

## 2026-08-14 Release 0.7.2 Full Matrix

The exact `v0.7.2` candidate passed 55 live executions representing 54 unique scenarios against Foundry VTT 14.364 / PF2E 8.4.0 in `testing-world`, with zero classified/manual cases and zero failures:

- `.wayfinder-smoke/release-0.7.2-rc-baseline-green`: 41 direct baseline and depth scenarios.
- `.wayfinder-smoke/release-0.7.2-rc-incremental`: eight executions—one repeated Fighter control plus seven unique existing-character upgrades.
- `.wayfinder-smoke/release-0.7.2-rc-free-archetype`: three Free Archetype paths with the variant enabled.
- `.wayfinder-smoke/release-0.7.2-rc-ancestry-paragon`: one Ancestry Paragon campaign-section path.
- `.wayfinder-smoke/release-0.7.2-rc-gradual-boosts`: one Gradual Ability Boosts path.
- `.wayfinder-smoke/release-0.7.2-rc-apply-safety`: one deliberate late-phase Apply failure and retry.

Every artifact reports Wayfinder 0.7.2, Foundry 14.364, and PF2E 8.4.0. The Apply-safety probe failed intentionally at `source-flag-restoration`, confirmed that the draft remained saved and the actor remained level 1, then retried the same draft successfully to level 5 with no duplicate slot IDs, duplicate source IDs, or repeated skill increases.

## 2026-08-14 Release 0.7.1 Full Matrix

The exact `v0.7.1` candidate passed 54 live apply/rerun executions representing 53 unique scenarios against Foundry VTT 14.364 / PF2E 8.4.0 in `testing-world`, with zero classified/manual cases and zero failures:

- `.wayfinder-smoke/release-0.7.1-rc-baseline`: 41 direct baseline and depth scenarios.
- `.wayfinder-smoke/release-0.7.1-rc-incremental`: eight executions—one repeated Fighter control plus seven unique existing-character upgrades.
- `.wayfinder-smoke/release-0.7.1-rc-free-archetype`: three Free Archetype paths with the variant enabled.
- `.wayfinder-smoke/release-0.7.1-rc-ancestry-paragon`: one Ancestry Paragon campaign-section path.
- `.wayfinder-smoke/release-0.7.1-rc-gradual-boosts`: one Gradual Ability Boosts path.

Every artifact reports Wayfinder 0.7.1, Foundry 14.364, and PF2E 8.4.0. The candidate also received focused live checks for the Night Watch contextual Lore choice, the compact bonus-language approval disclosure, feedback links from the app and Foundry settings, and safe singleton replacement failure behavior.

## 2026-08-10 Release 0.7.0 Full Matrix

The `v0.7.0` candidate passed 53 live apply/rerun executions against Foundry VTT 14.364 / PF2E 8.4.0 in `testing-world`, with zero classified/manual cases and zero failures:

- 41 direct baseline and depth cases, including five classes through level 10 and Fighter through level 20.
- Seven existing-character incremental upgrades.
- Three Free Archetype paths with the variant enabled.
- One Ancestry Paragon campaign-section path.
- One Gradual Ability Boosts path.

Artifacts: `.wayfinder-smoke/release-0.7.0-baseline`, `.wayfinder-smoke/release-0.7.0-free-archetype-final`, `.wayfinder-smoke/release-0.7.0-ancestry-paragon`, and `.wayfinder-smoke/release-0.7.0-gradual-boosts`.

## 2026-07-27 Depth Verification Past Level 5

First live evidence above level 5, run against Foundry VTT 14.364 / PF2E 8.3.0 in `testing-world`.

Result: **6 pass, 0 classified/manual, 0 fail** for the depth matrix, with branch-heavy baselines rerun alongside it.

| Case | Target | Proves |
| --- | ---: | --- |
| `fighter-depth-l1-l10-apply-rerun` | 10 | martial path, boosts at 10, skill increases to 7/9 |
| `wizard-depth-l1-l10-apply-rerun` | 10 | prepared caster, arcane school curriculum through rank 5 |
| `bard-depth-l1-l10-apply-rerun` | 10 | spontaneous repertoire through rank 5 |
| `magus-depth-l1-l10-apply-rerun` | 10 | bounded spellcasting |
| `investigator-depth-l1-l10-apply-rerun` | 10 | skill-heavy cadence |
| `fighter-depth-l1-l20-apply-rerun` | 20 | all five boost batches, skill increases through 19 |

Beyond the standard apply/rerun checks, these cases assert that each boost milestone at 10/15/20 spends four boosts into `system.build.attributes.boosts`, that skill increases resolve to expected final ranks, and that caster pickers expose the spell ranks their progression allows. The level-20 fighter finished with boosts recorded in all five batches (1/5/10/15/20) and three skills at rank 4, with zero duplicate source IDs.

`wizard-depth` initially failed with every curriculum step reporting zero options. That was a harness defect, not a product defect: filling continued against the plan built before the arcane school was drafted, so ordinary spellbook steps consumed the curriculum spells first and duplicate filtering emptied the curriculum steps. The harness now replans immediately after a class-branch selection. The same curriculum step was confirmed working in the live UI for both School of Battle Magic and Red Mantis Magic School while diagnosing this.

Known gap: the level-20 proof is a martial class. Spell ranks 6 through 9 and caster-specific level-19/20 milestones remain unverified.

## 2026-07-11 Release 0.5.0 Free Archetype Matrix

The `v0.5.0` candidate ran as module version 0.5.0 against Foundry VTT 14.364 / PF2E 8.3.0 in `testing-world`. The existing 42-case matrix was forced to Free Archetype off; the focused overlay temporarily enabled it and restored the original setting afterward.

Result: **46 pass, 0 classified/manual, 0 fail** across two artifacts:

- `.wayfinder-smoke/release-0.5.0-baseline-final`: 35 direct and seven incremental existing-character cases with Free Archetype explicitly off.
- `.wayfinder-smoke/release-0.5.0-free-archetype-final`: Archer Dedication → Quick Shot and Acrobat Dedication → Contortionist, each run as both a direct level-1-to-5 build and an incremental existing-character build with Free Archetype on.

All four focused cases rendered independent `class-feat-level-2`/`class-feat-level-4` and `archetype-feat-level-2`/`archetype-feat-level-4` steps, wrote the archetype choices to `archetype-2` and `archetype-4`, applied without native dialogs or duplicate source IDs, cleared the draft, and reran with zero pending steps. This proves the separate slot mechanism and native pool handoff, not exhaustive archetype legality.

## 2026-07-11 Release 0.4.0 Full Matrix

The `v0.4.0` candidate ran as module version 0.4.0 against Foundry VTT 14.364 / PF2E 8.3.0 in `testing-world`:

```powershell
node tools/foundry-smoke/run-foundry-smoke.mjs --out .wayfinder-smoke/release-0.4.0-full-4 --incremental-case fighter-l1-l5-apply-rerun --incremental-case cleric-l1-l5-apply-rerun --incremental-case sorcerer-l1-l5-apply-rerun --incremental-case kineticist-l1-l5-apply-rerun --incremental-case cleric-battle-creed-l1-l5-apply-rerun --incremental-case gunslinger-spellshot-l1-l5-apply-rerun --incremental-case investigator-palatine-detective-l1-l5-apply-rerun
```

Result: **42 pass, 0 classified/manual, 0 fail** — 35 direct level-1-to-5 cases and seven incremental existing-character cases. Every case applied to level 5, cleared its draft, produced no invalid duplicate source IDs or native dialog increase, and reran with zero pending steps.

The direct matrix covers every PF2E class plus maintained variant/fallback cases. The incremental matrix covers Fighter, Cleric, Sorcerer, Kineticist, Battle Creed, Way of the Spellshot, and Palatine Detective. Profile-specific assertions include:

- Battle Creed's Doctrine replacement, level-2 dedication, exact alternate prepared slots, Battle Font, and skill/static-grant fallbacks;
- Spellshot's way replacement, level-2 dedication, granted actions, Arcana-aware training, Intelligence-based arcane spellbook, four cantrips, and exactly two open cantrip preparation positions;
- Palatine Detective's Methodology replacement, persisted Occultism choice, level-2 dedication and Mystic Aegis, separate divine/occult Intelligence-based innate entries, and the same Guidance cantrip represented legally in both entries.

Artifact: `.wayfinder-smoke/release-0.4.0-full-4`.

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

The upstream target checked on 2026-07-04 was Foundry VTT 14.364 and PF2E 8.2.0. The 0.1.6 hotfix passed the full live smoke matrix against that pair in `.wayfinder-smoke/2026-07-04T18-00-52Z`, with 27 class cases passing and no classified/manual failures. This adds live coverage for Natural Ambition visibility, Scholar/Assurance preselection, Animist base spellcasting counts, and selected feat-owned grant choices such as Druid Order Explorer.

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

## 2026-07-04 Release 0.2.0 Full Matrix

Before tagging `v0.2.0`, the release code passed the full live matrix against Foundry VTT 14.364 / PF2E 8.2.0 in world `testing-world`: 28 cases passing, 0 classified/manual, 0 failed. The run used two 14-case chunks, including `fighter-samsaran-weapon-memory-l1-l5-apply-rerun`; every case applied to level 5 and reran with 0 pending steps. Artifacts: `.wayfinder-smoke/release-0.2.0-a` and `.wayfinder-smoke/release-0.2.0-b`.

## 2026-07-05 Post-Flag-Choice Full Matrix

After the standalone filtered flag-choice lane and same-item class-choice option-predicate work (plus the flag-choice prompt localization fix), the full matrix ran green against Foundry VTT 14.364 / PF2E 8.2.0 in world `testing-world`: 29 cases passing, 0 classified/manual, 0 failed, in two chunks (15 + 14). This includes the new `bard-multifarious-muse-l1-l5-apply-rerun` variant, which drafts Multifarious Muse at level 2, selects a second muse through the flag-choice step, selects the granted level-1 bard feat through the grant-choice step, applies to level 5, and reruns with 0 pending steps. Artifacts: `.wayfinder-smoke/slice5-matrix-a`, `.wayfinder-smoke/slice5-matrix-b`, and `.wayfinder-smoke/slice5-bard-localize` (post-fix bard re-verification).

## 2026-07-11 Initial Battle Creed Class-Archetype Lane

The dedicated class-archetype lane ran against Foundry VTT 14.364 / PF2E 8.3.0 in world `testing-world`. All six maintained cases passed with no native choice dialogs, no duplicate source IDs, successful draft cleanup, and zero pending rerun steps.

| Case | Result | Evidence |
| --- | --- | --- |
| Standard Cleric level 1 to 5 | Pass | Explicit Standard choice retained Doctrine, standard prepared slots, and normal Divine Font behavior |
| Battle Creed level 1 to 5 | Pass | Doctrine replacement, Battle Harbinger Dedication, exact prepared slots, Battle Font, Bane/Bless, and class-feat cadence verified |
| Incremental Battle Creed level 1 to 5 | Pass | Actor-owned profile was recovered; obsolete lower-rank prepared slots were removed and no profile items duplicated |
| Battle Creed with Acrobatics and Athletics already trained | Pass | Society was appended to the native skill ChoiceSet, persisted on the dedication, and applied without a native dialog |
| Battle Creed with actor-owned Toughness | Pass | Dedication's static grant used the drafted fallback feat without duplicating Toughness or consuming the ordinary general-feat slot |
| Battle Creed with drafted Shielded Fortune | Pass | Pending background Toughness was projected before apply; Fleet remained nested under the dedication and Incredible Initiative independently occupied the level-3 general-feat slot |

Artifact: `.wayfinder-smoke/class-archetype-final-2`.

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
- Standalone filtered no-grant `ChoiceSet` rules are guided through flag-choice steps when filters resolve to supported item types and required actor placeholders are known from draft context. Same-item class-choice option predicates are guided when later choices depend on earlier same-source class-choice roll options.
- Remaining embedded-`ChoiceSet` caveats are selected-item and equipment predicates, dynamic flags-path choices, and cross-item dependency graphs.
- Battle Creed, Way of the Spellshot, and Palatine Detective are guided through the dedicated class-archetype lane. Other class-archetype branch options stay filtered until a complete profile is registered.
- Free Archetype uses PF2E's separate `archetype` feat group. Wayfinder checks duplicate and own-class dedications, the ordinary two-feat dedication lockout, resolved archetype-family membership, and supported skill-rank prerequisites against projected draft state. Access entries, prose prerequisites, unresolved families, campaign permission, and feats whose text rewrites the lockout remain visible GM-confirmation boundaries.
- Daily preparations, ongoing purchasing, selling, crafting, rune transfer, retraining, and table-specific campaign systems remain PF2E-native/manual. Starting acquisition is guided only for an economically eligible new or GM-authorized replacement character; foreign or unresolved wealth produces a zero-write handoff.
