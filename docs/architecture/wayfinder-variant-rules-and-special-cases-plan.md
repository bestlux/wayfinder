# Wayfinder Variant Rules And Special-Cases Plan

This document ranks the next likely expansion areas after the level-1 default-rules audit.

It combines:

- what PF2E `8.0.3` exposes natively in the local Foundry install
- what Wayfinder already models internally
- which requested gaps are best solved by the same new seam

## Scope

- in scope:
  - variant-rule options that are plausible next consumers of Wayfinder’s current architecture
  - special level-1 ancestry, heritage, background, and feat exceptions the current default-rules audit already surfaced
- out of scope:
  - implementing any of these rules in this document
  - deep post-level-1 archetype recursion
  - campaign-only variants that do not materially affect character creation flow

## Key Findings

### 1. Free Archetype is a real PF2E-native variant and the easiest serious option to support next

In PF2E `8.0.3`, Free Archetype already exists as a first-class world setting:

- PF2E variant setting: `freeArchetypeVariant`
- PF2E cached runtime state: `game.pf2e.settings.variants.fa`
- PF2E character feat handling already creates a dedicated archetype feat group when that variant is enabled

Wayfinder already has part of the supporting surface:

- actor inspection tracks `featCounts.archetype`
- class-feat picking already understands class versus archetype filtering
- option filtering already distinguishes dedication entry feats from later archetype follow-up feats

What Wayfinder is still missing is the planner-side variant hook:

- no current read of the PF2E Free Archetype setting
- no explicit archetype slot creation in progression or app plan building
- no special UI framing for “extra archetype-only feat slots”

Conclusion: Free Archetype is not trivial, but it is the next variant rule with the best implementation leverage.

### 2. Dual-Class does not appear to have comparable first-class PF2E system support

In the current PF2E `8.0.3` repo scan:

- Free Archetype is explicit in settings and feat grouping
- Dual-Class does not appear as a comparable system setting or character-feat scaffold

That matters because Dual-Class is not just “more feat slots.”

It would likely require custom Wayfinder support for:

- two class anchors instead of one
- combined key-ability and proficiency rules
- overlapping class-feature and class-feat tracks
- two spellcasting or class-feature ecosystems where applicable
- substantial apply-side and derived-state complexity

Conclusion: Dual-Class should be treated as a separate design project, not the next incremental variant-rule slice.

### 3. The default-rules special cases and Free Archetype want the same foundation in different degrees

The highest-value special cases already identified:

- `Ancient Elf`
- `Versatile Human`
- `General Training`
- `Natural Ambition`
- `Nascent`

All of these rely on a missing capability:

- non-class sources that grant a filtered item-backed feat choice and then `GrantItem` the result

Free Archetype is not identical, but it benefits from the same general confidence area:

- stronger feat-slot planning
- better feat-path ownership
- safer handling of archetype-only feat selection

Conclusion: the next default-rules seam should land before Free Archetype, not after it.

### 4. Other PF2E-native variants exist, but they are lower-value for Wayfinder creation flow

PF2E `8.0.3` exposes other variant settings such as:

- Gradual Ability Boosts
- Stamina
- Automatic Bonus Progression
- Proficiency Without Level
- Mythic

These are real system features, but they are not the best next Wayfinder slice:

- some are not level-1 creation decisions
- some mostly affect derived stats or later progression
- some would widen scope without closing a current player-facing gap

Conclusion: they are worth keeping in mind, but they should not displace the special-case level-1 feat-grant work or Free Archetype.

## Recommended Order

### Priority 1: Non-class feat-grant choice workflow

This is the direct follow-on from the default-rules audit.

It should cover:

- `ChoiceSet` rules with filtered item-backed feat selection
- `GrantItem` follow-through from ancestry, heritage, or ancestry-feat sources
- prerequisite-aware timing when the granted feat can legally be chosen later in creation

This is the seam needed for:

- `Ancient Elf`
- `Versatile Human`
- `General Training`
- `Natural Ambition`
- `Nascent`

Recommended first consumer: `Ancient Elf`

Why first:

- it is a user-visible gap already called out explicitly
- it is mechanically rich enough to prove the seam
- it exercises class-aware prerequisite timing, which is the hardest part

### Priority 2: Free Archetype support

Once the special-case feat-grant seam is in place, Free Archetype becomes a much more contained follow-up.

Expected shape:

- read PF2E’s Free Archetype world setting
- add archetype-only feat slots at the correct levels
- keep class-feat and archetype-feat filtering coherent
- avoid reopening the planner architecture broadly

This should be framed as:

- “Wayfinder respects PF2E’s Free Archetype variant”

not:

- “Wayfinder invents its own archetype variant model”

### Priority 3: Re-check special-case ancestry and heritage exceptions after Priority 1

Once `Ancient Elf` and the feat-grant seam are in place, re-check nearby level-1 exceptions such as:

- `Versatile Human`
- `General Training`
- `Natural Ambition`
- `Nascent`

At that point the likely question will no longer be “can we support these?”

It will be:

- which of these fall out of the same generic feat-grant workflow cleanly
- and which still need narrow hardening

### Priority 4: Dual-Class only as a deliberate separate design project

Dual-Class should not be the next “just another option.”

It should only move forward if we explicitly want to absorb:

- a second class anchor in plan building
- much broader build-state changes
- larger apply-side and UI consequences

If pursued, it deserves its own design document and probably its own checkpoint branch series.

## Suggested Implementation Shape

### Slice A: Special-case feat-grant platform

Goal:

- support level-1 non-class feat grants without pretending they are generic singleton text choices

Likely seams:

- extend the singleton or adjacent non-class choice workflow to support filtered item-backed feat selection
- add prerequisite-aware scheduling or deferred eligibility handling
- add apply-side support for the granted feat path

Done when:

- `Ancient Elf` works
- at least one human heritage or ancestry-feat grant works

### Slice B: Free Archetype variant

Goal:

- make Wayfinder honor PF2E’s `freeArchetypeVariant` setting

Likely seams:

- actor snapshot or plan context gains variant-rule awareness
- progression or app-plan layer adds archetype-only feat slots at the correct levels
- class-feat UI wording reflects the variant clearly

Done when:

- a PF2E world with Free Archetype enabled shows the extra slots in Wayfinder
- archetype feat picking remains filtered and coherent

## What Not To Do

- Do not start with Dual-Class.
- Do not solve `Ancient Elf` with a one-off bespoke pane if the same seam should power `Natural Ambition` and `General Training`.
- Do not fork Wayfinder’s own variant model away from PF2E’s native Free Archetype setting if the system already exposes it cleanly.
- Do not reopen `app-shell.ts` for these behaviors unless a seam truly cannot be placed elsewhere.

## Readiness Verdict

The next move is not another broad cleanup pass.

The right order is:

1. build the non-class feat-grant workflow and use `Ancient Elf` as the first proving case
2. extend the planner to respect PF2E’s Free Archetype setting
3. only then decide whether a larger project like Dual-Class is worth the cost

That order closes real player-facing gaps first, stays aligned with PF2E’s native variant support where it exists, and avoids dragging Wayfinder into a much larger custom character-build model too early.
