# Wayfinder Roadmap

Written 2026-07-26, after the 0.6.0 release. This supersedes `agents/v1-backlog.md` (complete) as the forward-looking plan. The product brief and design vision in `agents/` remain the standing contract for scope philosophy and feel; this document says what to build next and — just as deliberately — what not to build.

## Where Wayfinder stands

The v1 backlog is finished. All 27 classes have a verified guided path from blank level 1 through level 5, spell choices land in prepared, spontaneous, spellbook, bounded, and innate destinations, three class archetypes are guided end-to-end, and Free Archetype has its own lane. The live smoke harness — 46 apply-and-rerun cases inside a real Foundry world — is a rigor bar almost no Foundry module clears. The UI honors the design vision: the rail, the dossier line, the preview pane, and the trait pills read as PF2E-native, and the honesty posture (GM-approval boundaries, graceful handoffs, public coverage matrices) is a real brand, not a disclaimer.

Twelve of fourteen GitHub issues are closed, most within days. The two open ones are the map to what's next:

- **#16** (same-level skill increase doesn't refresh feat eligibility) is the third bug in the same family as #15 — each pane re-derives "what does the draft imply so far" on its own, and the derivations drift.
- **#7** (class archetypes) already has a ranked, phased plan in `docs/issue-backlog-2026-07-26.md`.

The honest gaps in the core promise, before any new feature:

1. **Projection drift.** There is no single "projected character state at step N" that every eligibility check reads. Skills→increases (#15) and skills→feats (#16) both broke on this seam; boosts→feat prerequisites and spell-rank gating sit on the same fault line.
2. **Verified depth stops at level 5.** The machinery schedules boosts at 10/15/20 and skill increases through 19, but the promise — and the evidence — end at 5. Mid-campaign tables are running unverified paths.
3. **Archetype legality is a shrug.** Dedications appear in feat pools, but prerequisites, the two-feats-before-a-new-dedication rule, and family membership are all "confirm with your GM" boundaries. That's honest, but it's the biggest remaining source of *avoidable* GM confirmation.
4. **Variant coverage is incomplete.** Free Archetype shipped; Gradual Ability Boosts (a product-brief "Native" commitment) does not exist; ABP/Stamina/PWoL awareness labels don't either.
5. **The ending is an anticlimax.** Creation ends with "No Wayfinder-guided steps are pending." The design vision promised "Valeria is ready for her first adventure." There is no completion moment, no summary, and no explicit equipment handoff.
6. **The GM surface is one text field.** A comma-separated allowlist is the entire GM experience of a module whose differentiator is "it knows your table."

## The thesis, sharpened

Wayfinder owns the journey from **blank actor to table-ready character**, inside the world where that character will play. Three tests for any proposed feature:

1. **Is it part of becoming table-ready?** Creation and progression, yes. Ongoing play (daily preps, downtime economy, retraining) — no.
2. **Does living inside Foundry make Wayfinder better at it than Pathbuilder?** World context, direct actor writes, GM settings.
3. **Can Wayfinder own it confidently, or does it become a second product?** One guided flow, one quality bar. Anything that needs its own UI paradigm is a sibling module, not a feature.

## Feature verdicts

Candidate ideas, judged against the thesis:

| Candidate | Verdict | Why |
| --- | --- | --- |
| Starting wealth & shopping | **Yes — flagship** | Buying starting gear *is* a creation step in the CRB. It is the last forced trip to the native sheet on the common path. |
| Backstory, appearance, character details | **Yes — as the Identity Epilogue** | PF2E's biography fields are the natural destination; "a place where players discover who their character is" is the stated vision. Cheap, deeply on-brand. |
| Portrait & token image | **Thin version only** | Setting a portrait and prototype token belongs to creation and is something Pathbuilder *cannot* do. Building an image editor does not — Tokenizer already owns that. Pick, apply, done; offer Tokenizer if installed. |
| Archetype legality (incl. Free Archetype) | **Yes — core correctness work** | Turns the largest "confirm with your GM" surface into verified filtering. Shared engine serves the class-feat lane and the FA lane. |
| Class archetypes (#7) | **Yes — keep the ranked plan** | Substrate first, then Bloodrager and Vindicator, per `docs/issue-backlog-2026-07-26.md`. |
| NPC builder for GMs | **No — cut** | PF2E NPCs are stat-block creatures built from GM Core creature tables, not PC rules. Different data model, different user, different UI — a second product wearing Wayfinder's name. If demand persists, it's a sibling module. |
| Token-maker editing (frames, layers, crops) | **No — cut** | Owning image manipulation fails test 3. Integrate, don't rebuild. |
| Pathbuilder import/export | **No — unchanged** | The product promise is that you never needed the export. |
| Daily preparations, downtime shopping, retraining | **No / defer** | Ongoing-play surfaces fail test 1. Retraining is the only one that might return, post-1.0. |

The GM does get investment — not an NPC builder, but a real settings surface: starting-wealth policy, source allowlists with a picker instead of a text field, and visibility into the approval boundaries their players are hitting.

## The road to 1.0

Three arcs. Each is shippable in slices, keeps the smoke harness green, and ends with the module more trustworthy than it started.

### Arc 1 — Trust (0.7.x): make the math load-bearing

The correctness arc. No new surfaces; the existing ones stop having asterisks.

1. **One projection, many readers.** Fix #16 by consolidating, not patching: a single projected-state service (skills, boosts, feats, languages, known spells, dedications) computed per step position, consumed by every pane and eligibility filter. #15 and #16 become regression tests of the same seam.
2. **Archetype legality v1.** Prerequisite checking against projected state, the two-feats-before-a-new-dedication rule, duplicate-dedication lockouts, and family membership where PF2E data expresses it. Boundaries that survive stay explicitly labeled; the rest become real filters.
3. **Depth verification.** Extend the smoke matrix: a representative class set (one martial, one prepared, one spontaneous, one bounded, one skill-monkey) verified L1→10, and at least one class L1→20. Boosts at 10/15/20 and high-rank spell scheduling get evidence, and the README's promise moves past level 5.
4. **Gradual Ability Boosts.** The last unmet "Native" variant commitment from the product brief, plus awareness labels for ABP/Stamina/PWoL.

### Arc 2 — Finish the character (0.8–0.9): the table-ready arc

The feature arc. When it ends, the common official path never leaves Wayfinder.

**0.8 — Starting wealth & shop.**

- Level 1: class kits as one-click starting loadouts, plus a guided purchase step against starting currency.
- Above level 1: the GM Core character-wealth flow — the lump-sum-currency vs. permanent-items-plus-currency choice, with item-level caps from the official table.
- GM settings: wealth mode (official table / lump sum only / custom amounts), rarity ceiling, source filtering reusing the existing allowlist machinery.
- Scope fence: this is *creation-time acquisition only*. No ongoing shop, no rune transfer, no economy. The shop pane reuses the picker grammar (search, filters, preview) with a running budget in the rail.

**0.9 — Identity Epilogue & the completion moment.**

- A final narrative chapter after the mechanical steps: name, age, pronouns, physical description, backstory, edicts & anathema, deity details — written to the PF2E biography fields the sheet already renders. Prompts nudge, never require; second person, present tense.
- Portrait & token: Foundry FilePicker, apply to portrait and prototype token, dynamic token ring settings where Foundry supports them. If Tokenizer is installed, offer it for editing.
- The completion state the design vision promised: a summary of who this character became — dossier line grown into a full sentence, key choices recapped — and explicit handoffs for anything that remains. "Seren Auviel is ready for her first adventure."

### Arc 3 — Widen the gates (parallel / post-1.0)

Breadth work that never blocks the arcs above:

- Class archetypes per the ranked #7 plan: shared substrate (training replacement policy, selector-independent discovery, generalized grants), then Bloodrager and Vindicator, then the substrate proofs and complex rewrites.
- Deeper Free Archetype adjudication as the legality engine matures.
- Coverage-matrix upkeep as PF2E ships new content.

### What 1.0 means

Wayfinder 1.0 is declared when a player can take a blank actor to an equipped, portraited, backstoried, mechanically verified character — at level 1 or above — without a single required trip to the native sheet on the common official path; when verified depth reaches at least level 10; and when archetype legality is filtered, not disclaimed, for core cases. That is the release to showcase loudly: module listing refresh, real screenshots of the epilogue and shop, and a community post that leads with the honesty posture as the differentiator.

## Non-goals

Held deliberately, revisited only at 1.0: NPC/creature building, token image editing, Pathbuilder import/export, daily preparations, downtime economy and rune management, retraining, homebrew content *authoring* (allowlisted homebrew content remains supported), and non-PF2E systems.

## Docs housekeeping

- The v1 backlog, research digest, and implementation notes in `agents/` were removed on 2026-07-26 — the v1 plan shipped in full, and their capability snapshots no longer matched the code. This file is their successor.
- `agents/product-brief.md` and `agents/design-vision.md` remain canonical for scope philosophy and feel. The design vision needs no revision — Arc 2 exists to finish honoring it.
- `docs/issue-backlog-2026-07-26.md` remains the tactical plan for #7 and the template for future issue-triage snapshots.
- Coverage matrices in `docs/coverage/` stay evidence-first; Arc 1's depth work extends them past level 5.
