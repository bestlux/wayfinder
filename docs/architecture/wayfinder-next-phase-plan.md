# Wayfinder Next Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a stable extension seam for the rest of character creation work so new class-specific flows can be added without regrowing `app-shell.ts`, `rule-discovery.ts`, or other broad service blobs.

**Architecture:** Introduce a class-contributor registry that lets each class own its own planning/apply additions, add direct tests around the remaining class-discovery hotspot, harden the remaining high-value typed boundaries, and document the extension path so future feature work lands in the right seams by default.

**Tech Stack:** TypeScript 6, Vitest, ESLint, Biome, Foundry VTT 14.360, PF2E 8.0.3

---

## Scope Check

This phase stays in one subsystem family: extension readiness for guided character-creation growth. It deliberately does **not** include implementing a large new class feature set. That should be a follow-on feature plan once the contributor seam exists.

## Current State

- `src/actor-updater.ts` is small and orchestration-only.
- `src/wayfinder/spell-choice-service.ts` is a thin facade.
- `src/wayfinder/class-choice-service.ts` is much smaller, but `src/wayfinder/class-choice/rule-discovery.ts` is now the main policy hotspot.
- `src/wayfinder/app-shell.ts` is still 838 lines and should not regain rule-building work.
- The strict ratchet now covers the extracted `build-state`, `class-choice`, `existing-selection`, and `spell-choice` seams.
- The repo is structurally ready for feature growth, but it still lacks an explicit class-by-class contribution model.

## Why This Phase

Without a class-contributor seam, the next wave of feature work will still tend to land in one of three wrong places:

- `src/wayfinder/app-shell.ts`
- `src/wayfinder/class-choice/rule-discovery.ts`
- `src/wayfinder/spell-choice/*`

That is the next likely failure mode. The best investment now is not another generic cleanup. It is a narrow platform move that makes the correct extension path cheaper than the wrong one.

## File Structure

- Create: `src/wayfinder/classes/types.ts`
- Create: `src/wayfinder/classes/registry.ts`
- Create: `src/wayfinder/classes/base-contributor.ts`
- Create: `src/wayfinder/classes/wizard-contributor.ts`
- Create: `src/wayfinder/classes/cleric-contributor.ts`
- Modify: `src/wayfinder/application/wayfinder-plan-builder-service.ts`
- Modify: `src/wayfinder/class-choice-service.ts`
- Modify: `src/wayfinder/spell-choice-service.ts`
- Create: `tests/wayfinder-class-registry.test.ts`
- Create: `tests/wayfinder-class-contributors.test.ts`
- Create: `tests/wayfinder-class-rule-discovery.test.ts`
- Create: `docs/architecture/adding-a-class-flow.md`

## Design Guardrails

- New class-specific branching, granted-item, and spell-choice rules should enter through contributor modules, not directly through `app-shell.ts`.
- Shared rule discovery should stay class-agnostic. If a behavior is wizard-only or cleric-only, keep it out of the generic discovery module unless there is hard evidence two or more classes need the same rule shape.
- The contributor layer should compose existing seams; it should not bypass them.
- The first registry version should cover only existing wizard and cleric behavior plus a generic fallback. Do not try to future-proof every possible class mechanic in one pass.
- Prefer compile-time seams over runtime plugin complexity. This is an internal extension platform, not a public plugin API.

### Task 1: Introduce a Class Contributor Registry

**Files:**
- Create: `src/wayfinder/classes/types.ts`
- Create: `src/wayfinder/classes/registry.ts`
- Create: `src/wayfinder/classes/base-contributor.ts`
- Create: `src/wayfinder/classes/wizard-contributor.ts`
- Create: `src/wayfinder/classes/cleric-contributor.ts`
- Test: `tests/wayfinder-class-registry.test.ts`
- Test: `tests/wayfinder-class-contributors.test.ts`

- [ ] **Step 1: Add a failing registry test**

Create `tests/wayfinder-class-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getClassContributor } from "../src/wayfinder/classes/registry";

describe("wayfinder class registry", () => {
  it("returns the wizard contributor for wizard class slugs and the base contributor for unknown classes", () => {
    expect(getClassContributor("wizard").slug).toBe("wizard");
    expect(getClassContributor("inventor").slug).toBe("base");
  });
});
```

- [ ] **Step 2: Define the contributor contract**

Create `src/wayfinder/classes/types.ts`:

```ts
import type { DraftState, PendingStep } from "../../types.js";

export interface BuildClassContributionDependencies {
  buildClassBranchSteps: (args: unknown) => Promise<PendingStep[]>;
  buildClassGrantedItemSteps: (args: unknown) => Promise<PendingStep[]>;
  buildClassChoiceSteps: (args: unknown) => Promise<PendingStep[]>;
  buildSpellChoiceSteps: (args: unknown) => Promise<PendingStep[]>;
}

export interface BuildClassContributionArgs {
  draft: DraftState;
  currentLevel: number;
  targetLevel: number;
  effectiveClassDocument: unknown | null;
  effectiveDeityDocument: unknown | null;
  effectiveSchoolDocument: unknown | null;
  deps: BuildClassContributionDependencies;
}

export interface ClassContributor {
  slug: string;
  buildPlanSteps(args: BuildClassContributionArgs): Promise<PendingStep[]>;
}
```

- [ ] **Step 3: Add a base contributor and registry**

Create `src/wayfinder/classes/base-contributor.ts`:

```ts
import type { ClassContributor } from "./types.js";

export const baseContributor: ClassContributor = {
  slug: "base",
  async buildPlanSteps() {
    return [];
  },
};
```

Create `src/wayfinder/classes/registry.ts`:

```ts
import { baseContributor } from "./base-contributor.js";
import { clericContributor } from "./cleric-contributor.js";
import { wizardContributor } from "./wizard-contributor.js";
import type { ClassContributor } from "./types.js";

const CONTRIBUTORS: Record<string, ClassContributor> = {
  wizard: wizardContributor,
  cleric: clericContributor,
};

export function getClassContributor(classSlug: string | null): ClassContributor {
  if (!classSlug) {
    return baseContributor;
  }

  return CONTRIBUTORS[classSlug] ?? baseContributor;
}
```

- [ ] **Step 4: Add wizard and cleric contributors that wrap existing seams**

Create `src/wayfinder/classes/wizard-contributor.ts` and `src/wayfinder/classes/cleric-contributor.ts` with the smallest wrapper possible:

```ts
import type { ClassContributor } from "./types.js";

export const wizardContributor: ClassContributor = {
  slug: "wizard",
  async buildPlanSteps() {
    return [];
  },
};
```

```ts
import type { ClassContributor } from "./types.js";

export const clericContributor: ClassContributor = {
  slug: "cleric",
  async buildPlanSteps() {
    return [];
  },
};
```

The point in this task is the seam, not the feature migration yet.

- [ ] **Step 5: Add a contributor behavior test**

Create `tests/wayfinder-class-contributors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { wizardContributor } from "../src/wayfinder/classes/wizard-contributor";

describe("wayfinder class contributors", () => {
  it("keeps contributors as narrow wrappers with stable slugs", async () => {
    const draft = createEmptyDraft(1);

    expect(wizardContributor.slug).toBe("wizard");
    await expect(
      wizardContributor.buildPlanSteps({
        draft,
        currentLevel: 1,
        targetLevel: 1,
        effectiveClassDocument: null,
        effectiveDeityDocument: null,
        effectiveSchoolDocument: null,
        deps: {
          buildClassBranchSteps: async () => [],
          buildClassGrantedItemSteps: async () => [],
          buildClassChoiceSteps: async () => [],
          buildSpellChoiceSteps: async () => [],
        },
      })
    ).resolves.toEqual([]);
  });
});
```

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- tests/wayfinder-class-registry.test.ts tests/wayfinder-class-contributors.test.ts`
Expected: PASS

Run: `npm run check`
Expected: PASS

Commit:

```bash
git add src/wayfinder/classes tests/wayfinder-class-registry.test.ts tests/wayfinder-class-contributors.test.ts
git commit -m "feat: add wayfinder class contributor registry"
```

### Task 2: Route Existing Wizard And Cleric Behavior Through Contributors

**Files:**
- Modify: `src/wayfinder/application/wayfinder-plan-builder-service.ts`
- Modify: `src/wayfinder/class-choice-service.ts`
- Modify: `src/wayfinder/spell-choice-service.ts`
- Modify: `src/wayfinder/classes/wizard-contributor.ts`
- Modify: `src/wayfinder/classes/cleric-contributor.ts`
- Test: `tests/wayfinder-class-contributors.test.ts`
- Test: `tests/wayfinder-plan-builder-service.test.ts`

- [ ] **Step 1: Add a failing integration-level contributor test**

Extend `tests/wayfinder-class-contributors.test.ts`:

```ts
it("routes wizard-specific spell-choice steps through the wizard contributor", async () => {
  const wizardDocument = {
    system: {
      slug: "wizard",
      items: {
        spellcasting: {
          name: "Wizard Spellcasting",
          uuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
        },
      },
    },
  };
  const schoolDocument = {
    name: "School of Battle Magic",
    system: {
      slug: "school-of-battle-magic",
      description: {
        value: "<ul><li><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.force-barrage]</li></ul>",
      },
    },
  };
  const steps = await wizardContributor.buildPlanSteps({
    draft: createEmptyDraft(1),
    currentLevel: 1,
    targetLevel: 1,
    effectiveClassDocument: wizardDocument,
    effectiveDeityDocument: null,
    effectiveSchoolDocument: schoolDocument,
    deps: {
      buildClassBranchSteps: async () => [],
      buildClassGrantedItemSteps: async () => [],
      buildClassChoiceSteps: async () => [],
      buildSpellChoiceSteps: async (args) =>
        args.effectiveClassDocument ? [{ slotId: "spell-choice-wizard-spellbook-cantrips-level-1" }] : [],
    },
  });

  expect(steps.map((step) => step.slotId)).toContain("spell-choice-wizard-spellbook-cantrips-level-1");
});
```

- [ ] **Step 2: Use the dependency shape from Task 1**

Keep the contributor seam compile-time explicit by using the `BuildClassContributionDependencies` contract from Task 1 instead of ad hoc callback objects.

- [ ] **Step 3: Implement wizard and cleric contributor composition**

Update `wizard-contributor.ts` and `cleric-contributor.ts` so they delegate to the already-extracted builders:

```ts
export const wizardContributor: ClassContributor = {
  slug: "wizard",
  async buildPlanSteps(args) {
    return args.deps.buildSpellChoiceSteps({
      draft: args.draft,
      currentLevel: args.currentLevel,
      effectiveClassDocument: args.effectiveClassDocument,
      effectiveDeityDocument: args.effectiveDeityDocument,
      effectiveSchoolDocument: args.effectiveSchoolDocument,
      targetLevel: args.targetLevel,
    });
  },
};
```

- [ ] **Step 4: Make the plan builder resolve contributors**

Modify `src/wayfinder/application/wayfinder-plan-builder-service.ts` so it resolves a contributor by class slug and asks it for class-specific steps rather than deciding those seams inline:

```ts
const contributor = getClassContributor(extractDocumentSlug(await args.resolveDocument("class")));
const contributedSteps = await contributor.buildPlanSteps({
  draft: args.draft,
  currentLevel: args.snapshot.level,
  targetLevel: args.draft.targetLevel,
  effectiveClassDocument: await args.resolveDocument("class"),
  effectiveDeityDocument: await args.resolveDocument("deity"),
  effectiveSchoolDocument: await args.resolveArcaneSchoolDocument(),
  deps,
});
```

- [ ] **Step 5: Keep service facades intact**

Do not delete the current public exports from `class-choice-service.ts` or `spell-choice-service.ts`. They should remain the internal engines contributors call into, not a compatibility casualty.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- tests/wayfinder-class-contributors.test.ts tests/wayfinder-plan-builder-service.test.ts`
Expected: PASS

Run: `npm run check`
Expected: PASS

Commit:

```bash
git add src/wayfinder/application/wayfinder-plan-builder-service.ts src/wayfinder/classes src/wayfinder/class-choice-service.ts src/wayfinder/spell-choice-service.ts tests/wayfinder-class-contributors.test.ts tests/wayfinder-plan-builder-service.test.ts
git commit -m "refactor: route class-specific steps through contributors"
```

### Task 3: Add Direct Rule-Discovery Tests Before More Class Growth

**Files:**
- Create: `tests/wayfinder-class-rule-discovery.test.ts`
- Modify: `src/wayfinder/class-choice/rule-discovery.ts` only if test-driven fixes are needed

- [ ] **Step 1: Add failing discovery-level tests**

Create `tests/wayfinder-class-rule-discovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  discoverClassBranchMeta,
  discoverClassChoiceMeta,
  discoverGrantedItemMeta,
  discoverSkillTrainingMeta,
} from "../src/wayfinder/class-choice/rule-discovery";

const extractSlug = (document: { system?: { slug?: string } } | null | undefined) => document?.system?.slug ?? null;
const selectorSelection = {
  slotId: "class-feature-level-1",
  packId: "pf2e.classfeatures",
  documentId: "selector-document",
  uuid: "Compendium.pf2e.classfeatures.Item.selector-document",
  itemType: "feat",
  featType: null,
  name: "Selector",
  level: 1,
};
const deitySelectorDocument = {
  type: "feat",
  name: "Deity",
  system: {
    category: "classfeature",
    level: { value: 1 },
    rules: [
      { key: "ChoiceSet", flag: "deity", choices: { itemType: "deity" } },
      { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.deity}" },
    ],
  },
};
const sanctificationDocument = {
  type: "feat",
  name: "Sanctification",
  system: {
    category: "classfeature",
    level: { value: 1 },
    rules: [
      {
        key: "ChoiceSet",
        flag: "sanctification",
        choices: [
          { value: "holy", label: "Holy", predicate: "deity:primary:sanctification:can:holy" },
          { value: "unholy", label: "Unholy", predicate: "deity:primary:sanctification:can:unholy" },
        ],
      },
    ],
  },
};
const rogueClassDocument = {
  name: "Rogue",
  system: {
    slug: "rogue",
    trainedSkills: {
      additional: 2,
      value: ["athletics"],
    },
    rules: [
      {
        key: "ChoiceSet",
        flag: "classSkill",
        prompt: "Choose a class skill",
        choices: [
          { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
          { value: "stealth", label: "PF2E.Skill.Stealth" },
        ],
      },
    ],
  },
};

describe("wayfinder class rule discovery", () => {
  it("discovers branch metadata from selector-style class features", () => {
    const branchMeta = discoverClassBranchMeta({
      selectorDocument: {
        type: "feat",
        name: "Rogue's Racket",
        system: {
          category: "classfeature",
          level: { value: 1 },
          rules: [
            { key: "ChoiceSet", flag: "roguesRacket", choices: { filter: ["item:tag:rogue-racket"] } },
            { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.roguesRacket}" },
          ],
        },
      },
      selectorSelection,
      classSlug: "rogue",
      extractSlug,
    });

    expect(branchMeta?.flag).toBe("roguesRacket");
  });

  it("discovers deity grants only when a matching grant rule exists", () => {
    const grantMeta = discoverGrantedItemMeta({
      selectorDocument: deitySelectorDocument,
      selectorSelection,
      classSlug: "cleric",
    });

    expect(grantMeta?.itemType).toBe("deity");
  });

  it("filters class-choice options by roll options", () => {
    const choiceMeta = discoverClassChoiceMeta({
      sourceDocument: sanctificationDocument,
      sourceSelection: selectorSelection,
      classSlug: "cleric",
      extractSlug,
      localize: (value) => value,
      rollOptions: new Set(["deity:primary:sanctification:can:holy"]),
    });

    expect(choiceMeta[0]?.options.map((option) => option.value)).toEqual(["holy"]);
  });

  it("extracts skill training metadata without actor reads", () => {
    const trainingMeta = discoverSkillTrainingMeta({
      classDocument: rogueClassDocument,
      extractSlug,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(trainingMeta?.additionalCount).toBe(2);
  });
});
```

- [ ] **Step 2: Fix only real discovery defects**

If these tests reveal real discovery bugs, patch `src/wayfinder/class-choice/rule-discovery.ts` minimally. Do not refactor it broadly in this task.

- [ ] **Step 3: Run focused tests and commit**

Run: `npm test -- tests/wayfinder-class-rule-discovery.test.ts tests/wayfinder-class-choice-step-builders.test.ts`
Expected: PASS

Run: `npm run check`
Expected: PASS

Commit:

```bash
git add src/wayfinder/class-choice/rule-discovery.ts tests/wayfinder-class-rule-discovery.test.ts
git commit -m "test: add direct coverage for class rule discovery"
```

### Task 4: Tighten The Last High-Value Typed Boundaries

**Files:**
- Modify: `src/selector-application.ts`
- Modify: `src/pack-service.ts`
- Modify: `src/wayfinder/app-shell.ts`
- Test: existing focused suites only

- [ ] **Step 1: Add a narrow typed-boundary checklist**

Before editing, confirm the target is one of these:

```ts
// acceptable fixes for this task
- replace `any` with local adapter types
- narrow return types for shared helpers
- add explicit null/id guards where extracted seams now expect them
```

- [ ] **Step 2: Tighten `selector-application.ts` around selector/grant item shapes**

Aim for small local interfaces like:

```ts
interface SelectorItemLike {
  id?: string;
  flags?: {
    pf2e?: {
      grantedBy?: { id?: string };
    };
  };
}
```

- [ ] **Step 3: Tighten `pack-service.ts` around fetched document/query shapes**

Add minimal document/query result types and remove the worst `any`-driven branches. Do not redesign the whole service.

- [ ] **Step 4: Trim the highest-value `app-shell.ts` edge `any`s only**

Target only real seam edges, such as actor app lookup or document resolution returns. Do not reopen shell orchestration structure in this task.

- [ ] **Step 5: Run strict checks and commit**

Run: `npm run check:strict`
Expected: PASS

Run: `npm run check`
Expected: PASS

Commit:

```bash
git add src/selector-application.ts src/pack-service.ts src/wayfinder/app-shell.ts
git commit -m "refactor: tighten remaining Wayfinder typed boundaries"
```

### Task 5: Write The Extension Guide For Future Feature Work

**Files:**
- Create: `docs/architecture/adding-a-class-flow.md`
- Modify: `README.md`

- [ ] **Step 1: Write the extension guide**

Create `docs/architecture/adding-a-class-flow.md` with sections:

```md
# Adding A Class Flow

## When To Add A Contributor
## Where Branch Rules Belong
## Where Spell-Choice Rules Belong
## Where Actor-Apply Rules Belong
## Required Tests For A New Class Flow
## Common Failure Modes
```

- [ ] **Step 2: Add one README pointer**

Add one short pointer under the architecture section:

```md
- For new class-specific flows, see `docs/architecture/adding-a-class-flow.md`.
```

- [ ] **Step 3: Run docs sanity check and commit**

Run: `rg -n "Adding A Class Flow|class contributor|new class-specific flows" README.md docs/architecture/adding-a-class-flow.md`
Expected: matches in both files

Commit:

```bash
git add README.md docs/architecture/adding-a-class-flow.md
git commit -m "docs: add wayfinder class flow extension guide"
```

## Out Of Scope

- Implementing a large new class feature set
- Redesigning Foundry integration boundaries from scratch
- Reworking `app-shell.ts` into a completely different UI model
- Public plugin architecture for external modules

## Follow-On Plan Candidates

After this phase, the best follow-on plans are feature-specific, not structural:

- champion cause / sanctification flow
- barbarian instinct or druid order flow
- fuller deity/class synergy flows
- level-up milestone flows beyond the current vertical slice

## Self-Review

- Spec coverage: this plan covers the highest-value post-merge work: contributor seam, direct discovery tests, remaining type-boundary hardening, and extension guidance.
- Placeholder scan: no `TBD`, `TODO`, or “similar to Task N” placeholders remain.
- Type consistency: the plan uses one stable idea throughout: contributors own class-specific composition, existing services remain engines/facades, and direct discovery tests protect the largest remaining generic hotspot.
