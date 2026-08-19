# Third-Party Compendium Compatibility

This document tracks Wayfinder's compatibility contract for PF2E Item compendia that are not part of the core `pf2e` package. The goal is not to special-case individual publishers. It is to make structured content predictable, surface ambiguous content honestly, and prevent incomplete metadata from silently producing invalid character choices.

## Live audit baseline

- Date: 2026-08-17
- Foundry: 14.366
- PF2E: 8.4.1
- Wayfinder: 0.7.3
- Active modules: 51
- Optional Item compendia discovered: 47
- Enabled Wayfinder source patterns:
  - `battlezoo-ancestries-dungeons-pf2e.*`
  - `battlezoo-ancestries-living-legends-pf2e.*`
  - `battlezoo-ancestries-year-of-monsters-pf2e.*`

The audit uses disposable actors owned by the Codex GM account. Do not reuse campaign actors for destructive or Apply-time probes.

### Exact-current player-root probe

On 2026-08-19, a disposable world Item compendium was exercised against the generated candidate in `testing-world` on Foundry 14.366, PF2E 8.4.0, and Wayfinder 0.7.5. It contained a cloned valid PC ancestry (`Audit Evil Eye`), a companion-shaped ancestry (`Audit Ape`) with companion markers and direct ability writes, and an eidolon-shaped ancestry (`Audit Aberrant Eidolon`). Only `Audit Evil Eye` appeared in ancestry options; direct selection resolution also rejected both invalid roots. The original source setting was restored and the temporary pack was deleted after the probe.

The same live corpus scan retained all 50 official PF2E ancestries and all 28 installed Battlezoo roots in the selected Dungeons, Fusions, Living Legends, and Classic Creatures ancestry packs. This is exact-runtime evidence for the player-root classifier, not a claim that prose-only follow-on automation is universally supported.

## Compatibility contract

Wayfinder should classify a candidate as one of four states:

- **Eligible**: the installed document contains enough structured PF2E data to prove it belongs in the current picker.
- **Incompatible**: structured data proves it belongs to another ancestry, class, rank, tradition, category, or prerequisite state.
- **Ambiguous**: required relationship data is missing or contradictory. Hide it from the ordinary player list and report the reason to the GM.
- **Unsupported**: the document is selectable or applicable in PF2E, but Wayfinder cannot safely guide all of its prose-only or custom-system decisions. Show a precise manual-support disclosure rather than claiming full support.

Discovery and settings should fail open enough to inventory every readable Item pack. Player eligibility and Apply-time validation should fail closed when required structured data is missing, malformed, or unsupported.

## Findings

| ID | Severity | Status | Surface | Finding | General resolution |
| --- | --- | --- | --- | --- | --- |
| WF-COMP-001 | P1 | Fixed | Source settings | A global `*` expands to every installed Item compendium. PF2E modules can legitimately store non-character ancestries/classes/feats in Item packs, so `Ape` and other animal-companion documents enter character pickers. | The source manager now replaces ordinary wildcard editing with exact pack selection, content counts, and an explicit inherited-wildcard warning. Saving persists canonical exact pack IDs, while per-document eligibility remains an independent boundary. |
| WF-COMP-002 | P1 | Fixed | Ancestry feats | Evil Eye showed 102 ancestry feats, including `Ageless` and `Angelic Weapon Familiarity` with the `angel` trait. The trait catalog stopped at `CONFIG.PF2E.ancestryTraits`, so enabled third-party ancestry identities were treated as generic descriptive traits. | Configured traits are now unioned with ancestry, heritage, and class identities discovered only from enabled root documents. Candidates carrying a discovered foreign identity are rejected. |
| WF-COMP-003 | P1 | Fixed | Heritages | Evil Eye showed Dungeon heritages including `Archipelago`, `Caverns`, `Labyrinth`, `Tower`, and `Tree`. Their installed documents declare `Ancestry: None (Versatile)` even though their prose and package topology make them Dungeon options. | Explicit links remain authoritative. Core PF2E null links remain trusted versatile heritages. A third-party null link is inferred only when the package exposes exactly one ancestry and it is the selected ancestry; ambiguous links are hidden. |
| WF-COMP-004 | P1 | Confirmed | Classes | `Intelligent Weapon (Alternate)` appeared for an Evil Eye character. The document says in prose that it is for the optional “Just a Weapon, Not an Ancestry” rules and that PF2E's boost manager is incompatible. | Evaluate structured class predicates when present. Classify prose-only eligibility or custom boost/resource systems as unsupported and disclose the manual path instead of presenting them as an ordinary fully supported class. |
| WF-COMP-005 | P2 | Fixed | Source labels | Third-party items with blank `system.publication.title` displayed as `Unknown Source`, even though pack and package labels were available. | Option labels now fall back from publication title to compendium title, pack title, and package title. |
| WF-COMP-006 | P1 | Fixed | Cache invalidation | Changing enabled source packs rerendered Wayfinder but did not clear cached pack indexes or trait catalogs. | Source-policy saves, direct setting mutations, and compendium Item mutations now clear source-derived indexes and taxonomy caches before rerendering. |
| WF-COMP-007 | P1 | Fixed | Bounded feats/spells | A missing or malformed level passed a `maxLevel` gate because only a parsed level above the ceiling was rejected. | Required bounded levels must now be finite, nonnegative integers within the bound. |
| WF-COMP-008 | P1 | Fixed | ChoiceSet predicates | Unsupported typed predicate objects fell through as `true` in the item predicate evaluator. | The typed PF2E predicate operators are evaluated with three-valued logic; unknown statements and operators fail closed, including under negation. |
| WF-COMP-009 | P2 | Source-confirmed | Archetype feats | Unresolved archetype family metadata admits follow-up feats broadly. Existing copy warns the GM, but the ordinary option list still implies eligibility. | Return diagnostics with the candidate and separate proven legal options from unresolved/manual-review options. |
| WF-COMP-010 | P2 | Source-confirmed | Custom casters | Generic class milestones can be read from structured class data, but spell progression remains contributor-based. A third-party caster can look supported while spell/resource mechanics are absent. | Expose a capability summary for every class. Structured unknown martial classes may use the generic path; unknown casters/resources require a partial-support disclosure and PF2E-sheet handoff. |
| WF-COMP-011 | P1 | Fixed | Level-up lifecycle | After a successful Apply, reopening an actor with no pending steps showed only “No Wayfinder-guided steps are pending.” The target-level controls were rendered only inside the pending-plan branch, so the normal next-level path disappeared. | The empty state now keeps current/target level controls visible and explicitly directs the user to raise the target level. |
| WF-COMP-013 | P2 | Fixed | Slug identity | A document without its own slug could inherit `system.ancestry.slug` as its identity, collapsing an un-slugged heritage into its parent ancestry. | Document identity now falls back from the document slug directly to its name; ancestry association remains separate relationship data. |

## Working lanes observed as sound

A complete disposable Evil Eye / Balloon Eye / Acolyte / Bard level-1 build successfully applied through Wayfinder. The audit verified:

- ancestry, heritage, background, and Bard class documents persisted;
- Evil Eye Lore and its granted lore materialized;
- Bard muse selection and granted composition content materialized;
- structured ancestry languages and Intelligence-based language choice projected correctly;
- automatic and selected skill training projected correctly;
- five occult cantrips and two rank-1 repertoire spells materialized in the native PF2E spellcasting entry;
- the resulting actor had the expected ancestry traits, languages, ability modifiers, skills, feats, and spell list.

This proves the core Apply pipeline can consume well-structured third-party ancestry content. It does not excuse false-positive picker eligibility.

## GM source-selection requirements

The source manager should:

- list only Item compendia as selectable sources;
- show exact pack ID, package title, compendium title, availability, and selection state;
- count ancestry, heritage, background, class, deity, feats by category, spells, class features, and other Items;
- search and filter by title, package, canonical ID, selected state, relevance, and content type;
- support Select Visible and Clear Visible, but no unqualified Select Everything action;
- expand legacy exact/prefix/global patterns without mutating the world merely by opening;
- save deterministic exact pack IDs and preserve temporarily unavailable saved IDs;
- show that source enablement makes documents discoverable but does not certify prose-only automation;
- report ambiguous/incompatible counts and examples as the compatibility classifier grows.

## Character-build audit matrix

| Lane | Structured checks | Required live scenarios |
| --- | --- | --- |
| Ancestry | item type, stable identity, duplicate source/name disclosure | official, well-formed third-party, animal-companion false ancestry, duplicate names |
| Heritage | explicit ancestry link, proven versatile state, package inference diagnostics | official versatile, explicit match/mismatch, null third-party link, single-ancestry package |
| Background | item type, boosts, skills, lore, grants | core, third-party structured, prose-only grant |
| Class | item type, milestones, key ability, training, class predicate/capability summary | core martial/caster, structured third-party martial, prose/custom caster, ancestry-restricted alternate |
| Feats | category, bounded level, discovered lineage/class traits, structured prerequisites, archetype family | ancestry, class, archetype, skill, general, campaign slots, malformed metadata |
| Grants and branches | UUID existence, supported predicate, deterministic ChoiceSet, unresolved disclosure | static grant, supported ChoiceSet, dynamic UUID, unsupported predicate, prose-only decision |
| Skills and languages | projected ranks, source conditions, duplicate/reserved choices, ancestry language access | fixed/fallback training, lore, bonus languages, restricted language handoff |
| Spells | type, rank, cantrip state, tradition, rarity/access, destination identity | core list, optional spell pack, malformed spell, prose-only access, unknown caster |
| Apply | source still installed/enabled, selection still eligible, draft recovery, exact actor convergence | successful third-party build, source removed before Apply, predicate drift, interrupted final write, retry |

## Exit criteria

- No known foreign ancestry or class identity appears in another lineage/class picker.
- Missing required levels and unsupported predicates cannot qualify.
- Null/unlinked third-party heritages are either defensibly scoped or visibly quarantined.
- GM source selection persists exact pack IDs and reports relevant counts.
- Existing drafts survive source-policy changes visibly and fail Apply without partial mutation when their sources are unavailable.
- Synthetic mixed-pack tests cover every lane above.
- At least one module-heavy live build and retry passes on the exact generated candidate.
