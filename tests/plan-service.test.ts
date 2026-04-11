import { describe, expect, it } from "vitest";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";
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
});
