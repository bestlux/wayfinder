# Wayfinder Prelaunch Priority Plan

**Goal:** Close the highest-value remaining gaps in first-time PF2E character creation before expanding into another deep class-specific slice.

**Why this order:** The next missing features are not independent. Languages, background or ancestry lore, and free-skill decisions all want the same reusable decision platform. That platform should land first so the feature work that follows composes cleanly instead of adding one-off logic to `app-shell.ts`, `class-choice-service.ts`, or ad hoc draft maps.

## Priority Order

1. Generalized singleton-item `ChoiceSet` workflow
2. Languages
3. Background and ancestry lore, free skills, and similar starting choices
4. Picker filters

## Current State

Wayfinder already covers the core creation skeleton well:

- ancestry, heritage, background, and class picks
- creation boosts and later ability-boost milestones
- class skill training
- class-branch, class-choice, deity-grant, and spell-choice flows where PF2E data exposes them cleanly
- deeper spellcasting support for wizard and cleric

The main remaining prelaunch gap is that non-class singleton documents still do not have a general guided workflow for embedded `ChoiceSet`-style decisions such as languages, lore, or similar starting picks.

## Design Guardrails

- Build the reusable platform first, then make languages and lore/free-skill choices the first consumers.
- Do not add singleton-document decision logic directly to `src/wayfinder/app-shell.ts`.
- Do not overload the class-specific contributor seam for ancestry, heritage, or background rules.
- Reuse the existing draft-decision, invalidation, pane-building, and apply-side seams where possible.
- Keep picker filtering as a UI plus application concern layered on existing option metadata, not as new pack-specific branching logic.

## Task 1: Generalized Singleton-Item ChoiceSet Workflow

**Intent:** Add one reusable workflow for rule-driven decisions that originate from singleton items such as ancestry, heritage, background, class, or deity, without pretending they are class-only choices.

**What this should unlock first:**

- language choices from ancestry or heritage
- background or ancestry lore choices
- background or ancestry free-skill choices

**Target shape:**

- introduce a generic decision model for singleton-source `ChoiceSet` rules
- plan those steps from the effective singleton documents, not from hardcoded UI logic
- support dependency ordering where a step must wait for another drafted choice or final projected stats
- add apply-side logic that writes the selected values into the granting item's `rulesSelections` or the correct PF2E-owned destination

**Likely seams:**

- `src/wayfinder/domain/` for the new step or decision shape
- `src/wayfinder/application/wayfinder-plan-builder-service.ts` for orchestration
- a new focused singleton-choice module under `src/wayfinder/`
- `src/actor-updater/` or a shared apply helper for persisted selections

**Done when:**

- singleton-driven `ChoiceSet` decisions can be planned, rendered, drafted, invalidated, and applied without special-casing each feature in `app-shell.ts`

## Task 2: Languages

**Intent:** Guide legal language choices during creation, after creation boosts are resolved, so the step can use final Intelligence and any ancestry or heritage language grants.

**Requirements:**

- step appears after level-1 boost allocation
- available count is computed from effective post-boost state plus granted languages
- duplicate selections are prevented
- apply path updates the correct PF2E-owned language data

**Design note:**

Languages should be the first full validation that the generalized singleton-choice workflow can handle stat-sensitive decisions instead of only static rule lists.

**Done when:**

- a fresh character can complete language selection inside Wayfinder with the correct number of choices and see those choices applied to the actor cleanly

## Task 3: Background And Ancestry Lore Or Free-Skill Choices

**Intent:** Extend the same workflow to the other common starting decisions that currently fall between "fixed trained skills" and "fully guided steps."

**Examples in scope:**

- background lore selection
- background free skill selection
- ancestry or heritage rule-driven skill selections
- similar 1st-level non-class `ChoiceSet` decisions that the new generic platform can represent cleanly

**Guardrail:**

Do not implement each of these as isolated panes with isolated draft storage. If a choice fits the new singleton `ChoiceSet` platform, it should use it.

**Done when:**

- at least one background-driven and one ancestry- or heritage-driven non-language choice flow are implemented through the generic path

## Task 4: Picker Filters

**Intent:** Improve usability once the missing creation decisions exist, without blocking them first.

**Minimum useful filter set:**

- rarity
- source

**Nice follow-ons if the implementation stays clean:**

- trait filters for feats
- tradition filters for spells
- mutually composable multi-select filter state

**Design note:**

The picker already exposes `source` and `rarity` metadata. This task should add real per-pane filter state and filtering behavior, not just richer text search.

**Done when:**

- users can combine at least rarity and source filters in the picker without breaking existing search, preview, or draft-selection flows

## Suggested Execution Order

1. Define the generic singleton-choice model and its tests.
2. Land the languages workflow on top of it.
3. Extend that platform to lore and free-skill choices.
4. Add picker filters after the missing decision coverage is in place.

## Not In This Slice

- deep new class-specific contributors
- daily preparations
- item purchasing or starting gear shopping
- broad UI redesign
- broad architecture cleanup unrelated to the four priorities above

## Readiness Check

This is the right prelaunch order because it closes real character-creation gaps first and keeps the architecture honest. It also avoids the common failure mode where convenience UX work like filters lands before the missing creation decisions themselves.
