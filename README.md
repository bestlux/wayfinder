<div align="center">

# Wayfinder

**A guided Pathfinder 2e character builder, built into Foundry VTT.**

[![Latest release](https://img.shields.io/github/v/release/bestlux/wayfinder?label=release&color=2b6cb0)](https://github.com/bestlux/wayfinder/releases/latest)
![Foundry VTT v14](https://img.shields.io/badge/Foundry%20VTT-v14-e26a26)
![PF2E 8.4.1+](https://img.shields.io/badge/PF2E%20system-8.4.1%2B-8a2422)
[![Legal](https://img.shields.io/badge/legal-notices-6b7280)](LEGAL.md)

</div>

Character creation and leveling in PF2E means juggling class tables, compendium browsers, feat slots, boosts, spell lists, equipment, and source exceptions. Wayfinder turns all of that into a single guided flow you open straight from the character sheet. It knows which sources your GM enabled, narrows each picker using the rules it can verify, and writes the result directly to the actor. No JSON export, no re-import, no sheet-mismatch cleanup.

## Highlights

- **One flow from level 1 to level up.** Ancestry, heritage, background, class, class branches, feats, boosts, skill increases, languages, spells, and Starting Equipment — all in order, in one window.
- **Reviewed Starting Equipment.** Build a running-budget cart, use the Adventurer's Pack shortcut, or keep all starting currency under the recipe and sources your GM enabled.
- **Dedicated class-archetype decisions.** Battle Creed, Way of the Spellshot, and Palatine Detective are guided as complete progression profiles instead of ordinary subclass options.
- **Native Free Archetype slots.** When PF2E's Free Archetype variant is enabled, Wayfinder adds separate even-level archetype choices without consuming normal class feats.
- **Earlier picks filter later ones.** You stop scrolling past feats and options you can't take anyway.
- **Beginner-friendly, veteran-fast.** Each step explains what you're choosing; experienced players just search, pick, next.
- **Respects your table.** Rarity and source filters on every picker, with a GM spell-rarity ceiling and optional allowlists for non-official packs.
- **Resumable drafts.** Progress is saved on the actor, so you can leave mid-build and come back later.
- **Honest about its limits.** When Wayfinder can't model a step confidently, it says so and points you at the right native PF2E control instead of silently guessing.

## What's new in 0.8.0

- **Starting Equipment from intent to receipt.** New and authorized replacement characters can choose either official higher-level wealth recipe, use GM-approved sources and exceptions, purchase exact quantities, expand an Adventurer's Pack, and keep a durable acquisition receipt after Apply.
- **Safe acquisition and retry.** Wayfinder prepares exact compendium sources, reconciles native physical grants without charging twice, converges currency to an absolute target, and retries interrupted work without duplicating items or replacing a completed manifest.
- **Creation and level-up stay distinct.** Existing-character imports preserve settled history and unrelated actor flags while suppressing the creation-only shop and clearing stale equipment intent.
- **More trustworthy pickers.** Champion sanctification, Exemplar embedded choices, inclusive feat-level filters, fixed ancestry flaws, and ordered skill-rank projection now follow PF2E's prepared data more accurately. When eligibility cannot be validated, the picker explains the suppression instead of silently dropping options.
- **Measured Foundry-native UX.** The equipment flow includes English and Simplified Chinese coverage, keyboard and focus handling, responsive fixed-window layouts, and a qualified catalogue interaction profile.

## Installation

Paste this manifest URL into Foundry's **Install Module** dialog:

```text
https://github.com/bestlux/wayfinder/releases/latest/download/module.json
```

Foundry's package updater will follow it for future versions. Older releases stay installable from their own [release pages](https://github.com/bestlux/wayfinder/releases).

**Requirements:** Foundry VTT v14 with the PF2E system 8.4.1 or newer. Release 0.8.0 is verified against Foundry VTT 14.366 and PF2E 8.4.1, including its exact-candidate live matrix and package binding.

## Using Wayfinder

1. Open an owned PF2E character actor.
2. Click the **Wayfinder** action in the sheet header.
3. Walk the steps. Drafts save as you go, including the Starting Equipment cart.
4. Review the final choices, equipment, remaining currency, approvals, and any PF2E-sheet handoffs.
5. Apply when you're ready — Wayfinder writes the supported changes to the actor.

Wayfinder is a planning layer on top of the PF2E system, not a replacement for it. The actor and its items remain the source of truth; Wayfinder's job is to get you to a clean, valid state without clicking through twelve places to do it.

Wayfinder evaluates ancestry boosts and fixed ancestry flaws before it calculates later choices, so ability projections, skill training, and supported prerequisites follow the effective character build. Selecting PF2E's alternate ancestry boosts replaces the printed boost-and-flaw set as normal.

## Starting Equipment

Starting Equipment is creation-time acquisition, not a persistent shop. A blank level-1 character receives the official 15 gp budget. A higher-level new or replacement character requires a current GM-approved start context, then uses either the permanent-items-plus-currency recipe or the optional lump sum according to world policy. The catalogue shows price, quantity, Bulk, hands, traits, rarity, level, source, and allowance context; the Adventurer's Pack expands into its contained items during Apply.

Before applying, check the review for three trust boundaries:

- The GM controls equipment sources, available recipes, custom amounts, and uncommon or otherwise restricted exceptions. An actor owner can choose a recipe only when the GM delegated that choice.
- Wayfinder acquires equipment only for an economically eligible actor. Existing or unresolved physical items or currency produce an explicit, zero-write handoff to the PF2E sheet; Wayfinder never clears, reprices, or merges into that inventory.
- Supported physical items granted by the same prepared character build are reconciled in a locked no-charge lane. Unresolved grant chains fail closed instead of being guessed into the budget.

A successful acquisition leaves a durable manifest for audit and safe retry. It is not an undo record. Ongoing purchases, selling, crafting, rune transfer, and inventory optimization remain PF2E-native workflows.

## Class support

Wayfinder has a verified guided path from a blank level-1 character through level 5 for the 27 classes listed below — including class branches (instincts, doctrines, bloodlines, mysteries, and the rest), feat milestones, skill training, boosts, and spellcasting setup for prepared, spontaneous, spellbook, and bounded casters. PF2E 8.4 also introduced Necromancer and Runesmith as base classes; those two are not yet modeled as complete class paths. Necromancer Dedication's supported Ancient Elf follow-on is separate from base-class support.

Five representative profiles are verified further, to level 10: a martial (Fighter), a prepared caster (Wizard), a spontaneous caster (Bard), a bounded caster (Magus), and a skill-heavy class (Investigator). One class — Fighter — is verified to level 20. Those runs check more than a clean apply: the ability-boost milestones at levels 10, 15, and 20 each spend four boosts into PF2E's native build data, skill increases land at the expected proficiency ranks through legendary, and caster pickers offer the spell ranks their progression allows. High-level *caster* play above level 10 is not yet proven — spell ranks 6 through 9 and the level-19/20 caster milestones remain unverified.

Three class-archetype profiles are guided through level 5. Battle Creed handles its Doctrine replacement, Battle Harbinger Dedication, alternate prepared progression, Battle Font, and grant fallbacks. Way of the Spellshot replaces Gunslinger's Way, applies Spellshot Dedication, and builds its Intelligence-based arcane spellbook. Palatine Detective replaces Investigator Methodology, persists its skill choice, creates separate divine and occult innate cantrips, and applies its dedication. Other class archetypes remain filtered until they have the same end-to-end support.

PF2E's Free Archetype variant is guided through its own even-level feat lane, applying choices to `archetype-2`, `archetype-4`, and later native slots.

Both that lane and ordinary class-feat slots share one archetype legality check. Wayfinder verifies that a new dedication is not a duplicate and not your own class's multiclass dedication, that an existing dedication is not still owed two feats from its archetype, that an archetype feat belongs to a family you actually have a dedication for, and that supported skill-rank prerequisites are met — counting choices you have only drafted, not just applied. This is stricter than PF2E's own picker, which checks only whether you have any dedication at all.

Some things still can't be verified from data, and Wayfinder shows those options rather than hiding them on a guess: dedications whose own text changes the lockout rule, feats whose archetype family can't be resolved, access entries, campaign permission, and prerequisites written as prose (feat, class-feature, and attribute requirements). Some dedication benefits and follow-on choices also exist only in prose and may still need manual setup on the PF2E sheet. Every dedication preview names that boundary so you and your GM can review the feat before and after applying it.

<details>
<summary><strong>27 maintained classes, verified through level 5</strong></summary>

Alchemist · Animist · Barbarian · Bard · Champion · Cleric · Commander · Druid · Exemplar · Fighter · Guardian · Gunslinger · Inventor · Investigator · Kineticist · Magus · Monk · Oracle · Psychic · Ranger · Rogue · Sorcerer · Summoner · Swashbuckler · Thaumaturge · Witch · Wizard

Each class is verified by a live in-Foundry test that builds a character from blank level 1 to level 5 and applies it to the actor. That is one deterministic legal path per class — not exhaustive proof of every subclass, variant, or book option.

</details>

> **Status: beta.** Wayfinder is early-access software built slice by slice. If you want the fine print on exactly which choice shapes are guided today, the [level-1 coverage matrix](docs/coverage/level1-coverage-matrix.md), [level-up coverage matrix](docs/coverage/levelup-coverage-matrix.md), and [live smoke results](docs/coverage/beta-readiness-smoke.md) are the honest answer to "does it support my build yet."

### Not covered (yet)

These stay in the native PF2E sheet for now, and Wayfinder will tell you so when they come up:

- Ongoing equipment shopping, selling, crafting, rune transfer, or additive acquisition into existing inventory
- Necromancer and Runesmith base-class paths
- Daily preparations
- Archetype requirements or benefits that only exist as prose — access entries, campaign permission, feat/class-feature/attribute prerequisites, manual follow-on setup, and dedications whose own text rewrites the lockout rule
- Class archetypes other than Battle Creed, Way of the Spellshot, and Palatine Detective
- Retroactive spell reconciliation for characters levelled outside Wayfinder — their earlier spell choices are treated as settled, and Wayfinder says so
- Retraining and table-specific campaign systems

## Feedback

The **Feedback** button in Wayfinder's footer is the shortest path — it opens the right form with your Wayfinder, Foundry, and PF2E versions already filled in. The same panel is available under **PF2e - Wayfinder Character Builder** in Foundry's module settings. You can also go straight to [GitHub issues](https://github.com/bestlux/wayfinder/issues) to [report a problem](https://github.com/bestlux/wayfinder/issues/new?template=bug-report.yml) or [suggest an idea](https://github.com/bestlux/wayfinder/issues/new?template=feature-request.yml), or reach the maintainer on Discord: `bestlux`.

If Wayfinder handed a step back to the PF2E sheet, check the [coverage matrices](docs/coverage) first — that step may not be guided yet rather than broken.

## Development

The current product direction and planned arcs live in [docs/roadmap.md](docs/roadmap.md). Build, test, local-linking, and smoke-harness instructions live in [docs/development.md](docs/development.md). Release packaging is documented in [docs/release-packaging.md](docs/release-packaging.md).

## Legal & attribution

[LEGAL.md](LEGAL.md) is the entry point for Wayfinder's notices. It separates the terms for original Wayfinder software from the [ORC notice](licenses/ORC-NOTICE.md), retained [OGL 1.0a material](licenses/OPEN-GAME-LICENSE-1.0A.md), and [third-party notices](licenses/THIRD-PARTY-NOTICES.md).

Wayfinder uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo's Community Use Policy (paizo.com/licenses/communityuse). We are expressly prohibited from charging you to use or access this content. Wayfinder is not published, endorsed, or specifically approved by Paizo. For more information about Paizo Inc. and Paizo products, visit paizo.com.

Wayfinder is free and unofficial. It requires an independently installed PF2E system and does not package PF2E compendium packs or Paizo rulebook pages. Foundry Virtual Tabletop is owned by Foundry Gaming LLC; Wayfinder is not affiliated with or endorsed by Foundry Gaming LLC or the PF2E system team.
