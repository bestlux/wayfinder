# Wayfinder Post-Foundation Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the post-foundation hardening work so new class, spell, and rules-driven character creation flows can be added without re-centralizing policy in `app-shell.ts` or creating new service god objects.

**Architecture:** Keep workflow rules in `src/wayfinder/domain/`, actor-aware orchestration in `src/wayfinder/application/`, apply-side mutations in `src/actor-updater/`, and Foundry/PF2E document normalization in `src/build-state.ts` plus `src/shared/`. The next slices should peel typed adapters and read models out of `build-state.ts`, `class-choice-service.ts`, and `spell-choice-service.ts`, then extend the strict-analysis ratchet to those seams.

**Tech Stack:** TypeScript 6, Vitest, ESLint, Biome, Foundry VTT 13, PF2E 7.10.1

---

## Current Standing

- `src/wayfinder/app-shell.ts` is down to 838 lines and is no longer the primary architecture risk, but it still should not regain rule-building responsibilities.
- `src/build-state.ts` is 340 lines with 19 `any` hits and still mixes actor probing, document resolution, and ability projection in one file.
- `src/wayfinder/class-choice-service.ts` is 680 lines with 35 `any` hits and still mixes rule discovery, document inspection, and step creation.
- `src/wayfinder/spell-choice-service.ts` is 650 lines with 20 `any` hits and still mixes planner logic, actor-item matching, and PF2E spellcasting heuristics.
- The strict-analysis ratchet now protects `src/shared/`, `src/actor-updater/`, `src/wayfinder/domain/`, and `src/wayfinder/application/`, but it does not yet cover the remaining hotspots above.
- Test structure is much healthier than before: subsystem and application/domain tests now exist, which means future extractions can land in smaller slices.

## Maintainability Verdict

Wayfinder is now maintainable enough for disciplined incremental work. It is no longer a proof-of-concept in the original sense, and it is materially easier for agents to extend than it was before the Stage 1-7 work. The remaining risk is concentrated, not systemic.

The repo is not yet "safe by default" for unlimited feature growth. If new class rules keep landing directly in `build-state.ts`, `class-choice-service.ts`, or `spell-choice-service.ts`, those files will become the next generation of god objects. The right move is not another broad rewrite; it is a sequence of narrow extractions that establish where new rule families belong.

## Extension Guardrails

- New workflow rules belong in `src/wayfinder/domain/` if they can be evaluated without actor mutation or Foundry globals.
- New actor-aware orchestration belongs in `src/wayfinder/application/`.
- New apply-side mutations belong in `src/actor-updater/`.
- Foundry/PF2E document shape adapters and reusable lookup helpers belong in `src/shared/` or focused helpers behind `src/build-state.ts`.
- Avoid adding new decision logic directly to `src/wayfinder/app-shell.ts`.
- Avoid adding unrelated rule branches to `src/wayfinder/class-choice-service.ts` or `src/wayfinder/spell-choice-service.ts` once a focused helper module exists.
- Every extraction slice should add or keep focused tests before the service entrypoint is rewritten.

## File Map For The Next Slices

- Modify: `src/build-state.ts`
- Create: `src/build-state/singleton-resolution.ts`
- Create: `src/build-state/ability-projection.ts`
- Create: `src/build-state/document-types.ts`
- Test: `tests/build-state.test.ts`
- Test: `tests/build-state-singleton-resolution.test.ts`
- Modify: `src/wayfinder/spell-choice-service.ts`
- Create: `src/wayfinder/spell-choice/step-builders.ts`
- Create: `src/wayfinder/spell-choice/existing-selections.ts`
- Create: `src/wayfinder/spell-choice/spell-matching.ts`
- Test: `tests/spell-choice-service.test.ts`
- Test: `tests/wayfinder-spell-choice-step-builders.test.ts`
- Modify: `src/wayfinder/class-choice-service.ts`
- Modify: `src/wayfinder/existing-selection-service.ts`
- Create: `src/wayfinder/class-choice/rule-discovery.ts`
- Create: `src/wayfinder/class-choice/step-builders.ts`
- Create: `src/wayfinder/class-choice/skill-config.ts`
- Test: `tests/class-choice-service.test.ts`
- Test: `tests/existing-selection-service.test.ts`
- Test: `tests/wayfinder-class-choice-step-builders.test.ts`
- Modify: `tsconfig.strict.json`
- Modify: `eslint.config.mjs`

### Task 1: Rebuild `build-state.ts` Around Typed Adapters

**Files:**
- Create: `src/build-state/document-types.ts`
- Create: `src/build-state/singleton-resolution.ts`
- Create: `src/build-state/ability-projection.ts`
- Modify: `src/build-state.ts`
- Test: `tests/build-state.test.ts`
- Test: `tests/build-state-singleton-resolution.test.ts`

- [ ] **Step 1: Add focused failing tests for singleton precedence and actor-item fallback**

Add coverage for these behaviors in `tests/build-state-singleton-resolution.test.ts`:

```ts
it("prefers the draft selection document over the actor item", async () => {
  const result = await resolveEffectiveSingletonDocument({
    actor,
    draft,
    itemType: "class",
    fetchSelectionDocument,
    resolveSourceDocumentFromActorItem,
  });

  expect(result?.slug).toBe("wizard");
});

it("falls back to the actor item source document when the draft has no selection", async () => {
  const result = await resolveEffectiveSingletonDocument({
    actor,
    draft,
    itemType: "deity",
    fetchSelectionDocument,
    resolveSourceDocumentFromActorItem,
  });

  expect(result?.slug).toBe("pharasma");
});
```

- [ ] **Step 2: Extract typed document and actor-item helpers**

Create `src/build-state/document-types.ts` with the minimum shared shapes the module actually needs:

```ts
export interface WayfinderDocumentLike {
  _id?: string;
  name?: string;
  slug?: string;
  type?: string;
  system?: Record<string, unknown>;
  flags?: Record<string, unknown>;
}

export interface WayfinderActorItemLike extends WayfinderDocumentLike {
  id?: string;
}
```

Create `src/build-state/singleton-resolution.ts`:

```ts
export async function resolveEffectiveSingletonDocument(args: {
  actor: unknown;
  draft: DraftState;
  itemType: "ancestry" | "heritage" | "background" | "class" | "deity";
  fetchSelectionDocument: (selection: SelectionRef) => Promise<WayfinderDocumentLike | null>;
  resolveSourceDocumentFromActorItem: (
    actorItem: WayfinderActorItemLike,
    itemType: "ancestry" | "heritage" | "background" | "class" | "deity"
  ) => Promise<WayfinderDocumentLike | null>;
}): Promise<WayfinderDocumentLike | null> {
  // move draft-vs-actor precedence here
}
```

- [ ] **Step 3: Extract ability projection into a pure helper**

Create `src/build-state/ability-projection.ts`:

```ts
export function buildProjectedAbilities(args: {
  ancestryBoosts: AbilityKey[];
  ancestryFlaws: AbilityKey[];
  backgroundBoosts: AbilityKey[];
  classBoost: AbilityKey | null;
  levelBoosts: Record<BoostLevel, AbilityKey[]>;
}): Record<AbilityKey, ProjectedAbilityState> {
  // move counting and modifier projection here
}
```

- [ ] **Step 4: Reduce `src/build-state.ts` to orchestration and public exports**

Leave `src/build-state.ts` responsible for:

```ts
export interface EffectiveBuildState {
  ancestry: EffectiveAncestryState | null;
  heritage: WayfinderDocumentLike | null;
  background: EffectiveBackgroundState | null;
  class: EffectiveClassState | null;
  deity: WayfinderDocumentLike | null;
  levelBoosts: Record<BoostLevel, AbilityKey[]>;
  allowedBoosts: Record<BoostLevel, number>;
  projectedAbilities: Record<AbilityKey, ProjectedAbilityState>;
}

export async function getEffectiveBuildState(actor: unknown, draft: DraftState): Promise<EffectiveBuildState> {
  // orchestrate extracted helpers here
}
```

- [ ] **Step 5: Run the focused tests and then the repo check**

Run: `npm test -- tests/build-state.test.ts tests/build-state-singleton-resolution.test.ts`
Expected: PASS for both files

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/build-state.ts src/build-state tests/build-state.test.ts tests/build-state-singleton-resolution.test.ts
git commit -m "refactor: split build state adapters and projections"
```

### Task 2: Split Spell Choice Planning From Actor Matching

**Files:**
- Create: `src/wayfinder/spell-choice/step-builders.ts`
- Create: `src/wayfinder/spell-choice/existing-selections.ts`
- Create: `src/wayfinder/spell-choice/spell-matching.ts`
- Modify: `src/wayfinder/spell-choice-service.ts`
- Test: `tests/spell-choice-service.test.ts`
- Test: `tests/wayfinder-spell-choice-step-builders.test.ts`

- [ ] **Step 1: Add failing tests that isolate planner behavior from actor-item matching**

Add coverage in `tests/wayfinder-spell-choice-step-builders.test.ts`:

```ts
it("builds wizard school and spellbook choice steps without actor-item dependencies", async () => {
  const steps = buildSpellChoiceStepsForClass({
    currentLevel: 1,
    targetLevel: 1,
    effectiveClassDocument: wizardDocument,
    effectiveSchoolDocument: schoolDocument,
    effectiveDeityDocument: null,
    extractSlug,
  });

  expect(steps.map((step) => step.slotId)).toContain("class:spell-choice:wizard:arcane-school");
});
```

Add actor-matching coverage in `tests/spell-choice-service.test.ts`:

```ts
it("reads existing spell selections from an entry without rebuilding planner logic", () => {
  const selections = readExistingSpellChoiceSelections(actor, choice);
  expect(selections).toHaveLength(2);
});
```

- [ ] **Step 2: Extract pure step-building helpers**

Create `src/wayfinder/spell-choice/step-builders.ts`:

```ts
export function buildSpellChoiceStepsForClass(args: {
  currentLevel: number;
  targetLevel: number;
  effectiveClassDocument: unknown;
  effectiveDeityDocument: unknown | null;
  effectiveSchoolDocument: unknown | null;
  extractSlug: (document: unknown) => string | null;
}): PendingStep[] {
  // move pure planning logic here
}
```

- [ ] **Step 3: Extract actor-item matching and existing-selection reads**

Create `src/wayfinder/spell-choice/existing-selections.ts` and `src/wayfinder/spell-choice/spell-matching.ts`:

```ts
export function readExistingSpellChoiceSelections(actor: unknown, choice: SpellChoiceMeta): SelectionRef[] {
  // move actor-item scanning here
}

export function spellMatchesChoice(item: unknown, choice: SpellChoiceMeta, entryId: string): boolean {
  // move entry/rank/prepared-slot matching here
}
```

- [ ] **Step 4: Keep `src/wayfinder/spell-choice-service.ts` as the public facade**

The service should export the same public API shape, but mostly delegate:

```ts
export async function buildSpellChoiceSteps(args: BuildSpellChoiceStepsArgs): Promise<PendingStep[]> {
  return buildSpellChoiceStepsForClass({
    currentLevel: args.currentLevel,
    targetLevel: args.targetLevel,
    effectiveClassDocument: args.effectiveClassDocument,
    effectiveDeityDocument: args.effectiveDeityDocument,
    effectiveSchoolDocument: args.effectiveSchoolDocument,
    extractSlug: args.extractSlug,
  });
}
```

- [ ] **Step 5: Run the focused suites and the repo check**

Run: `npm test -- tests/spell-choice-service.test.ts tests/wayfinder-spell-choice-step-builders.test.ts`
Expected: PASS

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/wayfinder/spell-choice src/wayfinder/spell-choice-service.ts tests/spell-choice-service.test.ts tests/wayfinder-spell-choice-step-builders.test.ts
git commit -m "refactor: split spell choice planning from actor matching"
```

### Task 3: Split Class Choice Rule Discovery From Step Creation

**Files:**
- Create: `src/wayfinder/class-choice/rule-discovery.ts`
- Create: `src/wayfinder/class-choice/step-builders.ts`
- Create: `src/wayfinder/class-choice/skill-config.ts`
- Modify: `src/wayfinder/class-choice-service.ts`
- Modify: `src/wayfinder/existing-selection-service.ts`
- Test: `tests/class-choice-service.test.ts`
- Test: `tests/existing-selection-service.test.ts`
- Test: `tests/wayfinder-class-choice-step-builders.test.ts`

- [ ] **Step 1: Add failing tests for pure rule-discovery behavior**

Add coverage in `tests/wayfinder-class-choice-step-builders.test.ts`:

```ts
it("builds training and branch steps from class rules without actor reads", async () => {
  const steps = await buildClassStepsFromRules({
    effectiveClassDocument: fighterDocument,
    effectiveDeityDocument: null,
    targetLevel: 1,
    localize,
    extractSlug,
  });

  expect(steps.map((step) => step.kind)).toContain("skill-training");
  expect(steps.map((step) => step.kind)).toContain("class-branch");
});
```

- [ ] **Step 2: Extract skill-config and rule-discovery helpers**

Create `src/wayfinder/class-choice/skill-config.ts`:

```ts
export function getConfiguredSkills(): Record<string, { label: string }> {
  // isolate CONFIG.PF2E skill lookups here
}
```

Create `src/wayfinder/class-choice/rule-discovery.ts`:

```ts
export function findRelevantClassRules(document: unknown): Array<Record<string, unknown>> {
  // isolate ChoiceSet / GrantItem / deity-dependent rule filtering here
}
```

- [ ] **Step 3: Extract step-building helpers**

Create `src/wayfinder/class-choice/step-builders.ts`:

```ts
export async function buildClassStepsFromRules(args: {
  draft: DraftState;
  effectiveClassDocument: unknown | null;
  effectiveDeityDocument: unknown | null;
  targetLevel: number;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<unknown | null>;
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
}): Promise<PendingStep[]> {
  // move rule-to-step orchestration here
}
```

- [ ] **Step 4: Keep actor reads narrow and local**

Reduce `src/wayfinder/existing-selection-service.ts` to typed actor-item lookup helpers:

```ts
export function readExistingClassChoiceSelection(actor: unknown, choice: ClassChoiceMeta): string | null {
  // actor-item lookup only
}
```

Keep `src/wayfinder/class-choice-service.ts` as the public facade that wires class-rule discovery, step builders, and existing-selection helpers together.

- [ ] **Step 5: Run the focused suites and the repo check**

Run: `npm test -- tests/class-choice-service.test.ts tests/existing-selection-service.test.ts tests/wayfinder-class-choice-step-builders.test.ts`
Expected: PASS

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/wayfinder/class-choice src/wayfinder/class-choice-service.ts src/wayfinder/existing-selection-service.ts tests/class-choice-service.test.ts tests/existing-selection-service.test.ts tests/wayfinder-class-choice-step-builders.test.ts
git commit -m "refactor: split class choice rule discovery from step creation"
```

### Task 4: Extend The Strict Ratchet To The Remaining Hotspots

**Files:**
- Modify: `tsconfig.strict.json`
- Modify: `eslint.config.mjs`
- Test: `npm run check:strict`

- [ ] **Step 1: Expand the strict TypeScript include list**

Update `tsconfig.strict.json` to include:

```json
{
  "include": [
    "src/build-state.ts",
    "src/build-state/**/*.ts",
    "src/wayfinder/class-choice-service.ts",
    "src/wayfinder/class-choice/**/*.ts",
    "src/wayfinder/existing-selection-service.ts",
    "src/wayfinder/spell-choice-service.ts",
    "src/wayfinder/spell-choice/**/*.ts"
  ]
}
```

- [ ] **Step 2: Extend the lint ratchet to the same surfaces**

Update `eslint.config.mjs` so the strict override includes:

```ts
files: [
  "src/build-state.ts",
  "src/build-state/**/*.ts",
  "src/wayfinder/class-choice-service.ts",
  "src/wayfinder/class-choice/**/*.ts",
  "src/wayfinder/existing-selection-service.ts",
  "src/wayfinder/spell-choice-service.ts",
  "src/wayfinder/spell-choice/**/*.ts",
]
```

- [ ] **Step 3: Run the strict and full checks**

Run: `npm run check:strict`
Expected: PASS

Run: `npm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tsconfig.strict.json eslint.config.mjs
git commit -m "chore: extend strict checks to state and choice services"
```

## Markdown And Guidance Cleanup

- Keep `docs/architecture/wayfinder-foundation-refactor-plan.md` as historical context, not the active execution plan.
- Treat this document as the active post-foundation roadmap until the four tasks above are complete.
- Keep `AGENTS.md` short and architectural. It should describe where work belongs, not restate the whole plan.
- Keep the README architecture note short. Deeper extension guidance belongs here, not in the README.

## Self-Review

- Spec coverage: this plan covers the remaining smell hotspots, strictness expansion, and the guidance problem for future extension. It intentionally does not reopen `app-shell.ts` or `actor-updater/` because those are no longer the highest-risk surfaces.
- Placeholder scan: no `TBD`, `TODO`, or "similar to Task N" placeholders remain.
- Type consistency: the plan uses one consistent boundary: typed document adapters in `src/build-state/`, pure planners under `src/wayfinder/*/`, and facade services that preserve current public entrypoints.
