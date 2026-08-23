# Wayfinder Roadmap

Updated 2026-08-23 for the 0.8.2 Starting Equipment stabilization work. This is the forward-looking product plan; shipped behavior and exact evidence live in the [coverage matrices](coverage/) and [release smoke log](coverage/beta-readiness-smoke.md).

## Where Wayfinder stands

Release 0.8.0 added reviewed Starting Equipment to Wayfinder's existing guided creation and level-up flow. The 0.8.1 and 0.8.2 stabilization work hardens real-player request, stacking, cold-template, catalogue-reachability, and interaction-performance paths without weakening acquisition authority. The adaptive catalogue retains the complete lightweight matching shelf, mounts a bounded window around the viewport, and keeps preview and Apply on fresh PF2E authority. Wayfinder continues to guide 27 maintained PF2E classes through level 5 along one maintained path, five representative profiles through level 10, and Fighter through level 20. Necromancer and Runesmith base classes remain outside that maintained class matrix.

The common mechanical path now includes ancestry, heritage, background, class, supported class branches and class archetypes, feats, boosts, skills, languages, spells, Free Archetype, Ancestry Paragon and other PF2E campaign feat sections, Gradual Ability Boosts, and creation-time Starting Equipment. Archetype legality is checked against projected draft state where PF2E data is structured. Existing characters can be mapped and their spell progression audited without mutation. Adjacent 0.8.0 player-trust hardening also projects PF2E-prepared fixed ancestry flaws before later ability and skill choices (issue #32).

GMs currently have world settings for Equipment Policy, supplemental Item packs, and the spell-rarity ceiling. Players and GMs can open the Feedback panel from Wayfinder or Foundry settings. With issue #23 completed in 0.7.2, the remaining open work is:

- [#22 — allow temporarily invalid drafts and gate Apply](https://github.com/bestlux/wayfinder/issues/22) supplied the shared readiness and review foundation now used by the 0.8.0 cart. Its remaining scope is broader draft-editing UX and bookkeeping, not an apply-correctness prerequisite.
- [#7 — class archetypes at level 1](https://github.com/bestlux/wayfinder/issues/7) remains a parallel, profile-by-profile expansion track.

After 0.8.0, the largest remaining product gaps are a satisfying character-completion chapter and high-level caster evidence beyond level 10. The apply path now prepares supported authority and sources before writing, executes named per-actor phases, verifies outcomes, and retains the draft when a phase fails.

## Product thesis

Wayfinder owns the journey from **blank actor to table-ready character** inside the world where that character will play. A proposed feature belongs when all three statements are true:

1. It is part of becoming table-ready, rather than ongoing play.
2. Foundry world context or direct actor integration makes the experience meaningfully better than a standalone planner.
3. Wayfinder can guide it confidently without becoming a second rules engine or a separate product.

This includes creation and progression choices, starting equipment, identity, and a clear completion state. It excludes daily preparations, downtime commerce, rune management, retraining, NPC construction, and image editing.

## Release train

### 0.7.3 — Foundry 14 Stable 8 compatibility

Wayfinder is verified against Foundry 14 build 366 and advertises that exact build in its package compatibility metadata. The release smoke harness supports Stable 8's username-autocomplete world login as well as the earlier Foundry 14 selector, and the full release matrix confirms that Foundry's package-delivery and login changes do not alter Wayfinder's character-building or Apply behavior.

### 0.7.2 — Apply Safety Bridge

The release centered on issue #23. Before the first actor write, Wayfinder prepares the selected sources, authoritative feat slots, choice targets, spell destinations, and campaign authority it can validate. Execution exposes named mutation phases, preserves the draft on failure, serializes retries, and compensates only where PF2E hooks make a narrow reversal safe.

Shipped in 0.7.2: Wayfinder retains prepared sources instead of resolving them again during execution, validates scalar and item choices, pins campaign authority, verifies PF2E-created outcomes and planned feat locations before finalization, serializes the final actor update and draft clear with every earlier phase, and records phase receipts. The exact candidate passed adversarial review and a live failure/retry probe in addition to the full release matrix.

This bridge deliberately precedes equipment. Starting wealth adds batch inventory and currency writes; those operations should join an established preparation/execution model instead of creating another mutation path.

### 0.7.4 — Pre-equipment compatibility and workflow hardening

Before equipment branches into catalogue, ledger, and Apply work, 0.7.4 ships independently useful improvements: measured and scoped picker rendering, truthful draft persistence and Clear protection, shared readiness evaluation, interrupted-Apply recovery, restricted-spell attestations, a searchable GM compendium source manager, and fail-closed third-party filtering. The generated Character Wealth policy remains internal foundation; this release does not claim the 0.8.0 equipment experience.

### 0.8.0 — Starting Equipment and Wealth

The accepted design is recorded in [Starting Equipment and Wealth Architecture](architecture/starting-equipment-and-wealth.md), its provenance contract lives in [Starting Equipment Rules Assurance](architecture/starting-equipment-rules-assurance.md), and implementation status plus exact evidence live in the [0.8.0 implementation plan](development/starting-equipment-0.8.0.md). Required functional work through Wave 4, WF-080-51's exact-candidate matrix, and WF-080-52's package and publication proof are complete. The release is creation-time acquisition, not a persistent shop.

Rules and policy:

- Generate the remastered Character Wealth numbers from a pinned PF2E fixture with explicit source provenance and compatibility-smoke drift checks. Prose legality rules receive separate citations and semantic tests because the installed journal contains the table but not those rules.
- Support both official higher-level recipes in 0.8.0: permanent items plus currency, and the optional lump-sum alternative. A GM can fix the recipe or let the actor owner choose between the enabled official recipes.
- Support an absolute custom lump sum as a GM-authoritative per-draft override. Do not expose arbitrary permanent-item schedules.
- Keep Common as the default blanket availability inside GM-approved equipment sources. A source-backed character Access can authorize its named restricted item; other rarity/source exceptions require a real GM-authoritative command, not an owner-controlled trust toggle.
- Snapshot the effective policy for explanation and drift diagnostics. Apply re-evaluates current policy and blocks only when a selected item, allowance, budget, authority, or expected outcome materially changed.

Acquisition experience:

- Start level-1 characters from the official 15 gp budget. At higher levels, show permanent-item allowances separately from residual currency, including its consumable/lower-level-item restriction, or the selected lump-sum budget.
- Offer the structured Adventurer's Pack and a searchable equipment catalogue with quantity, price, Bulk, hands, traits, rarity, level, source, availability, and allowance context.
- Reconcile physical equipment explicitly granted by the same prepared build in a separate no-charge lane, including exact class, ancestry, heritage, background, and feat provenance; never infer that arbitrary existing inventory was “PF2E-granted.”
- Quick Equipment Packages were cut from 0.8.0 as one complete slice; no partial package set ships. The cited Player Core and Player Core 2 packages can be reconsidered in a later release. Unreviewed classes receive no implied package, and Wayfinder-derived suggestions remain later work.
- Treat `keep all currency` as a positive completed disposition, not a blocked empty cart.
- Protect draft work with truthful persistence state, default-cancel Clear confirmation, actionable readiness reasons, Apply progress, and a reviewable success receipt.

Apply and trust:

- Replace guessed “new character” eligibility with an economic baseline captured before mutation. Above level 1, economic emptiness is necessary but not sufficient: a recorded, currently authorized new/replacement start-context claim is also required. Economically empty actors and source-backed grants from the same prepared build can then use world policy; any unresolved or foreign physical inventory or currency receives an explicit PF2E-sheet handoff in 0.8.0. Existing inventory is never cleared, repriced, merged into, or silently replaced.
- Pre-aggregate equivalent planned items, expand kits, preserve container links, and insert a deliberate non-stacking batch with stable batch and per-entry identity. Currency converges to an absolute aggregate target through PF2E inventory operations.
- Persist and verify the successful acquisition manifest before—or in the same ordered final write as—draft clear, and retain it on the actor afterward. It supports audit, retry diagnosis, and a future reversal feature; player-facing post-Apply undo is not part of 0.8.0.
- Record restricted-spell access as a reviewable attestation with author and time instead of leaving the current saved boolean invisible. Equipment exceptions use GM authority rather than attestation.
- Measure the current spell picker before setting equipment performance limits. Search must settle on the final query and avoid rebuilding the character plan, rereading an unchanged pack index, or rehydrating an unchanged preview.

Scope fence: no selling, merchant inventory, downtime shopping, rune transfer, automatic loadout optimization, ongoing economy, additive acquisition into existing inventory, or custom permanent-item schedules. Automatic Bonus Progression changes eligibility and guidance through PF2E's actual mode; Wayfinder does not invent a replacement wealth table.

### 0.8.1 — Equipment beta stabilization

Respond to real-player findings after both official funding recipes ship: unusual physical-item types, third-party price/stacking shapes, translated compendium behavior, granted-equipment conflicts, GM policy wording, and evidence-based suggestion refinements. Consider a separately designed custom permanent-item schedule, additive existing-inventory flow, or conditional batch reversal only when their safety contracts are explicit; none is implied by 0.8.0.

Shipped as a narrow live-finding patch: shared partials preload before cold-client rendering, GMs can decline and durably close an exact request without preventing a fresh re-request, and repeated purchases of the same stackable item converge into one repriced cart line.

### 0.8.2 — Catalogue and workflow polish

Starting Equipment exposes the full matching catalogue through an adaptive stable virtual list rather than a fixed first page. Search, ranking, policy availability, level, type, rarity, source, trait, and Titan Mauler facets operate over the complete lightweight shelf; only mounted or focused rows are projected into the DOM. Item details include enriched rules text, Bulk, and hands, and cart quantities accept direct numeric entry.

The wizard rail now collapses completed levels while reopening invalidated work, scroll positions survive relevant renders, changing picker counts have accessible announcements, and reduced-motion preferences are honored. Catalogue performance has explicit stage timing, visible-gap, stable-host, document-read, recovery, long-task, and adaptive-height gates. Fresh PF2E hydration and authority remain mandatory for preview recovery and Apply.

### 0.9.0 — Identity Epilogue and completion

Add an optional final chapter for name, pronouns, age, appearance, backstory, edicts and anathema, deity notes, portrait, and prototype token. Write to PF2E and Foundry fields the sheet already owns. File selection is in scope; image editing is not.

Replace the current anticlimactic empty state with a reviewable completion summary: key choices, equipment and remaining currency, honest handoffs, and a character-specific closing message.

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
- [Development plans](development/) sequence accepted but unreleased work and define its verification gates.
- [The 2026-07-26 issue backlog](issue-backlog-2026-07-26.md) is a historical triage snapshot; live issue state is on GitHub.
