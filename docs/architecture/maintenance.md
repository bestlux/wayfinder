# Architecture Maintenance Notes

This is the current architecture guide for future Wayfinder work. Completed plans, roadmap snapshots, and one-off audit transcripts should not live here; keep this file focused on current ownership boundaries and refactor guardrails.

## Current Seams

- `src/wayfinder/domain/` owns typed workflow concepts such as step kinds, decision IDs, slot IDs, completion, and invalidation.
- `src/wayfinder/application/` owns actor-aware orchestration such as plan building, pane assembly, selection commands, and draft lifecycle.
- `src/wayfinder/classes/` owns class-specific contributors. New class-specific spell or branch behavior should start there and delegate into shared builders.
- `src/wayfinder/*-choice/` and `src/wayfinder/skill-training/` own rule discovery and step construction for reusable PF2E rule shapes.
- `src/actor-updater/` owns apply-side mutations. Plan building should collect intent; actor mutation policy belongs on the apply side.
- `src/shared/` owns reusable Foundry/PF2E document helpers, compatibility shims, compendium UUID parsing, and item-source policy.
- `scripts/` is generated output from `src/`; update it with `npm run build` after source changes.

## Refactor Guardrails

- Preserve PF2E as the rules engine. Prefer preseeding PF2E-owned item state such as `rulesSelections`, `itemGrants`, source IDs, and `GrantItem` preselect choices over manually reproducing PF2E behavior.
- Add shared helpers only after at least two current call sites have the same policy decision or data-shape rule.
- Keep one-off class, ancestry, heritage, or AP content behavior out of generic services until a real shared rule shape is proven.
- Do not add new compendium UUID parsing, predicate-tree walking, rule-selection writes, source stamping, or Foundry compatibility shims without checking the existing shared helpers first.
- Pair behavior refactors with targeted tests at the seam being changed, then run the full repo gate before closing meaningful work.

## Residual Complexity

These are the known higher-value cleanup seams. They are deliberately not casual line-count cleanup.

- Apply-side operation model: name the different item mutation paths explicitly, such as selected item creation, native grant preseeding, manual grant creation, rule-selection persistence, and existing-selection repair.
- Source-family contributor registry: reduce direct loops in the plan builder by registering level-1 source families behind small input/output contracts.
- Pack service boundary split: isolate Foundry pack access from option filtering and picker view-model shaping.
- Skill and lore parser slices: split real PF2E skill/lore rule-shape parsers behind fixture-covered functions without broadening text inference.
- Side-book class contributors: add class support one class at a time, starting from the most regular level-1 rule shapes.

Use the coverage docs to decide whether a new behavior belongs in a current seam or needs a fresh implementation goal.
