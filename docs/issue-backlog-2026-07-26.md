# Ranked GitHub Issue Backlog — 2026-07-26

This review covers every open GitHub issue as of 2026-07-26: #15, #14, #13, #12, #11, #10, and #7.

The ranking weighs rules and data correctness first, then whether the issue blocks a core build path, affected-user breadth, implementation confidence, and dependency cost. Issues #10–#15 target v0.6.0 and must not be closed until the release tag and published artifacts are verified. Issue #7 remains open by design.

## Ranked backlog

| Rank | Priority | Issue | Validity | Resolution plan |
| ---: | :---: | --- | --- | --- |
| 1 | P0 | [#15 — Drafted skill increases ignore earlier draft training](https://github.com/bestlux/wayfinder/issues/15) | Valid defect | Ship the level- and kind-aware projected-skill ordering fix and regression in v0.6.0. |
| 2 | P1 | [#11 — Many language choices missing](https://github.com/bestlux/wayfinder/issues/11) | Valid defect | Use PF2E's configured campaign language pool, exclude unavailable languages, and mark ancestry-external options as requiring GM approval. |
| 3 | P1 | [#14 — Only common spells can be selected](https://github.com/bestlux/wayfinder/issues/14) | Valid rules-access gap | Add an explicit saved per-step restricted-rarity control while preserving tradition, rank, cantrip, source, curriculum, and fixed-allowlist policy. |
| 4 | P2 | [#10 — Convert preexisting characters](https://github.com/bestlux/wayfinder/issues/10) | Valid workflow gap | Import a non-mutating, level-by-level history of observable actor choices and mark ambiguous historical decisions for review instead of inferring them. |
| 5 | P2 | [#13 — Compendium allowlist setup is too manual](https://github.com/bestlux/wayfinder/issues/13) | Valid usability gap | Support exact IDs, module-prefix wildcards, and a global wildcard over installed Item compendiums; fail closed on unsupported wildcard syntax. |
| 6 | P3 | [#12 — Prefix the settings page with PF2e](https://github.com/bestlux/wayfinder/issues/12) | Valid convention mismatch | Rename the manifest title that Foundry uses as the module settings category label. |
| 7 | Deferred | [#7 — Class archetypes at level 1](https://github.com/bestlux/wayfinder/issues/7) | Valid underlying gap; report is partially stale | Keep open. Three class archetypes are now supported; the remaining ten require shared policy and profile-specific work before they can be exposed safely. |

## Evidence and acceptance

### 1. Issue #15 — projected skill ranks

- Issue evidence: a level-1 draft training choice still appeared untrained in the level-3 skill-increase pane.
- Code evidence: `projectSkillRanks` compared heterogeneous `skill-training-*` and `skill-increase-*` slot IDs lexicographically. A level-1 training slot such as `skill-training-wizard-level-1` sorted after `skill-increase-level-3` and was skipped.
- Acceptance: earlier drafted training contributes to every later skill-increase projection, same-level training precedes an increase, and later choices remain excluded.

### 2. Issue #11 — PF2E language pool

- Issue evidence: PF2E offered Goblin while Wayfinder omitted it and had no GM-approved path.
- Code evidence: `resolveSelectableLanguages` replaced the configured PF2E pool with the ancestry's explicit list whenever that list was non-empty. Draft resynchronization then removed any broader choice.
- Acceptance: choices come only from `CONFIG.PF2E.languages`, campaign-unavailable entries stay hidden, explicit ancestry options remain ordinary choices, other configured options show a GM-approval boundary, and selected valid options survive draft recomputation.

### 3. Issue #14 — spell rarity access

- Issue evidence: the picker rendered rarity metadata but Witch spell steps exposed common spells only.
- Code evidence: `restrictToCommon` removed non-common spells in pack policy before the rarity filter UI received them.
- Acceptance: restricted rarities remain hidden by default; an explicit per-step control exposes them with rules-access/GM-approval copy; source pack, tradition, spell rank, cantrip, curriculum, and explicit allowlist rules remain unchanged; the choice persists through save and reopen.

### 4. Issue #10 — existing-character history

- Issue evidence: completed actors produced no Wayfinder steps, while partial actors began at their current level with no earlier history.
- Code evidence: fulfilled singleton and feat milestones are intentionally removed from the pending plan, and historical boost, skill, and spell steps begin after the actor's current level. Present totals do not prove when historical skill increases or creation boosts occurred.
- Acceptance: the import maps source-backed foundations, PF2E native feat slots and cadences, and stored level-specific boosts without mutating build data; ambiguous boosts, skill ranks, embedded choices, and empty slots are marked for review; the imported report persists across later draft application and can be refreshed.

### 5. Issue #13 — compendium wildcard discovery

- Issue evidence: users had to identify every supplemental pack ID even when all packs came from one module.
- Code evidence: allowlist strings were passed directly to `game.packs.get`, so `module.*` and `*` were treated as literal missing pack IDs.
- Acceptance: exact pack IDs remain supported; `module-id.*` expands only to installed Item packs with that exact prefix; `*` expands to every installed Item pack; unsupported wildcard shapes add nothing; existing type, rarity, level, UUID, and context filters still apply.

### 6. Issue #12 — settings category name

- Issue evidence: Wayfinder sorted away from the PF2e-prefixed module group in Foundry settings.
- Code evidence: Foundry 14 builds module settings categories from the manifest's `module.title`; the manifest used `Wayfinder — PF2E Character Builder`.
- Acceptance: after a Foundry reload, the settings category reads `PF2e - Wayfinder Character Builder`.

## Deferred issue #7 plan

PF2E 8.3.0 contains 13 level-1 `class-archetype` documents. Wayfinder already supports Battle Creed, Way of the Spellshot, and Palatine Detective. The ten unsupported profiles are Bloodrager, Vindicator, Seneschal, Runelord, Warrior of Legend, Avenger, Flexible Spell Preparation, Light Mortar Innovation, Wellspring Magic, and Elemental Magic.

The report cannot be resolved safely by adding registry rows. The class-archetype contract requires complete planning, application, rerun, and level-5 evidence.

1. **P0 shared substrate**
   - Add profile-owned training replacement/addition policy, including fixed-skill suppression, replacement formulas, and deity-skill projection.
   - Add selector-independent class-archetype discovery for profiles that do not replace an existing class selector.
   - Generalize forced dedication, static/conditional item, action, and spell grants with apply/rerun adoption.
2. **P1 requested profiles**
   - Bloodrager: Barbarian training replacement, Medicine/Athletics policy, Arcana-or-Nature dedication choice, and level-2 dedication reservation.
   - Vindicator: Ranger training replacement, deity and sanctification choices, favored-weapon policy, divine warden spellcasting, Vindicator's Mark, and dedication.
3. **P2 substrate proofs**
   - Light Mortar Innovation, then Avenger.
4. **P3 complex class rewrites**
   - Runelord, Warrior of Legend, and Seneschal.
5. **P4 cross-class spellcasting variants**
   - Flexible Spell Preparation, Wellspring Magic, and Elemental Magic as separate initiatives.

Every eventual profile needs a blank direct level 1→5 apply and zero-step rerun, an existing-character incremental apply and rerun, exact skill/grant/spell destinations, preserved ordinary level-4 class feat behavior, no unexpected PF2E chooser dialogs, and a focused Free Archetype overlay check.
