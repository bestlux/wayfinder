# Level 1 Default-Rules Gap Audit

This audit maps Wayfinder's current level-1 support against the actual default PF2E content surface in the local Foundry instance.

It is intentionally narrower than a full future roadmap:

- in scope: default level-1 rules and the PF2E compendium content currently installed in the local Foundry instance
- out of scope: optional campaign rules such as Free Archetype or Dual-Class

## Environment Audited

- Foundry world: `testing-world`
- Foundry version: `14.360`
- PF2E system version: `8.0.3`
- PF2E system packs installed: `94`
- Extra installed modules:
  - `pf2e-wayfinder` with `0` packs
  - `ember` with `5` packs, but not PF2E player-content packs

Practical conclusion: the live audit surface is PF2E core system data plus Wayfinder itself. There is not an extra PF2E content module in this instance that materially changes the level-1 audit.

## Current Support Boundaries

Wayfinder now covers most level-1 decisions through four distinct seams:

1. Base progression and pick-item steps
2. Class-driven steps
3. Singleton-source `ChoiceSet` steps
4. Skill-training and lore discovery

That architecture is good enough for further level-1 expansion, but the remaining gaps are concentrated in a few specific PF2E rule shapes.

## Coverage By Rule Shape

| Rule shape | Current status | Notes | Concrete examples |
| --- | --- | --- | --- |
| Background or heritage skill choices expressed as direct `ChoiceSet` arrays or `config: "skills"` | `Covered` | These flow into the skill-training step rather than a separate singleton pane. | `Teacher`, `Chosen One`, `Skilled Human` |
| Fixed skills or fixed lore expressed in `trainedSkills`, `ActiveEffectLike`, or simple `Additional Lore` grants | `Covered` | This is the strongest part of the non-class level-1 path today. | `Teacher`, `Elven Lore`, `Scribing Lore`, `Astronomy Lore` |
| Context-shaped lore or “custom lore” text inferred from descriptions | `Partial but working` | This works today, but it depends on text heuristics instead of robust structured rule discovery. | `Inlander`, `Working Student`, `Born of Item`, `Banished Celestial` |
| Generic singleton choices from ancestry, heritage, background, class, or deity with direct choice arrays | `Covered` | Good for flat static choices. | `Mottle-Coat Centaur`, `Magical Experiment` first-choice layer |
| Class-owned branches, deity grants, class choices, and spell choices | `Covered when PF2E uses supported class shapes` | This is already materially deeper than the rest of the app. | wizard, cleric, rogue, champion-like paths |
| Non-class `ChoiceSet` rules backed by item filters and `GrantItem` | `Missing` | This is the biggest default-rules hole now. | `Ancient Elf`, `Versatile Human`, `Nascent`, `General Training`, `Natural Ambition` |
| Predicate-gated follow-on singleton choices on non-class sources | `Partial / fragile` | The current singleton path does not evaluate top-level singleton rule predicates, so chained follow-up choices can over-render. | `Magical Experiment` |
| Conditional fallback training text such as “if you would already be trained, choose another skill” | `Fragile` | Some phrasings are handled; others can still become unconditional free choices. | `Wisp Fetchling` |

## Confirmed Gaps

### 1. Heritage or ancestry choices that grant another feat are still outside the supported flow

The current singleton workflow only supports:

- direct array choices
- `config: "skills"`

It does not currently discover non-class `ChoiceSet` rules shaped as filtered item selections with `GrantItem`.

That leaves several real level-1 PF2E cases outside the guided flow:

- `Ancient Elf`: choose another class and gain its multiclass dedication feat
- `Versatile Human`: choose a 1st-level general feat
- `Nascent`: choose a 1st-level ancestry feat
- `General Training`: choose a 1st-level general feat
- `Natural Ambition`: choose a 1st-level class feat

This is the single highest-value default-rules gap because these are core player-facing options, not fringe content.

### 2. Feat-granted level-1 follow-up choices are still narrowly wired

The skill-training plan already merges selected ancestry-feat documents for skill and lore discovery, which is why `Elven Lore` now shows up correctly.

But that support is narrow:

- it is focused on skill and lore effects
- it does not provide a generic follow-up choice platform for ancestry feats that grant other feats or item selections

That is why `Elven Lore` works while `General Training` and `Natural Ambition` do not.

### 3. Predicate-gated singleton chains on non-class sources are not modeled strongly enough

The current singleton rule discovery does not evaluate top-level singleton predicates for ancestry, heritage, background, or deity sources.

That matters for backgrounds like `Magical Experiment`, where one initial choice is meant to unlock a second dependent choice:

- choose the experiment result
- only then choose the matching sense or resistance details

Today the generic singleton path is structurally capable of rendering multiple steps, but it is not yet doing enough dependency evaluation to make those chains trustworthy.

### 4. Description-driven fallback training is still brittle

Wayfinder’s text inference for non-class training is materially better than before, but it is still inference.

A confirmed example is `Wisp Fetchling`:

- PF2E text: gain Acrobatics; only if that training would duplicate another source, choose a different skill instead
- current parser behavior: this still resolves into an unconditional “choose a skill” rule

That means the current heuristics are good enough to cover many backgrounds and feats, but not yet safe enough to treat all conditional fallback wording as solved.

### 5. Some AP-style backgrounds will remain only partly trusted until predicate-aware singleton evaluation improves

The installed PF2E packs include many AP and side-book backgrounds whose choices use:

- predicates on options
- multiple connected `ChoiceSet` rules
- downstream granted feats with preselected choices

Examples include:

- `Stargazer`
- `Magical Experiment`
- several `Strength of Thousands`, `Season of Ghosts`, and other AP backgrounds

These are not the first targets to implement, but they are good canaries for whether the generic singleton engine is truly robust.

## What Looks Solid Now

The audit is not all bad news. Several areas are already in a good place:

- Background and heritage free-skill flows with clean skill `ChoiceSet` rules are in the right workflow now.
- Fixed and chosen lore is no longer spread across ad hoc panes.
- Post-boost class skill training and bonus languages are aligned with actual PF2E level-1 timing.
- Class-owned branches and class-linked spell choices are no longer the main risk area for level-1 coverage.

The repo is now missing narrower rule-shape support, not broad architecture.

## Priority Order For Default-Rules Follow-Up

### Priority 1: Add a generic feat-grant choice workflow for non-class sources

This should cover:

- filtered item-backed `ChoiceSet` rules
- `GrantItem` follow-through
- prerequisite-aware timing when the granted choice can legally be selected later in character creation

This is the right seam for:

- `Ancient Elf`
- `Versatile Human`
- `General Training`
- `Natural Ambition`
- `Nascent`

### Priority 2: Make singleton discovery predicate-aware for non-class follow-up chains

This should include:

- top-level predicate evaluation for singleton rules
- dependency-aware invalidation between singleton choices from the same source
- protection against rendering downstream choices before upstream selections exist

This is the main hardening needed for backgrounds like `Magical Experiment`.

### Priority 3: Harden conditional fallback training parsing

This should focus on:

- “if you would already be trained…” wording
- “if you are already trained…” wording
- “for each skill already trained, choose another…” wording

The goal is not to parse every sentence ever written in PF2E. The goal is to stop turning conditional fallback text into unconditional free choices.

### Priority 4: Re-audit AP and side-book backgrounds after the first three slices land

Once the feat-grant and predicate-aware singleton work is in place, re-check the more exotic backgrounds and heritages.

That second pass should decide whether the remaining misses deserve:

- more generic support
- or narrow content-specific hardening

## Not The Next Slice

These are real future areas, but they should come after the default-rules gaps above:

- Free Archetype
- Dual-Class
- other optional campaign rules
- broader post-level-1 archetype and feat recursion

Those options will be much easier to reason about once the core default-rule feat-grant and predicate-chain seams are solid.

## Readiness Verdict

Wayfinder is now in a credible state for level-1 default rules, but it is not yet complete.

The highest-value remaining work is no longer more lore or free-skill plumbing. It is the missing platform for non-class filtered feat grants plus stronger predicate-aware singleton evaluation.

If those two slices land cleanly, the next pass on optional rules and special cases like `Ancient Elf` will happen on a much stronger foundation.
