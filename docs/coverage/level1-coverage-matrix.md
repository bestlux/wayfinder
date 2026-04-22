# Level 1 Coverage Matrix

This document tracks what Wayfinder currently guides at level 1, what is only partly guided, and what is still intentionally out of scope.

It is meant to stay grounded in the current repo, not to describe aspirational future behavior.

For a deeper repo-plus-compendium audit of what is still missing under the local PF2E 8.0.3 install, see [Level 1 Default-Rules Gap Audit](./level1-default-rules-gap-audit.md).

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
| Singleton `ChoiceSet` decisions from ancestry, heritage, background, class, or deity | Guided when PF2E rule data is structured | Generic singleton-choice workflow | Supports planning, draft storage, invalidation, and apply-side persistence for supported `ChoiceSet` rules. |
| Bonus languages after creation boosts | Guided | Dedicated language-choice step | Uses effective post-boost state, so the final Intelligence modifier can affect count. |
| Background or ancestry lore choices | Guided when PF2E rule data is structured | Generic singleton-choice workflow | Works when PF2E expresses the choice as a supported singleton `ChoiceSet`. |
| Background or ancestry free-skill choices | Guided when PF2E rule data is structured | Generic singleton-choice workflow plus training projection where a skill-rank rule exists | Some choices only persist the rules selection; they do not always imply a skill rank by themselves. |
| Level 1 rarity and source filtering while picking | Guided | Composable picker filters | Available in the selection panes as UI filtering, not as separate progression steps. |
| Level 1 skill increases | Partial / deferred | Dedicated checkpoint step | Wayfinder tracks the milestone and applies drafted increases, but this is not a blank-character level-1 decision. |
| Starting gear or item purchasing | Not covered | None | Still outside the guided creation flow. |
| Daily preparations | Not covered | None | Still intentionally out of scope. |

## Coverage Strengths

- The level-1 plan no longer stops at the bare progression skeleton. The app-facing planner layers singleton choices, languages, class branches, class-owned choices, and spell choices on top of the base progression steps.
- Generic singleton `ChoiceSet` support is now real infrastructure instead of one-off UI logic. That makes ancestry, heritage, background, class, and deity-owned singleton choices extensible without pushing policy back into `app-shell.ts`.
- Wizard and cleric have the strongest class-specific support because they already use the contributor seam under `src/wayfinder/classes/`.
- Level-1 picker usability is materially better than the original proof of concept because rarity and source filters are now first-class pane state instead of just richer text search.

## Known Partial Areas

- Some level-1 choices are only as good as the PF2E rule data that drives them. If a background, ancestry, heritage, or class does not expose a supported `ChoiceSet` or selector shape, Wayfinder cannot infer a guided step for it automatically.
- Background or ancestry singleton choices do not always project a trained skill rank. Wayfinder only projects training when the owning item rules actually drive a skill-rank effect.
- The base progression layer still looks smaller than the true feature set because the richer level-1 steps are composed later by `src/wayfinder/application/wayfinder-plan-builder-service.ts`.
- Class coverage is structurally extensible now, but not all classes are equally deep. The contributor seam exists; only wizard and cleric currently push beyond the shared generic behavior.

## Highest-Value Follow-Ups

1. Keep expanding level-1 coverage through the existing singleton-choice and contributor seams rather than adding special cases to `app-shell.ts`.
2. Add a few full-flow integration tests that exercise representative level-1 builds across martial, divine, singleton-choice, and language-sensitive paths.
3. Pick the next class that deserves deeper contributor-backed guidance once the remaining level-1 gaps are better mapped.
