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

### 2. The shared grant-choice foundation is now partially in place

The highest-value special cases already identified:

- `Ancient Elf`
- `Versatile Human`
- `General Training`
- `Natural Ambition`
- `Nascent`

These all rely on the same broad capability:

- non-class sources that grant a filtered item-backed feat choice and then `GrantItem` the result

That capability now exists for the first proving case. Ancient Elf can guide the dedication choice, carry the selected dedication into follow-up decisions, and preseed the apply-side PF2E grant dialog.

The next risk is not "can this architecture exist?" It is whether nearby compendium shapes fit the same workflow without narrow one-off fixes.

Free Archetype is not identical, but it still benefits from the same general confidence area:

- stronger feat-slot planning
- better feat-path ownership
- safer handling of archetype-only feat selection

Conclusion: the new default-rules seam should be re-audited and hardened before Free Archetype, not replaced or bypassed.

### 3. Other PF2E-native variants exist, but they are lower-value for Wayfinder creation flow

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

### Priority 1: Smoke-test non-class grant-choice special cases

This is the direct follow-on from the merged Ancient Elf grant-choice work and the focused PF2E v14 source re-audit.

The static audit now shows the target cases use the same supported filtered `ChoiceSet` plus `GrantItem` shape:

- `Versatile Human`
- `General Training`
- `Natural Ambition`
- `Nascent`

The remaining validation should happen in Foundry:

- each path renders at the right time
- class- and ancestry-dependent predicates filter correctly
- apply-side preseeding suppresses duplicate PF2E-native grant prompts

Ancient Elf should remain the regression path, not the only supported path.

### Priority 2: Live-smoke the default-rule hardening paths

The grant-choice, singleton-predicate, and fixed-skill fallback guardrails now have unit coverage. They still need live Foundry smoke coverage.

Expected shape:

- verify grant-choice rendering and apply preseeding for the nearby default-rule targets
- verify `Magical Experiment` renders only the selected follow-up branch
- verify `Wisp Fetchling` grants Acrobatics without adding an unconditional free skill choice

### Priority 3: Broaden singleton predicate vocabulary only when content proves it is needed

Basic singleton roll-option chains are now supported, including a `Magical Experiment`-style path.

Do not widen the predicate engine speculatively. The next useful work here is auditing real AP and side-book backgrounds after fallback training lands.

Expected shape:

- identify predicates that depend on non-singleton actor roll options
- add only the predicate vocabulary needed by real creation-time blockers
- keep invalidation scoped to hidden follow-up choices

### Priority 4: Free Archetype support

Once the default-rule special cases are hardened, Free Archetype becomes a more contained follow-up.

Expected shape:

- read PF2E’s Free Archetype world setting
- add archetype-only feat slots at the correct levels
- keep class-feat and archetype-feat filtering coherent
- avoid reopening the planner architecture broadly

This should be framed as:

- “Wayfinder respects PF2E’s Free Archetype variant”

not:

- “Wayfinder invents its own archetype variant model”

## Suggested Implementation Shape

### Slice A: Grant-choice smoke validation and hardening

Goal:

- prove the merged grant-choice platform in the live Foundry workflow against nearby level-1 special cases

Likely seams:

- live smoke paths for `Versatile Human`, `General Training`, `Natural Ambition`, and `Nascent`
- apply-side regression coverage for selected grant choices
- targeted patches only if live behavior diverges from the static audit

Done when:

- Ancient Elf remains green
- each target has a known smoke result
- any small generic fixes discovered during smoke testing are implemented

### Slice B: Live smoke validation

Goal:

- prove the newly hardened default-rule paths in the live Foundry workflow

Likely seams:

- smoke paths for the grant-choice targets
- smoke path for `Magical Experiment`
- smoke path for `Wisp Fetchling`
- targeted fixes only where live behavior diverges from unit-covered expectations

Done when:

- each path has a known smoke result
- any defects discovered during smoke testing are patched or explicitly recorded

### Slice C: Free Archetype variant

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

- Do not regress `Ancient Elf` into a one-off bespoke pane now that the shared grant-choice seam exists.
- Do not fork Wayfinder’s own variant model away from PF2E’s native Free Archetype setting if the system already exposes it cleanly.
- Do not reopen `app-shell.ts` for these behaviors unless a seam truly cannot be placed elsewhere.

## Readiness Verdict

The next move is not another broad cleanup pass.

The right order is:

1. smoke-test and harden the merged non-class grant-choice workflow
2. smoke-test singleton predicate and fixed-skill fallback behavior
3. broaden singleton predicate vocabulary only if the AP/background re-audit proves it is needed
4. extend the planner to respect PF2E’s Free Archetype setting

That order closes real player-facing gaps first, stays aligned with PF2E’s native variant support where it exists, and avoids dragging Wayfinder into a much larger custom character-build model too early.
