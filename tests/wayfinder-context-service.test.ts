import { describe, expect, it } from "vitest";
import type { PendingStep } from "../src/types";
import { buildWayfinderContext } from "../src/wayfinder/application/wayfinder-context-service";

describe("wayfinder context service", () => {
  it("builds summary rows, dossier text, and navigation state for the active step", async () => {
    const steps = [
      step("ancestry-level-1", "Ancestry"),
      step("class-level-1", "Class"),
      step("deity-level-1", "Deity"),
    ];

    const context = await buildWayfinderContext({
      actorName: "Kyra",
      currentLevel: 1,
      targetLevel: 2,
      steps,
      activeStep: steps[1] ?? null,
      activePane: { kind: "manual", title: "Class" } as never,
      statusNote: "Class changed.",
      recentlyInvalidatedStepIds: new Set(["deity-level-1"]),
      summaryDocuments: {
        ancestry: { name: "Human" },
        heritage: { name: "Half-Elf" },
        background: { name: "Scholar" },
        classDocument: { name: "Cleric" },
        deity: { name: "Sarenrae" },
      },
      isStepComplete: async (pendingStep) => pendingStep.id !== "deity-level-1",
      getStepStatus: async (pendingStep) => `${pendingStep.title} ready`,
    });

    expect(context.dossierLine).toBe("Human • Half-Elf • Scholar • Cleric • Sarenrae");
    expect(context.summary).toEqual([
      { label: "Ancestry", value: "Human", complete: true },
      { label: "Heritage", value: "Half-Elf", complete: true },
      { label: "Background", value: "Scholar", complete: true },
      { label: "Class", value: "Cleric", complete: true },
      { label: "Deity", value: "Sarenrae", complete: true },
    ]);
    expect(context.activeStepIndex).toBe(2);
    expect(context.completedCount).toBe(2);
    expect(context.canGoPrevious).toBe(true);
    expect(context.canGoNext).toBe(true);
    expect(context.steps).toEqual([
      expect.objectContaining({
        id: "ancestry-level-1",
        index: 1,
        active: false,
        complete: true,
        invalidated: false,
        firstInLevel: true,
      }),
      expect.objectContaining({
        id: "class-level-1",
        index: 2,
        active: true,
        complete: true,
        invalidated: false,
        firstInLevel: false,
      }),
      expect.objectContaining({
        id: "deity-level-1",
        index: 3,
        active: false,
        complete: false,
        invalidated: true,
        firstInLevel: false,
      }),
    ]);
  });

  it("falls back to missing labels and hides deity when it is not relevant", async () => {
    const steps = [step("class-level-1", "Class")];

    const context = await buildWayfinderContext({
      actorName: "Valeros",
      currentLevel: 1,
      targetLevel: 1,
      steps,
      activeStep: null,
      activePane: null,
      statusNote: null,
      recentlyInvalidatedStepIds: new Set<string>(),
      summaryDocuments: {
        ancestry: null,
        heritage: null,
        background: null,
        classDocument: null,
        deity: null,
      },
      isStepComplete: async () => false,
      getStepStatus: async () => "Missing",
    });

    expect(context.dossierLine).toBe("Creation path in progress");
    expect(context.summary).toEqual([
      { label: "Ancestry", value: "Missing", complete: false },
      { label: "Heritage", value: "Missing", complete: false },
      { label: "Background", value: "Missing", complete: false },
      { label: "Class", value: "Missing", complete: false },
    ]);
    expect(context.activeStepIndex).toBe(0);
    expect(context.canGoPrevious).toBe(false);
    expect(context.canGoNext).toBe(false);
    expect(context.hasPendingSteps).toBe(true);
    expect(context.canApplyDraft).toBe(true);
  });

  it("disables apply when there are no Wayfinder-guided steps", async () => {
    const context = await buildWayfinderContext({
      actorName: "Valeros",
      currentLevel: 1,
      targetLevel: 1,
      steps: [],
      activeStep: null,
      activePane: null,
      statusNote: null,
      recentlyInvalidatedStepIds: new Set<string>(),
      summaryDocuments: {
        ancestry: null,
        heritage: null,
        background: null,
        classDocument: null,
        deity: null,
      },
      isStepComplete: async () => false,
      getStepStatus: async () => "Missing",
    });

    expect(context.hasPendingSteps).toBe(false);
    expect(context.canApplyDraft).toBe(false);
  });
});

function step(id: string, title: string): PendingStep {
  return {
    id,
    level: 1,
    kind: "manual",
    slotKind: "class",
    title,
    description: "",
    required: true,
    slotId: id,
  };
}
