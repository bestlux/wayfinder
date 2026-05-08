import { describe, expect, it, vi } from "vitest";
import { DRAFT_FLAG, STATE_FLAG } from "../src/constants";
import { createEmptyDraft, createEmptyState } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import {
  applyDraftLifecycle,
  buildSaveDraftUpdate,
  createClearedDraftResult,
} from "../src/wayfinder/application/draft-lifecycle-service";

describe("wayfinder draft lifecycle service", () => {
  it("refuses to apply when any planned step is incomplete", async () => {
    const draft = createEmptyDraft(3);
    const confirmApply = vi.fn(() => true);
    const applyDraftToActor = vi.fn(async () => undefined);
    const updateActor = vi.fn(async () => undefined);
    const steps = [step("ancestry-level-1"), step("class-level-1")];

    const result = await applyDraftLifecycle({
      actorName: "Merisiel",
      currentLevel: 2,
      draft,
      steps,
      isStepComplete: async (pendingStep) => pendingStep.id !== "class-level-1",
      confirmApply,
      applyDraftToActor,
      updateActor,
    });

    expect(result).toEqual({
      kind: "warning",
      warning: "missing-selections",
    });
    expect(confirmApply).not.toHaveBeenCalled();
    expect(applyDraftToActor).not.toHaveBeenCalled();
    expect(updateActor).not.toHaveBeenCalled();
  });

  it("cancels the apply flow when confirmation is declined", async () => {
    const draft = createEmptyDraft(4);
    const confirmApply = vi.fn(() => false);
    const applyDraftToActor = vi.fn(async () => undefined);
    const updateActor = vi.fn(async () => undefined);
    const steps = [step("ancestry-level-1"), step("class-level-1")];

    const result = await applyDraftLifecycle({
      actorName: "Valeros",
      currentLevel: 3,
      draft,
      steps,
      isStepComplete: async () => true,
      confirmApply,
      applyDraftToActor,
      updateActor,
    });

    expect(result).toEqual({
      kind: "cancelled",
    });
    expect(confirmApply).toHaveBeenCalledWith("Apply 2 Wayfinder step(s) to Valeros?");
    expect(applyDraftToActor).not.toHaveBeenCalled();
    expect(updateActor).not.toHaveBeenCalled();
  });

  it("applies the draft, persists completion state, and returns a reset draft", async () => {
    const draft = createEmptyDraft(5);
    const confirmApply = vi.fn(() => true);
    const order: string[] = [];
    const applyDraftToActor = vi.fn(async () => {
      order.push("apply");
      return {
        "system.build": {
          attributes: {
            boosts: {
              1: ["dex", "con", "int", "wis"],
            },
          },
        },
      };
    });
    const updateActor = vi.fn(async (update: Record<string, unknown>) => {
      order.push("update");
      expect(update).toEqual({
        "system.build": {
          attributes: {
            boosts: {
              1: ["dex", "con", "int", "wis"],
            },
          },
        },
        [DRAFT_FLAG]: null,
        [STATE_FLAG]: {
          ...createEmptyState(),
          lastAppliedAt: "2026-04-19T21:30:00.000Z",
          lastTargetLevel: 5,
          completedStepIds: ["ancestry-level-1", "class-level-1"],
        },
      });
    });
    const steps = [step("ancestry-level-1"), step("class-level-1")];

    const result = await applyDraftLifecycle({
      actorName: "Kyra",
      currentLevel: 1,
      draft,
      steps,
      isStepComplete: async () => true,
      confirmApply,
      applyDraftToActor,
      updateActor,
      now: () => "2026-04-19T21:30:00.000Z",
    });

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") {
      throw new Error("expected applied result");
    }
    expect(confirmApply).toHaveBeenCalledWith("Apply 2 Wayfinder step(s) to Kyra?");
    expect(order).toEqual(["apply", "update"]);
    expect(result.nextDraft.targetLevel).toBe(1);
    expect(result.nextDraft.selections).toEqual({});
    expect(result.nextDraft.classChoices).toEqual({});
  });

  it("builds the persisted draft patch and cleared draft state", () => {
    const draft = createEmptyDraft(6);
    draft.manual["manual-level-1"] = true;

    expect(buildSaveDraftUpdate(draft)).toMatchObject({
      [DRAFT_FLAG]: expect.objectContaining({
        targetLevel: 6,
        manual: { "manual-level-1": true },
      }),
    });

    expect(createClearedDraftResult(2)).toEqual({
      nextDraft: expect.objectContaining({
        targetLevel: 2,
      }),
      actorUpdate: {
        [DRAFT_FLAG]: null,
      },
    });
  });
});

function step(id: string): PendingStep {
  return {
    id,
    level: 1,
    kind: "manual",
    slotKind: "class",
    title: id,
    description: "",
    required: true,
    slotId: id,
  };
}
