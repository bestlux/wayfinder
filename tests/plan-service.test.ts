import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import { sortPendingSteps } from "../src/progression";
import type { PendingStep } from "../src/types";
import { createClassBranchStep, createClassChoiceStep } from "../src/wayfinder/domain/step-types";
import { getWayfinderStepStatus, modeLabel, resolveActiveStep } from "../src/wayfinder/plan-service";

describe("wayfinder plan service", () => {
  it("falls back to the first incomplete step when no active step is pinned", async () => {
    const steps: PendingStep[] = [
      {
        id: "ancestry-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "ancestry",
        title: "Ancestry",
        description: "",
        required: true,
        slotId: "ancestry-level-1",
        filters: { itemType: "ancestry" },
      },
      {
        id: "heritage-level-1",
        level: 1,
        kind: "pick-item",
        slotKind: "heritage",
        title: "Heritage",
        description: "",
        required: true,
        slotId: "heritage-level-1",
        filters: { itemType: "heritage" },
      },
    ];

    const resolved = await resolveActiveStep(steps, null, async (step) => step.slotId === "ancestry-level-1");
    expect(resolved.activeStepId).toBe("heritage-level-1");
  });

  it("reports invalidated pick steps as needing attention", async () => {
    const step: PendingStep = {
      id: "heritage-level-1",
      level: 1,
      kind: "pick-item",
      slotKind: "heritage",
      title: "Heritage",
      description: "",
      required: true,
      slotId: "heritage-level-1",
      filters: { itemType: "heritage" },
    };

    const status = await getWayfinderStepStatus(
      step,
      createEmptyDraft(1),
      new Set(["heritage-level-1"]),
      {} as EffectiveBuildState,
      {
        isTrainingStepComplete: () => false,
      }
    );

    expect(status).toBe("Needs attention");
    expect(modeLabel("class-branch")).toBe("Class Path");
  });

  it("orders class choices before dependent class branches at the same level", () => {
    const steps = sortPendingSteps([
      createClassBranchStep(
        1,
        {
          slotId: "class-branch-cause-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "cause",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.cause",
          selectorName: "Cause",
          selectorRuleIndex: 0,
          flag: "cause",
          optionTag: "champion-cause",
          classSlug: "champion",
          dependsOn: "deity",
        },
        {
          title: "Cause",
          description: "",
        }
      ),
      createClassChoiceStep(1, {
        slotId: "class-choice-deity-champion-sanctification-level-1",
        sourcePackId: "pf2e.classfeatures",
        sourceDocumentId: "deity-champion",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.deity-champion",
        sourceName: "Deity (Champion)",
        sourceRuleIndex: 2,
        flag: "sanctification",
        classSlug: "champion",
        dependsOn: "deity",
        options: [
          { value: "holy", label: "Holy", img: null, detail: null },
          { value: "unholy", label: "Unholy", img: null, detail: null },
          { value: "none", label: "None", img: null, detail: null },
        ],
      }),
    ]);

    expect(steps.map((step) => step.slotId)).toEqual([
      "class-choice-deity-champion-sanctification-level-1",
      "class-branch-cause-level-1",
    ]);
  });
});
