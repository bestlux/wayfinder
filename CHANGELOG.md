# Changelog

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
