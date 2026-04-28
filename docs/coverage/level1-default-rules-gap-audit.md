# Level 1 Default-Rules Gap Audit

This audit maps Wayfinder's current level-1 support against the actual default PF2E content surface in the local Foundry instance.

It is intentionally narrower than a full future roadmap:

- in scope: default level-1 rules and the PF2E compendium content currently installed in the local Foundry instance
- out of scope: optional campaign rules such as Free Archetype

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

Wayfinder now covers most level-1 decisions through five distinct seams:

1. Base progression and pick-item steps
2. Class-driven steps
3. Singleton-source `ChoiceSet` steps
4. Skill-training and lore discovery
5. Non-class grant-choice steps for filtered feat grants

That architecture is good enough for further level-1 expansion, but the remaining gaps are concentrated in a few specific PF2E rule shapes.

## Coverage By Rule Shape

| Rule shape | Current status | Notes | Concrete examples |
| --- | --- | --- | --- |
| Background or heritage skill choices expressed as direct `ChoiceSet` arrays or `config: "skills"` | `Covered` | These flow into the skill-training step rather than a separate singleton pane. | `Teacher`, `Chosen One`, `Skilled Human` |
| Fixed skills or fixed lore expressed in `trainedSkills`, `ActiveEffectLike`, or simple `Additional Lore` grants | `Covered` | This is the strongest part of the non-class level-1 path today. | `Teacher`, `Elven Lore`, `Scribing Lore`, `Astronomy Lore` |
| Context-shaped lore or “custom lore” text inferred from descriptions | `Partial but working` | This works today, but it depends on text heuristics instead of robust structured rule discovery. | `Inlander`, `Working Student`, `Born of Item`, `Banished Celestial` |
| Generic singleton choices from ancestry, heritage, background, class, or deity with direct choice arrays | `Covered` | Good for flat static choices. | `Mottle-Coat Centaur`, `Magical Experiment` first-choice layer |
| Class-owned branches, deity grants, class choices, and spell choices | `Covered when PF2E uses supported class shapes` | This is already materially deeper than the rest of the app. | wizard, cleric, rogue, champion-like paths |
| Non-class `ChoiceSet` rules backed by item filters and `GrantItem` | `Covered when PF2E rule data is structured` | The grant-choice workflow supports filtered feat grants, dependency-aware timing, and apply-side preseeding. The focused PF2E v14 source re-audit found the nearby default-rule targets still use this supported shape. | `Ancient Elf`, `Versatile Human`, `Nascent`, `General Training`, `Natural Ambition` |
| Feat-owned singleton follow-up choices from selected grant-choice feats | `Covered when PF2E rule data is structured; needs breadth validation` | Non-skill, non-lore singleton choices on selected grant-choice feats can now surface as follow-up decisions. Skill and lore effects still flow into skill training. | Fighter Dedication class DC ability choice |
| Predicate-gated follow-on singleton choices driven by earlier singleton choices | `Covered for supported singleton roll-option chains` | Singleton steps now evaluate rule predicates against drafted or actor-existing singleton selections and clear stale hidden follow-up choices when the upstream choice changes. | `Magical Experiment` |
| Conditional fallback training text such as “if you would already be trained, choose another skill” | `Partial but hardened` | Common multiclass fallback shapes are modeled, and fixed-skill fallback wording no longer becomes an unconditional free choice. Rich duplicate-triggered fallback for fixed non-feat grants is still a future refinement. | `Fighter Dedication`, `Ranger Dedication`, `Wisp Fetchling` |

## Confirmed Gaps

### 1. The grant-choice workflow has landed, and the first focused re-audit is clean

Wayfinder now has a dedicated non-class grant-choice workflow for the important filtered feat-grant shape:

- filtered item-backed `ChoiceSet` rules
- matching `GrantItem` follow-through
- ancestry, heritage, background, and selected ancestry-feat sources
- apply-side preseeding so PF2E-native dialogs do not re-ask for the same grant choice

The Ancient Elf path has been verified as the first proving case, including its selected dedication and dedication-owned skill choice.

The first focused re-audit checked PF2E v14 source data for these nearby cases and found they all still fit the same supported filtered `ChoiceSet` plus `GrantItem` shape:

- `Versatile Human`: choose a 1st-level general feat
- `Nascent`: choose a 1st-level ancestry feat
- `General Training`: choose a 1st-level general feat
- `Natural Ambition`: choose a 1st-level class feat

This reduces the grant-choice risk from platform work to ordinary regression coverage and smoke testing.

### 2. Feat-granted level-1 follow-up choices now have a generic first layer, but need breadth validation

The skill-training plan already merges selected ancestry-feat documents for skill and lore discovery, which is why `Elven Lore` now shows up correctly.

The grant-choice work also added a generic path for feat-owned singleton follow-up choices that are not skill or lore choices. That covers cases like a selected dedication asking for a class DC ability.

The remaining risk is content breadth:

- selected feat sources may expose nested rules with predicates Wayfinder does not yet evaluate
- some selected feats may grant additional item choices instead of simple singleton choices
- skill and lore effects still need to remain centralized in skill training instead of becoming duplicate panes

### 3. Predicate-gated singleton chains are now modeled for supported singleton roll-option chains

The singleton workflow now evaluates top-level singleton rule predicates when those predicates are driven by earlier singleton `ChoiceSet` selections on the same source.

That matters for backgrounds like `Magical Experiment`, where one initial choice is meant to unlock a second dependent choice:

- choose the experiment result
- only then choose the matching sense or resistance details

The supported path now handles both drafted and actor-existing upstream selections, and changing the upstream singleton choice clears stale hidden follow-up choices from the draft.

The remaining caveat is broader predicate vocabulary. Predicates that depend on non-singleton actor roll options may still need dedicated support when real content exposes them as guided creation blockers.

### 4. Description-driven fallback training is safer, but not fully expressive

Wayfinder’s text inference for non-class training is materially better than before, but it is still inference.

The confirmed `Wisp Fetchling` issue has been hardened:

- PF2E text: gain Acrobatics; only if that training would duplicate another source, choose a different skill instead
- current parser behavior: Acrobatics remains a fixed grant, and the fallback sentence no longer resolves into an unconditional “choose a skill” rule

That means the current heuristics are safer, but still not fully expressive. Rich fallback that appears only when the fixed grant duplicates another source remains a useful future refinement.

### 5. Some AP-style backgrounds will remain only partly trusted until broader predicate vocabulary is audited

The installed PF2E packs include many AP and side-book backgrounds whose choices use:

- predicates on options
- multiple connected `ChoiceSet` rules
- downstream granted feats with preselected choices

Examples include:

- `Stargazer`
- `Magical Experiment`
- several `Strength of Thousands`, `Season of Ghosts`, and other AP backgrounds

These are not the first targets to implement, but they are good canaries for whether the generic singleton engine needs more predicate vocabulary beyond singleton-selection roll options.

## What Looks Solid Now

The audit is not all bad news. Several areas are already in a good place:

- Background and heritage free-skill flows with clean skill `ChoiceSet` rules are in the right workflow now.
- Fixed and chosen lore is no longer spread across ad hoc panes.
- Post-boost class skill training and bonus languages are aligned with actual PF2E level-1 timing.
- Class-owned branches and class-linked spell choices are no longer the main risk area for level-1 coverage.

The repo is now missing narrower rule-shape support, not broad architecture.

## Priority Order For Default-Rules Follow-Up

### Priority 1: Smoke-test the non-class grant-choice targets in Foundry

The static re-audit and unit coverage now say these paths should flow through the generic grant-choice workflow:

- `Versatile Human`
- `General Training`
- `Natural Ambition`
- `Nascent`

The next useful validation is in-app smoke testing that confirms:

- each path renders at the right time
- option filtering matches the selected ancestry or class context
- apply-side preseeding prevents duplicate PF2E-native grant dialogs

### Priority 2: Live-smoke grant-choice, singleton predicate, and fallback-training paths

The highest-value remaining validation is in Foundry, not another broad parser expansion.

Smoke paths should include:

- `Versatile Human`
- `General Training`
- `Natural Ambition`
- `Nascent`
- `Magical Experiment`
- `Wisp Fetchling`

### Priority 3: Re-audit AP and side-book backgrounds after smoke validation

Once the grant-choice, singleton predicate, and fallback-training work is in place, re-check the more exotic backgrounds and heritages.

That second pass should decide whether the remaining misses deserve:

- more generic support
- or narrow content-specific hardening

## Not The Next Slice

These are real future areas, but they should come after the default-rules gaps above:

- Free Archetype
- other optional campaign rules
- broader post-level-1 archetype and feat recursion

Those options will be much easier to reason about once the core default-rule grant-choice, singleton-predicate, and fallback-training seams are solid.

## Readiness Verdict

Wayfinder is now in a stronger and more credible state for level-1 default rules, but it is not yet complete.

The highest-value remaining work is no longer building the first non-class filtered feat-grant platform, basic predicate-aware singleton chains, or the first fixed-skill fallback guard. Those foundations exist. The next work is live smoke testing, followed by a broader AP and side-book re-audit.

If those slices land cleanly, the next pass on optional rules such as Free Archetype will happen on a much stronger foundation.
