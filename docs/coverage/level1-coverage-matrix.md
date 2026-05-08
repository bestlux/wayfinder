# Level 1 Coverage Matrix

This document tracks what Wayfinder currently guides at level 1, what is only partly guided, and what is still intentionally out of scope.

It is meant to stay grounded in the current repo, not to describe aspirational future behavior.

For deeper repo-plus-compendium audits, see [Level 1 Default-Rules Gap Audit](./level1-default-rules-gap-audit.md) and [AP And Side-Book Level 1 Audit](./ap-sidebook-level1-audit.md).

## Status Legend

- `Guided`: Wayfinder plans, renders, drafts, invalidates, and applies this flow today.
- `Guided when PF2E rule data is structured`: the workflow exists, but it depends on PF2E item rules exposing a supported shape.
- `Partial / deferred`: Wayfinder helps, but still intentionally relies on PF2E-native workflows or manual interpretation for part of the step.
- `Not covered`: no dedicated guided workflow yet.

## Level 1 Core Flow

| Area | Status | Current handling | Notes |
| --- | --- | --- | --- |
| Ancestry selection | Guided | Pick-item step | Part of the base progression skeleton. |
| Heritage selection | Guided | Pick-item step | Planned after ancestry in the base skeleton. |
| Background selection | Guided | Pick-item step | Planned in the base skeleton. |
| Class selection | Guided | Pick-item step | Planned in the base skeleton. |
| Creation boosts | Guided | Dedicated boost step | Guided inside Wayfinder before the draft is applied. |
| Level 1 ancestry feat | Guided | Pick-item step | Comes from the progression skeleton. |
| Level 1 class feat | Guided | Pick-item step | Planned through the app-facing plan builder on top of the progression skeleton. |
| Class skill training | Guided | Dedicated class-training steps | Covers fixed and rule-driven training choices exposed by PF2E data. |
| Class branches | Guided when PF2E rule data is structured | Branch-discovery and branch-selection steps | Works when the class exposes selector-style branch rules cleanly. |
| Class-owned granted selections | Guided when PF2E rule data is structured | Granted-item and class-choice steps | Includes flows like deity-linked or class-linked granted selections when discoverable from rules. |
| Class-owned spell choices | Guided, with deeper support for wizard and cleric | Shared spell-choice engine plus class contributors | Wizard and cleric are the deepest contributors today; other classes rely on the shared path. |
| Singleton `ChoiceSet` decisions from ancestry, heritage, background, class, deity, or selected feat sources | Guided when PF2E rule data is structured | Generic singleton-choice workflow | Supports planning, draft storage, invalidation, and apply-side persistence for supported `ChoiceSet` rules. |
| Non-class filtered feat grants | Guided when PF2E rule data is structured | Grant-choice workflow | Covers filtered `ChoiceSet` plus `GrantItem` paths such as Ancient Elf, Versatile Human, Nascent, General Training, and Natural Ambition. |
| Static UUID-backed grants | Guided when PF2E rule data is a non-predicate UUID list | Grant-choice workflow with explicit UUID allowlists | Covers AP/player-guide background feat pairs, side-book heritage feat pairs, and selected class-feature branch lists that use static compendium UUID choices. |
| Bonus languages after creation boosts | Guided | Dedicated language-choice step | Uses effective post-boost state, so the final Intelligence modifier can affect count. |
| Background or ancestry lore choices | Guided when PF2E rule data is structured | Generic singleton-choice workflow | Works when PF2E expresses the choice as a supported singleton `ChoiceSet`. |
| Background or ancestry free-skill choices | Guided when PF2E rule data is structured | Generic singleton-choice workflow plus training projection where a skill-rank rule exists | Some choices only persist the rules selection; they do not always imply a skill rank by themselves. |
| Level 1 rarity and source filtering while picking | Guided | Composable picker filters | Available in the selection panes as UI filtering, not as separate progression steps. |
| Level 1 skill increases | Partial / deferred | Dedicated checkpoint step | Wayfinder tracks the milestone and applies drafted increases, but this is not a blank-character level-1 decision. |
| Starting gear or item purchasing | Not covered | None | Still outside the guided creation flow. |
| Daily preparations | Not covered | None | Still intentionally out of scope. |

## Coverage Strengths

- The level-1 plan no longer stops at the bare progression skeleton. The app-facing planner layers singleton choices, grant choices, languages, class branches, class-owned choices, and spell choices on top of the base progression steps.
- Generic singleton `ChoiceSet` support is now real infrastructure instead of one-off UI logic. That makes ancestry, heritage, background, class, and deity-owned singleton choices extensible without pushing policy back into `app-shell.ts`.
- Non-class grant-choice support now covers the first filtered feat-grant shape instead of forcing PF2E-native popups for every such decision.
- Wizard and cleric have the strongest class-specific support because they already use the contributor seam under `src/wayfinder/classes/`.
- Level-1 picker usability is materially better than the original proof of concept because rarity and source filters are now first-class pane state instead of just richer text search.

## Known Partial Areas

- Some level-1 choices are only as good as the PF2E rule data that drives them. If a background, ancestry, heritage, feat, or class does not expose a supported `ChoiceSet`, grant-choice, or selector shape, Wayfinder cannot infer a guided step for it automatically.
- Background or ancestry singleton choices do not always project a trained skill rank. Wayfinder only projects training when the owning item rules actually drive a skill-rank effect.
- Predicate-gated singleton follow-up chains are supported when predicates are driven by earlier singleton roll-option selections. Broader actor-roll-option predicates still need content-driven audit before being called broadly covered.
- The base progression layer still looks smaller than the true feature set because the richer level-1 steps are composed later by `src/wayfinder/application/wayfinder-plan-builder-service.ts`.
- Class coverage is structurally extensible now, but not all classes are equally deep. The contributor seam exists; only wizard and cleric currently push beyond the shared generic behavior.

## Highest-Value Follow-Ups

1. Smoke-test the new non-class grant-choice workflow against nearby cases such as `Versatile Human`, `General Training`, `Natural Ambition`, and `Nascent`.
2. Live smoke-test the `Magical Experiment` predicate chain, grant-choice targets, and `Wisp Fetchling` fallback guard in Foundry.
3. Live-smoke representative AP and side-book static UUID grants from the AP/side-book audit.
4. Add full-flow integration tests that exercise representative martial, divine, singleton-choice, grant-choice, and language-sensitive paths.
