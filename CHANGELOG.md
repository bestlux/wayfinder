# Changelog

## 0.7.0 - 2026-08-10

- **PF2E 8.4 fix:** applying a Summoner no longer hangs. PF2E 8.4 changed the eidolon's tradition choice to a form Wayfinder did not recognize, so it was never offered or answered and PF2E waited on it indefinitely, leaving the character partly built. Apply now also fails with a clear message rather than waiting without end.
- Archetype eligibility is checked rather than disclaimed. Wayfinder verifies that a dedication is not a duplicate or your own class's multiclass entry, that an existing dedication is not still owed two feats from its archetype, that an archetype feat belongs to a family you have a dedication for, and that supported skill-rank prerequisites are met — counting choices you have drafted, not only applied.
- Choices carried by granted items are guided or announced instead of surprising you at apply. Cleric Dedication's deity and sanctification, Summoner Dedication's eidolon, and Commander's five tactics are planned in Wayfinder; anything still unmodelled says so on the option before you pick it.
- Choices whose own rule conditions are unmet are no longer offered. A Fighter taking Commander Dedication is asked for the two tactics the dedication grants, not the five a Commander receives.
- Ancestry Paragon and other campaign feat sections are planned. Wayfinder mirrors PF2E's own campaign feat sections, so variants supplied by a module or defined by a GM appear as feat steps and apply into the native group.
- Gradual Ability Boosts follows PF2E's world setting, spreading each four-boost milestone across its levels using the system's own allowance formula.
- Spell pickers show each spell's rank, filter by rank, and keep your current selections pinned in view — the difference between browsing 20 spells and 300.
- GMs can set a world-wide spell rarity ceiling, so players see the uncommon or rare options a table allows without needing to find the per-step control.
- Existing characters get a spell audit. Map Existing Character now reports whether a caster's known, spellbook, or repertoire contents match expectations for their level, naming deficits and marking surpluses for review without changing anything.
- Witch familiars start with the spells they actually know — ten cantrips, five 1st-rank spells, and the patron's lesson spell — rather than the smaller daily-preparation numbers.
- General feat slots admit skill feats, with trained, expert, master, and legendary prerequisites all enforced against drafted training.
- Picker context notes wrap instead of truncating, so filter explanations can be read in full.
- Verified against Foundry VTT 14.364 and PF2E 8.4.0 with a 53-case live matrix: 41 direct builds, seven existing-character incremental upgrades, three Free Archetype paths, Ancestry Paragon, and Gradual Ability Boosts. Five classes reached level 10 and one reached level 20 — the first release coverage above level 5.

## 0.6.1 - 2026-07-26

- General feat slots now admit qualifying skill feats while respecting projected skill ranks and other prerequisites across a multi-level draft.
- Witch familiar learned-spell choices now appear at their later progression levels and apply to the familiar's spellcasting entry instead of stopping after level 1.
- Existing-character history stays contained within its report panel, and Wayfinder's panels retain readable colors across Foundry themes.
- Gradual Ability Boosts now follows PF2E's world setting, splitting each normal four-boost milestone across the appropriate levels and applying the accumulated boosts correctly.
- Skill choices now use a consistent responsive grid, making long training and increase lists easier to scan.

## 0.6.0 - 2026-07-26

- Multi-level drafts now carry earlier skill training into later skill increases, so planned ranks stay accurate before anything is applied.
- Bonus-language choices now use PF2E's configured campaign pool, honor unavailable-language settings, and clearly mark ancestry-external options that need GM approval.
- Spell choices can explicitly include uncommon, rare, and unique options when the rules grant access or the GM approves them, without relaxing tradition, rank, cantrip, curriculum, or source restrictions.
- Existing characters can map their observable foundations, native feat slots, and stored level boosts into a non-mutating level-by-level history; ambiguous historical choices remain visibly marked for review.
- Supplemental compendium allowlists now accept `module-id.*` and global `*` wildcards while preserving existing item, rarity, level, and context filtering.
- Wayfinder's Foundry settings category now uses the PF2e prefix so it sorts with other PF2e modules.

## 0.5.1 - 2026-07-22

- Scoped Wayfinder's navigation button styling to its own character-builder window so it no longer overrides Calandaria controls that use the same class name.

## 0.5.0 - 2026-07-11

- Added a dedicated Free Archetype lane that appears automatically when PF2E's Free Archetype variant is enabled.
- Free Archetype choices use PF2E's separate even-level `archetype` slots, preserving ordinary class-feat progression on direct and existing-character level-ups.
- The picker mirrors PF2E's native dedication-then-archetype pool, blocks duplicate selections, and clearly marks access, prerequisites, archetype-family membership, and dedication lockouts as GM-confirmation boundaries.
- Added safe smoke-harness control for the Free Archetype world setting, including expected-world and destructive-operation guards plus automatic restoration.
- Verified the release against Foundry VTT 14.364 and PF2E 8.3.0 with the existing 42-case baseline plus four direct/incremental Archer and Acrobat Free Archetype cases.

## 0.4.0 - 2026-07-11

- Added complete level 1–5 guidance for Way of the Spellshot and Palatine Detective alongside Battle Creed's existing class-archetype lane.
- Spellshot characters now receive their level-2 dedication, Intelligence-based arcane spellbook, four chosen cantrips, and two open cantrip preparation positions without consuming the level-4 class feat.
- Palatine Detective characters now persist their Occultism-or-Religion choice, receive separate Intelligence-based divine and occult innate cantrips, and apply their level-2 dedication and granted abilities.
- Class-feature skill choices and spells shared across separate spellcasting entries now stay in the correct destination without duplicate native prompts or unrelated entry changes.
- Verified the release against Foundry VTT 14.364 and PF2E 8.3.0 with 35 direct level-1-to-5 cases and seven incremental level-up cases.

## 0.3.0 - 2026-07-05

- Feats and options that configure a choice without granting an item are now guided instead of hidden, including Multifarious Muse, Bard Dedication, Adopted Ancestry, Celestial Magic, and related options.
- More dependent class choices stay consistent when you change an earlier pick, including same-item follow-up choices such as Elemental Instinct damage types.
- Choice prompts now use localized text instead of showing raw translation keys.
- Simplified Chinese now activates correctly with Foundry's Chinese community localization stack.
- Coverage tracking now distinguishes more embedded-choice shapes, improving the public readiness audit behind future guided choice work.

## 0.2.0 - 2026-07-04

- Unlocked guided embedded ChoiceSet coverage for 184 more census entries: 99 direct feat entries and 85 class-branch options now stay visible when every embedded choice has a supported follow-up.
- Added guided feat config-string choices for `baseWeaponTypes`, `creatureTraits`, `saves`, and `weaponGroups`, including the Samsaran Weapon Memory smoke case for two base-weapon selections.
- Expanded static-UUID grant coverage so more direct feat grants and branch options can be selected, preseeding supported native PF2E follow-up choices where needed.
- Fixed predicate-backed class-branch visibility so already-guided branches remain visible while unsupported tag-filter branches still stay hidden.
- Internal: refactored pack service boundaries and reorganized the README around public coverage and release readiness.

## 0.1.6 - 2026-07-04

- Fixed Human Natural Ambition and similar supported embedded grant-choice feats being hidden from relevant pickers.
- Fixed Animist spellcasting planning and created spellcasting entries so Wayfinder models the base Animist prepared slots without adding apparition capacity.
- Fixed Scholar-style background grants so Assurance receives the drafted skill preselection before PF2E creates the native granted feat.
- Added Simplified Chinese localization.
- Verified the hotfix against Foundry VTT 14.364 / PF2E 8.2.0 with the full live smoke matrix and bumped PF2E package compatibility metadata to 8.2.0.

## 0.1.5 - 2026-05-22

- Scoped Wayfinder rarity text styling so PF2E item text outside Wayfinder no longer inherits incorrect common, uncommon, rare, or unique colors.
- Added Foundry Package Release API publishing support to the tag release workflow, including dry-run validation before registering a package version.
- Added release-note extraction so GitHub releases and Foundry package version records point at a concrete version-specific notes page.

Older release notes are available from the GitHub Releases page.
