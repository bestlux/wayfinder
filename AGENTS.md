# Character Gen Repo Guide

Repo-local instructions for `D:\Source\foundryvtt\character-gen`.

## Layout

- `src/` is the source of truth.
- `scripts/` is generated build output from `npm run build`; keep it in sync with `src/` changes.
- `templates/` holds Handlebars templates. Keep `templates/wayfinder-app.hbs` as the shell and place pane-specific markup in `templates/wayfinder/`.
- `styles/wayfinder.css` is the single module entry stylesheet. Put feature-specific CSS in `styles/wayfinder/` and import it from the entry file.
- `tests/` covers pure logic and service behavior. Prefer adding tests for extracted modules before growing `app-shell` again.

## Validation

- Required before closing meaningful work:
  - `npm run format:check`
  - `npm run lint`
  - `npm run build`
  - `npm test`
  - `npm run check:strict`
- If `src/` changes, make sure the generated `scripts/` output is updated in the same change.

## Tooling

- `Biome` owns formatting and import organization.
- `ESLint` owns TypeScript linting for `src/`, `tests/`, and repo config files.
- Do not hand-edit `scripts/` without regenerating from `src/`.

## Wayfinder Structure

- `src/wayfinder-app.ts` is the public entrypoint. Keep it thin.
- `src/wayfinder/app-shell.ts` owns Foundry lifecycle and actor-bound mutations.
- New pane view-model logic belongs in `src/wayfinder/panes/`.
- Step evaluation and progression assembly belong in `src/wayfinder/plan-service.ts`.
- Formatting, action parsing, and other reusable app helpers belong in focused internal modules under `src/wayfinder/`.

## Editing Rules

- Read generated and source files before editing either.
- Prefer extending existing internal modules over adding more private methods to `app-shell`.
- Preserve current UX unless the task explicitly includes UI changes.
- Keep changes scoped; avoid unrelated cleanup while touching generated output.
