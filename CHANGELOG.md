# Changelog

## 0.8.5 - 2026-08-24

- Fixed missing wizard curriculum choices for Quantic Control, Keen Inquiry, Mentalism, Nexian Spaces, and Magical Technologies by supporting PF2E's paragraph-wrapped list rows and standalone curriculum paragraphs.
- Wizard curriculum merging now accepts supplemental spell lists only from wizard class features and keeps nested or standalone rows inside explicit curriculum sections, preventing Oracle and Animist spell lists from leaking into multiclass wizard choices.

## 0.8.4 - 2026-08-23

- Fixed level-1 kit confirmation when the cart contains level-1 items. The final acquisition ledger now uses the same recipe-aware item-level boundary as catalogue browsing and prepared acquisition instead of rejecting an at-level item after allowing it into the cart.

## 0.8.3 - 2026-08-23

- Level-1 Starting Equipment now includes common level-1 items such as minor healing potions and elixirs of life. Both official level-1 recipe selections can spend the 15 gp budget on those items, while higher-level residual and lump-sum currency remains limited to items below the character's target level.

## 0.8.2 - 2026-08-23

- Starting Equipment now exposes the complete matching catalogue through an adaptive virtual list. The mounted window grows with Wayfinder's height, stays ahead of rapid and large scroll jumps, and preserves its host, focus, and scroll position while search, filters, previews, and cart changes update around it.
- Equipment results are ranked and filterable by policy availability, level, type, rarity, source, traits, and contextual Titan Mauler eligibility. Item previews include enriched rules text, Bulk, and hands, while cart quantities accept direct numeric entry for ammunition and other bulk purchases.
- Completed levels collapse into compact rail summaries, invalidated work reopens visibly, scrollable regions retain their positions across renders, result-count changes are announced to assistive technology, and reduced-motion preferences are respected.
- Catalogue browsing now reuses lightweight indexed facts, materializes only mounted or focused records, and skips unchanged stable index identities. Preview and Apply keep their fresh PF2E document, price, policy, and authority checks; browse caching never becomes transaction authority.
- The live catalogue profile now attributes normalization, policy, filtering, ranking, source assembly, pane assembly, mounted projection, and Foundry render stages, and fails closed on visible gaps, host replacement, stale work, unexpected document reads, or recovery drift.

## 0.8.1 - 2026-08-22

- Wayfinder now waits for its shared, retryable Handlebars partial preload before every full or scoped render, preventing a cold client from opening the app before newly installed picker templates are registered.
- GMs can decline a pending Starting Equipment request. A decline closes that exact request with an attributed audit record while allowing the player to ask for the same item again under a fresh request ID; approval and decline are serialized through Foundry's active GM and converge on one durable judgment across retries. Custom lump sums now replace superseded official-recipe provenance instead of producing a contradictory draft.
- Repeated currency purchases of the same stackable item now combine into one cart line and reprice from the total quantity. The next matching purchase also repairs duplicate stacks left by 0.8.0, while kits, configured gear, allowances, class grants, and explicitly separate items remain distinct.

## 0.8.0 - 2026-08-22

- Added guided Starting Equipment for eligible new and replacement characters. Level 1 uses the official 15 gp budget; levels 2–20 support both remastered Character Wealth recipes, with permanent-item allowances and residual currency kept distinct from the optional lump sum.
- Added a searchable, source-isolated physical-item catalogue with quantities, actor-size pricing, supported configured gear, and deterministic Adventurer's Pack expansion that preserves nested quantities and container relationships.
- Added GM Equipment Policy, higher-level start authorization, custom lump sums, and item-specific rarity/source review. Actor owners can exercise only the choices the GM delegated; player spell-access attestations remain visibly different from GM equipment approval. ABP policy snapshots now consume PF2E's class-shaped runtime API so an actor's disable override is honored even when the world mode remains enabled.
- Starting acquisition now fails closed when an actor has foreign or unresolved physical wealth. Apply prepares exact sources, inserts a stable non-stacking batch, converges PF2E currency to an absolute target, and persists a non-replaceable completion manifest before clearing the draft. Interrupted writes retry forward without duplicating items or drifting currency.
- Reconciled supported physical grants from the prepared character build without charging the equipment budget or inserting a second copy. Live PF2E price objects are normalized at the document boundary, including their `credits` and `upb` fields, so native Dwarf Clan Dagger and Sarangay Head Gem grants no longer report false drift (issue #29).
- Corrected Champion archetype sanctification so unresolved holy and unholy causes remain selectable (issue #25), and restored Exemplar class feat choices such as Leap the Falls when their embedded choice rules use supported shapes (issue #26).
- Pickers now explain why structured options were suppressed instead of silently disappearing (issue #28), and feat browsing has inclusive minimum/maximum level controls that use the established spell-rank filter idiom (issue #27).
- Draft persistence now verifies the complete actor-flag round trip, preserves the newest pending snapshot after transient failure, and distinguishes retryable failures from conflicts, integrity errors, and permanent validation rejection with an actionable recovery message (issue #31).
- Removing or replacing a choice now writes an exact draft leaf instead of relying on Foundry's recursive flag merge, so deleted map keys stay deleted while unrelated Wayfinder and third-party flags survive. Existing-character history imports clear stale equipment intent, retain unrelated choices, and omit the creation-only shop without changing actor items or currency.
- Skill ranks now use one ordered progression model across preview, choice synchronization, readiness, and Apply. Fixed training such as Fencer's Deception is available at the correct level, later source grants cannot retroactively change earlier increases, and stale or changed selections fail closed before actor mutation. Structured Summoner eidolon tradition choices are guided and round-trip through PF2E 8.4.1.
- Fixed ancestry flaws now survive PF2E's prepared-document shape and participate in the same projected build state as ancestry boosts. Lizardfolk Intelligence and Elf Constitution flaws correctly affect later ability and skill choices, while alternate ancestry boosts still replace the printed boost-and-flaw set (issue #32).
- Completed the Starting Equipment interaction gates for English and Simplified Chinese, keyboard and focus behavior, fixed Foundry app widths, and the measured catalogue profile. Ongoing shopping, selling, crafting, rune transfer, and additive acquisition into existing inventory remain on the PF2E sheet.

## 0.7.5 - 2026-08-18

- Supplemental compendia can no longer expose companion, eidolon, and NPC support documents as player ancestries, heritages, or classes merely because those documents reuse PF2E's player-facing item types. The filter uses PF2E build and automation structure rather than names or creature traits, so unusual player options such as Battlezoo's Evil Eye, Slime, Angel, Intelligent Weapon, Dungeon, and Fusion remain available.
- Compendium settings now describe their counts as raw builder-item documents and explain that Wayfinder independently filters individual player choices, removing the misleading implication that every counted ancestry or heritage document is a valid player option.
- Added the first dormant 0.8.0 starting-equipment safety-kernel component: a versioned, cited semantic wealth policy. It does not add equipment UI or alter current character Apply behavior.

## 0.7.4 - 2026-08-18

- GMs can now configure supplemental PF2E Item compendia through a searchable checklist that reports relevant ancestry, heritage, background, class, feat, spell, and deity counts. Existing exact IDs and wildcard settings remain reviewable and removable even when their packs are unavailable.
- Third-party character content is filtered more defensively. Wayfinder discovers ancestry and class identities from enabled sources, isolates feats to the matching ancestry or class, quarantines ambiguous heritages and unsupported predicates, and clearly identifies choices whose custom mechanics still require manual review.
- Drafts autosave transactionally, Apply commands are serialized, and interrupted or multi-client Apply attempts preserve a durable recovery ledger instead of silently clearing or replaying partial work.
- Restricted spell access is captured as a reviewable player attestation and shown again at final confirmation and in the last-Apply receipt. The record is explicitly evidence supplied by the player, not verified GM authorization.
- Ancient Elf and similar grant-choice paths now surface Necromancer Dedication's dirge cantrips and skill fallback, and granted class feats no longer hide later class-feat milestones during incremental leveling.
- Large feat and spell searches render only the changing picker regions and discard superseded work, keeping rapid typing responsive without allowing stale results to replace newer ones.
- Completed characters keep their current and target levels visible in Wayfinder, so the next level can be planned directly instead of reopening to a blank workflow.
- Wayfinder now uses original module styling and icons for its generated spellcasting entries and includes an in-app Legal & Attribution link alongside the packaged notices.
- PF2E 8.4's Necromancer and Runesmith base classes are not yet complete Wayfinder class paths; the supported Necromancer Dedication follow-on does not imply base-class coverage.

## 0.7.3 - 2026-08-14

- Verified Wayfinder against Foundry VTT 14 Stable 8 (14.366) and PF2E 8.4.0, including creation, level-up, campaign variants, and interrupted Apply recovery.
- Updated Foundry compatibility metadata so Stable 8's package delivery system can select the release using its exact tested core version.

## 0.7.2 - 2026-08-14

- Applying a draft now checks its selected sources, current PF2E choices, feat slots, and spell destinations before changing the character whenever those details are available.
- Rapid or repeated Apply actions are handled one at a time. Retrying after an interrupted Apply no longer repeats skill increases or races an earlier update.
- If PF2E rejects a later item or spell operation, Wayfinder keeps the draft for review and retry instead of marking an incomplete character as finished. The error now identifies where Apply stopped so a GM can diagnose the result more safely.

## 0.7.1 - 2026-08-14

- Applying a stale draft no longer removes an existing ancestry, heritage, background, or class when its replacement source cannot be resolved or PF2E rejects creation. Wayfinder validates the entire singleton batch before mutation, lets PF2E own singular-item replacement, and restores the previous batch if creation fails.
- Night Watch and similar backgrounds now parse named-or-contextual Lore choices correctly, and bonus languages place the GM-approval catalogue behind one compact disclosure with equal-sized options.
- Feedback now opens a polished, player-friendly support panel from Wayfinder or Foundry's module settings. It clearly explains that GitHub reports are public, prefills the Wayfinder, Foundry, and PF2E versions, and offers approachable problem and suggestion forms instead of bug-tracker jargon.
- Players who are unsure whether something is supported—or who prefer not to use GitHub—can jump to the coverage matrices or contact the maintainer on Discord. Privacy guidance now names the player names and world invite links that screenshots can accidentally expose, and the footer control works cleanly with tooltips, keyboards, and voice control.

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
