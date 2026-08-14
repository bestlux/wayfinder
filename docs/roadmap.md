# Wayfinder Roadmap

Updated 2026-08-14 after the 0.7.1 release. This is the forward-looking product plan; shipped behavior and exact evidence live in the [coverage matrices](coverage/) and [release smoke log](coverage/beta-readiness-smoke.md).

## Where Wayfinder stands

Wayfinder 0.7.1 guides all 27 PF2E classes from a blank level-1 actor through level 5 along one maintained path. Five representative profiles are verified through level 10 and Fighter through level 20. The current live release matrix contains 53 unique apply-and-rerun scenarios against Foundry VTT 14.364 and PF2E 8.4.0.

The common mechanical path now includes ancestry, heritage, background, class, supported class branches and class archetypes, feats, boosts, skills, languages, spells, Free Archetype, Ancestry Paragon and other PF2E campaign feat sections, and Gradual Ability Boosts. Archetype legality is checked against projected draft state where PF2E data is structured. Existing characters can be mapped and their spell progression audited without mutation.

GMs currently have world settings for supplemental Item packs and the spell-rarity ceiling. Players and GMs can open the Feedback panel from Wayfinder or Foundry settings. Three GitHub issues remain open:

- [#23 — prepare and execute actor mutations safely](https://github.com/bestlux/wayfinder/issues/23) is the 0.7.2 release focus.
- [#22 — allow temporarily invalid drafts and gate Apply](https://github.com/bestlux/wayfinder/issues/22) is a draft-editing improvement, not an apply-correctness prerequisite.
- [#7 — class archetypes at level 1](https://github.com/bestlux/wayfinder/issues/7) remains a parallel, profile-by-profile expansion track.

The largest remaining product gaps are starting equipment and wealth, a satisfying character-completion chapter, and high-level caster evidence beyond level 10. The largest correctness gap is that apply still crosses several PF2E mutation phases without one shared prepared plan.

## Product thesis

Wayfinder owns the journey from **blank actor to table-ready character** inside the world where that character will play. A proposed feature belongs when all three statements are true:

1. It is part of becoming table-ready, rather than ongoing play.
2. Foundry world context or direct actor integration makes the experience meaningfully better than a standalone planner.
3. Wayfinder can guide it confidently without becoming a second rules engine or a separate product.

This includes creation and progression choices, starting equipment, identity, and a clear completion state. It excludes daily preparations, downtime commerce, rune management, retraining, NPC construction, and image editing.

## Release train

### 0.7.2 — Apply Safety Bridge

The release is centered on issue #23. Before the first actor write, Wayfinder should prepare the selected sources, authoritative feat slots, choice targets, spell destinations, and campaign authority it can validate. Execution should expose named mutation phases, preserve the draft on failure, serialize retries, and compensate only where PF2E hooks make a narrow reversal safe.

This bridge deliberately precedes equipment. Starting wealth adds batch inventory and currency writes; those operations should join an established preparation/execution model instead of creating another mutation path.

Only beta-discovered correctness regressions should join 0.7.2. Draft-editing polish from #22 can follow in another 0.7.x patch if real-player testing shows it is urgent.

### 0.8.0 — Starting Equipment and Wealth

The short discovery is recorded in [Starting Equipment and Wealth Discovery](architecture/starting-equipment-and-wealth.md). The recommended first release is creation-time acquisition, not a persistent shop.

At level 1:

- Start from the official 15 gp budget.
- Offer the structured Adventurer's Pack and a searchable equipment picker with quantity, price, Bulk, hands, traits, rarity, level, and source context.
- Provide clearly labeled suggestions based on class proficiencies and trained skills. Remaster PF2E removed class kits, so Wayfinder must not describe suggestions as official class loadouts.
- Keep a running budget and apply the purchased physical items plus remaining currency as one prepared acquisition batch.

Above level 1:

- Use PF2E's Character Wealth lump sum as the 0.8.0 budget.
- Support a custom starting amount as an explicit GM override, not an inferred house rule.
- Show the permanent-items-plus-currency alternative as a documented handoff until its item-level allowance model ships.

GM policy should cover wealth mode, custom amounts, rarity ceiling, and supplemental sources. The first slice is for blank or new-character inventory; an actor with meaningful existing equipment receives an explicit PF2E-sheet handoff. Existing inventory is never cleared, repriced, or silently replaced.

Scope fence: no selling, merchant inventory, downtime shopping, rune transfer, automatic loadout optimization, or ongoing economy. Automatic Bonus Progression can change recommendations, but it does not justify a second equipment rules engine in 0.8.0.

### 0.8.1 — Equipment beta stabilization

Add the Character Wealth permanent-items-plus-currency path with its separate item-level allowances and fundamental-rune decisions. Reserve the same release for real-player findings: price and stacking edge cases, containers and nested kit contents, actor-size adjustments, granted equipment conflicts, unusual physical-item types, and GM policy wording. Expand suggested loadouts only when evidence supports reusable rules rather than class-name tables.

### 0.9.0 — Identity Epilogue and completion

Add an optional final chapter for name, pronouns, age, appearance, backstory, edicts and anathema, deity notes, portrait, and prototype token. Write to PF2E and Foundry fields the sheet already owns. File selection is in scope; image editing is not.

Replace the current anticlimactic empty state with a reviewable completion summary: key choices, equipment and remaining currency, honest handoffs, and a character-specific closing message. Issue #22 fits this arc if it has not already shipped as beta-driven 0.7.x polish.

### Parallel breadth — class archetypes

Continue #7 without blocking the main release train. Each profile needs complete planning, apply, rerun, and live evidence; a `class-archetype` tag alone is not a support claim. Prioritize shared training/grant substrate, then the most requested and structurally regular profiles.

## What 1.0 means

Wayfinder 1.0 is the first release where a player can take a blank official PF2E character to a mechanically complete, equipped, identified, and reviewable actor without a required trip to another sheet tab on the common path.

The release gate is evidence, not feature count:

- all 27 classes retain a maintained level-1-to-5 path;
- representative martial, skill-heavy, prepared, spontaneous, and bounded profiles remain verified through level 10;
- at least one prepared and one spontaneous caster are verified through ranks 6–10 and the level-19/20 milestones;
- starting wealth and equipment apply idempotently through the shared prepared mutation model;
- core archetype legality is filtered from projected state, with remaining prose or campaign judgments labeled before selection;
- failures preserve the draft and do not leave a silently partial actor;
- the completion review names every remaining native or GM handoff;
- real-player beta testing has completed a documented soak period without an unresolved release-blocking data-loss or partial-apply defect.

Class-archetype breadth beyond the registered profiles is valuable but does not block 1.0 when unsupported profiles remain honestly hidden. A full generic PF2E rule-element interpreter is not a 1.0 goal.

## Non-goals

- NPC or creature building
- Pathbuilder import/export
- daily preparations and alchemical daily allocation
- downtime commerce, selling, rune management, or merchant simulation
- retraining
- image editing
- homebrew content authoring
- non-PF2E systems

Allowlisted third-party Item packs remain supported where their documents use rule shapes Wayfinder can validate.

## Documentation contract

- [README.md](../README.md) is the player-facing overview and current support promise.
- [Coverage matrices](coverage/) are evidence-first references, not roadmap promises.
- [Development](development.md) and [release packaging](release-packaging.md) are maintainer how-to guides.
- [Architecture notes](architecture/) explain current module ownership and design decisions.
- [The 2026-07-26 issue backlog](issue-backlog-2026-07-26.md) is a historical triage snapshot; live issue state is on GitHub.
