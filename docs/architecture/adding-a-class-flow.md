# Adding A Class Flow

This repo now has an internal extension seam for class-specific behavior. Use it to keep new character-creation work out of `src/wayfinder/app-shell.ts` and out of the generic discovery/building modules unless the behavior is truly shared.

## When To Add A Contributor

Add or extend a contributor under `src/wayfinder/classes/` when a rule is class-specific and changes which spell-choice or other class-owned planning steps should exist.

Use the base/generic path when the behavior is not specific to one class, or when two or more classes clearly share the same rule shape.

Right now:

- `src/wayfinder/classes/registry.ts` selects the contributor by class slug.
- `src/wayfinder/classes/wizard-contributor.ts` owns wizard-specific spell-choice composition.
- `src/wayfinder/classes/cleric-contributor.ts` owns cleric-specific spell-choice composition.

If you add a new class, start with the smallest contributor that delegates into an existing engine or builder. Do not build a second orchestration path inside the contributor.

## Where Branch Rules Belong

Branch and class-choice discovery belongs under `src/wayfinder/class-choice/`.

Use these seams:

- `src/wayfinder/class-choice/rule-discovery.ts` for generic discovery logic that can be shared across classes.
- `src/wayfinder/class-choice/step-builders.ts` for turning discovered rules into `PendingStep` values.
- `src/wayfinder/class-choice-service.ts` as the public facade, not as the place to accumulate new policy.

If a rule is specific to one class, do not force it into `rule-discovery.ts` just because that is where similar logic already exists. Keep class-only behavior near the contributor unless there is hard evidence it is becoming generic.

## Where Spell-Choice Rules Belong

Spell-choice planning belongs in the contributor plus the `src/wayfinder/spell-choice/` builders.

Use these seams:

- `src/wayfinder/classes/*.ts` to decide which class-specific spell-choice builder should run.
- `src/wayfinder/spell-choice/wizard-step-builder.ts` and `src/wayfinder/spell-choice/cleric-step-builder.ts` for class-specific step construction.
- `src/wayfinder/spell-choice/step-builders.ts` and neighboring helpers for shared orchestration and filtering.
- `src/wayfinder/spell-choice-service.ts` as the thin facade that routes to the contributor-backed builder path.

Do not put new spell-choice planning back into `app-shell.ts`, and do not recreate a second parallel builder path in tests or docs helpers.

## Where Actor-Apply Rules Belong

Apply-side mutations belong in `src/actor-updater/` and the small shared application helpers around it.

Use these seams:

- `src/actor-updater.ts` as the orchestration entrypoint only.
- `src/actor-updater/*-application.ts` for focused apply behavior.
- `src/selector-application.ts`, `src/class-branch-service.ts`, and `src/class-feature-choice-service.ts` for shared selector-driven item application.

If a new class flow changes actor items, spellcasting state, or granted selections, put the mutation logic on the apply side. `app-shell.ts` should gather intent and trigger services, not own rules mutation policy.

## Required Tests For A New Class Flow

At minimum, add coverage in the seam where the new behavior lives.

- Add or extend a contributor test when the new class changes contributor routing or class-specific spell-choice composition.
- Add a direct `rule-discovery` or step-builder test when the new flow depends on class-choice rule parsing.
- Add or extend apply-side tests under `tests/actor-updater-*.test.ts` when the flow changes granted items, spellcasting, or draft application behavior.
- Add a plan-builder or service-level regression test when the flow must appear in the user-visible Wayfinder plan.
- Run `npm run check` before closing the slice.

If `src/` changes, regenerate `scripts/` in the same change with `npm run build`.

## Common Failure Modes

- Adding class-specific conditionals directly to `src/wayfinder/app-shell.ts`.
- Growing `src/wayfinder/class-choice/rule-discovery.ts` with one-off class behavior that is not actually generic.
- Putting orchestration into contributors instead of delegating into the existing builders and services.
- Recreating parallel builder paths in tests instead of exercising the exported production seams.
- Adding apply behavior in plan-building code instead of `src/actor-updater/`.
- Forgetting to update generated `scripts/` output after changing `src/`.
