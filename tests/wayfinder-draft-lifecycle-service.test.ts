import { describe, expect, it, vi } from "vitest";
import { DRAFT_FLAG, STATE_FLAG } from "../src/constants";
import { createEmptyDraft, createEmptyState } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import {
  applyDraftLifecycle,
  type BuildApplyFinalActorUpdate,
  buildClearDraftConfirmationMessage,
  buildSaveDraftUpdate,
  clearDraftLifecycle,
  countDraftLosses,
  createClearedDraftResult,
} from "../src/wayfinder/application/draft-lifecycle-service";
import type { WayfinderStepEvaluation } from "../src/wayfinder/domain/step-evaluation";

describe("wayfinder draft lifecycle service", () => {
  it("refuses to apply when any planned step is incomplete", async () => {
    const draft = createEmptyDraft(3);
    const confirmApply = vi.fn(() => true);
    const applyDraftToActor = vi.fn(async () => undefined);
    const steps = [step("ancestry-level-1"), step("class-level-1")];

    const result = await applyDraftLifecycle({
      actorName: "Merisiel",
      currentLevel: 2,
      draft,
      steps,
      evaluateStep: async (pendingStep) =>
        pendingStep.id === "class-level-1" ? blockedEvaluation(pendingStep) : readyEvaluation(),
      confirmApply,
      applyDraftToActor,
    });

    expect(result).toEqual({
      kind: "warning",
      warning: "draft-not-ready",
      blockers: [
        expect.objectContaining({
          code: "missing-choice",
          stepId: "class-level-1",
        }),
      ],
    });
    expect(confirmApply).not.toHaveBeenCalled();
    expect(applyDraftToActor).not.toHaveBeenCalled();
  });

  it("refuses to apply when there are no Wayfinder-guided steps", async () => {
    const draft = createEmptyDraft(1);
    const confirmApply = vi.fn(() => true);
    const applyDraftToActor = vi.fn(async () => undefined);

    const result = await applyDraftLifecycle({
      actorName: "Kyra",
      currentLevel: 1,
      draft,
      steps: [],
      evaluateStep: async () => readyEvaluation(),
      confirmApply,
      applyDraftToActor,
    });

    expect(result).toEqual({
      kind: "warning",
      warning: "no-pending-steps",
      blockers: [],
    });
    expect(confirmApply).not.toHaveBeenCalled();
    expect(applyDraftToActor).not.toHaveBeenCalled();
  });

  it("cancels the apply flow when confirmation is declined", async () => {
    const draft = createEmptyDraft(4);
    const confirmApply = vi.fn(() => false);
    const applyDraftToActor = vi.fn(async () => undefined);
    const steps = [step("ancestry-level-1"), step("class-level-1")];

    const result = await applyDraftLifecycle({
      actorName: "Valeros",
      currentLevel: 3,
      draft,
      steps,
      evaluateStep: async () => readyEvaluation(),
      confirmApply,
      applyDraftToActor,
    });

    expect(result).toEqual({
      kind: "cancelled",
    });
    expect(confirmApply).toHaveBeenCalledWith("Apply 2 Wayfinder step(s) to Valeros?");
    expect(applyDraftToActor).not.toHaveBeenCalled();
  });

  it("applies the draft, persists completion state, and returns a reset draft", async () => {
    const draft = createEmptyDraft(5);
    const existingCharacterHistory = {
      version: 1 as const,
      importedAt: "2026-07-26T18:00:00.000Z",
      actorLevel: 5,
      entries: [],
    };
    const confirmApply = vi.fn(() => true);
    const order: string[] = [];
    const applyDraftToActor = vi.fn(async (buildFinalActorUpdate: BuildApplyFinalActorUpdate) => {
      order.push("apply");
      const update = buildFinalActorUpdate();
      expect(update).toEqual({
        [DRAFT_FLAG]: null,
        [STATE_FLAG]: {
          ...createEmptyState(),
          lastAppliedAt: "2026-04-19T21:30:00.000Z",
          lastTargetLevel: 5,
          completedStepIds: ["ancestry-level-1", "class-level-1"],
          existingCharacterHistory,
        },
      });
    });
    const steps = [step("ancestry-level-1"), step("class-level-1")];

    const result = await applyDraftLifecycle({
      actorName: "Kyra",
      currentLevel: 1,
      draft,
      existingCharacterHistory,
      steps,
      evaluateStep: async () => readyEvaluation(),
      confirmApply,
      applyDraftToActor,
      now: () => "2026-04-19T21:30:00.000Z",
    });

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") {
      throw new Error("expected applied result");
    }
    expect(confirmApply).toHaveBeenCalledWith("Apply 2 Wayfinder step(s) to Kyra?");
    expect(order).toEqual(["apply"]);
    expect(result.nextDraft.targetLevel).toBe(1);
    expect(result.nextDraft.selections).toEqual({});
    expect(result.nextDraft.classChoices).toEqual({});
  });

  it("waits for asynchronous apply confirmation before mutating the actor", async () => {
    const draft = createEmptyDraft(2);
    const order: string[] = [];
    const confirmApply = vi.fn(async () => {
      order.push("confirm");
      return true;
    });
    const applyDraftToActor = vi.fn(async () => {
      order.push("apply");
    });

    const result = await applyDraftLifecycle({
      actorName: "Ezren",
      currentLevel: 1,
      draft,
      steps: [step("ancestry-level-1")],
      evaluateStep: async () => readyEvaluation(),
      confirmApply,
      applyDraftToActor,
    });

    expect(result.kind).toBe("applied");
    expect(confirmApply).toHaveBeenCalledWith("Apply 1 Wayfinder step(s) to Ezren?");
    expect(order).toEqual(["confirm", "apply"]);
  });

  it("flushes the confirmed candidate before applying it", async () => {
    const order: string[] = [];
    const result = await applyDraftLifecycle({
      actorName: "Ezren",
      currentLevel: 1,
      draft: createEmptyDraft(2),
      steps: [step("ancestry-level-1")],
      evaluateStep: async () => readyEvaluation(),
      confirmApply: async () => {
        order.push("confirm");
        return true;
      },
      beforeApply: async () => {
        order.push("flush");
      },
      applyDraftToActor: async () => {
        order.push("apply");
      },
    });

    expect(result.kind).toBe("applied");
    expect(order).toEqual(["confirm", "flush", "apply"]);
  });

  it("does not flush an invalid or cancelled candidate", async () => {
    const beforeApply = vi.fn(async () => undefined);
    const applyDraftToActor = vi.fn(async () => undefined);
    const draft = createEmptyDraft(2);

    await applyDraftLifecycle({
      actorName: "Ezren",
      currentLevel: 1,
      draft,
      steps: [step("ancestry-level-1")],
      evaluateStep: async (pendingStep) => blockedEvaluation(pendingStep),
      confirmApply: () => true,
      beforeApply,
      applyDraftToActor,
    });
    await applyDraftLifecycle({
      actorName: "Ezren",
      currentLevel: 1,
      draft,
      steps: [step("ancestry-level-1")],
      evaluateStep: async () => readyEvaluation(),
      confirmApply: () => false,
      beforeApply,
      applyDraftToActor,
    });

    expect(beforeApply).not.toHaveBeenCalled();
    expect(applyDraftToActor).not.toHaveBeenCalled();
  });

  it("does not apply when the confirmed candidate cannot be flushed", async () => {
    const applyDraftToActor = vi.fn(async () => undefined);
    await expect(
      applyDraftLifecycle({
        actorName: "Ezren",
        currentLevel: 1,
        draft: createEmptyDraft(2),
        steps: [step("ancestry-level-1")],
        evaluateStep: async () => readyEvaluation(),
        confirmApply: () => true,
        beforeApply: async () => {
          throw new Error("save failed");
        },
        applyDraftToActor,
      })
    ).rejects.toThrow("save failed");
    expect(applyDraftToActor).not.toHaveBeenCalled();
  });

  it("does not clear the saved draft when actor application fails", async () => {
    const draft = createEmptyDraft(2);
    draft.manual["ancestry-level-1"] = true;

    await expect(
      applyDraftLifecycle({
        actorName: "Ezren",
        currentLevel: 1,
        draft,
        steps: [step("ancestry-level-1")],
        evaluateStep: async () => readyEvaluation(),
        confirmApply: () => true,
        applyDraftToActor: async () => {
          throw new Error("injected phase failure");
        },
      })
    ).rejects.toThrow("injected phase failure");

    expect(draft.manual["ancestry-level-1"]).toBe(true);
  });

  it("preserves previously completed step ids during incremental applies", async () => {
    const draft = createEmptyDraft(5);
    let buildFinalActorUpdate: BuildApplyFinalActorUpdate | null = null;

    await applyDraftLifecycle({
      actorName: "Seelah",
      currentLevel: 1,
      draft,
      existingCompletedStepIds: ["ancestry-level-1", "class-level-1"],
      steps: [step("class-feat-level-2"), step("class-feat-level-2")],
      evaluateStep: async () => readyEvaluation(),
      confirmApply: () => true,
      applyDraftToActor: async (buildUpdate) => {
        buildFinalActorUpdate = buildUpdate;
      },
      now: () => "2026-04-19T21:30:00.000Z",
    });

    expect(buildFinalActorUpdate?.()).toEqual(
      expect.objectContaining({
        [STATE_FLAG]: expect.objectContaining({
          completedStepIds: ["ancestry-level-1", "class-level-1", "class-feat-level-2"],
        }),
      })
    );
  });

  it("merges completion and history from the state read inside the actor transaction", async () => {
    const latestHistory = {
      version: 1 as const,
      importedAt: "2026-08-15T04:00:00.000Z",
      actorLevel: 3,
      entries: [],
    };
    let buildFinalActorUpdate: BuildApplyFinalActorUpdate | null = null;

    await applyDraftLifecycle({
      actorName: "Seelah",
      currentLevel: 1,
      draft: createEmptyDraft(3),
      existingCompletedStepIds: ["ancestry-level-1"],
      steps: [step("class-feat-level-2")],
      evaluateStep: async () => readyEvaluation(),
      confirmApply: () => true,
      applyDraftToActor: async (buildUpdate) => {
        buildFinalActorUpdate = buildUpdate;
      },
      now: () => "2026-08-15T04:30:00.000Z",
    });

    const update = buildFinalActorUpdate?.({
      completedStepIds: ["ancestry-level-1", "class-level-1"],
      existingCharacterHistory: latestHistory,
    });
    expect(update).toEqual(
      expect.objectContaining({
        [STATE_FLAG]: expect.objectContaining({
          completedStepIds: ["ancestry-level-1", "class-level-1", "class-feat-level-2"],
          existingCharacterHistory: latestHistory,
        }),
      })
    );

    const clearedHistoryUpdate = buildFinalActorUpdate?.({
      completedStepIds: ["ancestry-level-1", "class-level-1"],
      existingCharacterHistory: null,
    });
    expect(clearedHistoryUpdate).toEqual(
      expect.objectContaining({
        [STATE_FLAG]: expect.objectContaining({ existingCharacterHistory: null }),
      })
    );
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

  it("cancels Clear without touching persistence and describes discarded choices", async () => {
    const draft = createEmptyDraft(3);
    draft.manual.one = true;
    draft.spellRarityAccess.spells = true;
    draft.boosts.levels[1] = ["str", "dex"];
    const confirmClear = vi.fn(() => false);
    const clearPersistedDraft = vi.fn(async () => undefined);

    const result = await clearDraftLifecycle({
      currentLevel: 1,
      draft,
      confirmClear,
      clearPersistedDraft,
    });

    expect(result).toEqual({ kind: "cancelled" });
    expect(confirmClear).toHaveBeenCalledWith("Clear 5 drafted decisions? This cannot be undone.");
    expect(clearPersistedDraft).not.toHaveBeenCalled();
  });

  it("returns a replacement draft only after Clear persistence succeeds", async () => {
    const draft = createEmptyDraft(2);
    draft.manual.one = true;
    const order: string[] = [];
    const result = await clearDraftLifecycle({
      currentLevel: 1,
      draft,
      confirmClear: async () => {
        order.push("confirm");
        return true;
      },
      clearPersistedDraft: async () => {
        order.push("clear");
      },
    });

    expect(order).toEqual(["confirm", "clear"]);
    expect(result).toMatchObject({
      kind: "cleared",
      discardedDecisionCount: 2,
      nextDraft: { targetLevel: 1, manual: {} },
    });
  });

  it("does not manufacture a replacement when Clear persistence fails", async () => {
    const draft = createEmptyDraft(1);
    draft.manual.one = true;
    await expect(
      clearDraftLifecycle({
        currentLevel: 1,
        draft,
        confirmClear: () => true,
        clearPersistedDraft: async () => {
          throw new Error("clear failed");
        },
      })
    ).rejects.toThrow("clear failed");
    expect(draft.manual.one).toBe(true);
  });

  it("counts all current draft loss surfaces", () => {
    const draft = createEmptyDraft(2);
    draft.selections.ancestry = {
      slotId: "ancestry",
      packId: "pf2e.ancestries",
      documentId: "human",
      uuid: "Compendium.pf2e.ancestries.Item.human",
      itemType: "ancestry",
      featType: null,
      name: "Human",
      level: 1,
    };
    draft.skillTrainings.training = {
      ruleChoices: { skill: "arcana" },
      additional: ["society"],
      loreChoices: { lore: "Library Lore" },
    };
    draft.languageChoices.languages = ["draconic"];
    draft.spellRarityAccess.spells = true;
    draft.boosts.ancestry.modeTouched = true;
    draft.boosts.ancestry.voluntary.touched = true;
    draft.boosts.ancestry.voluntary.flaws = ["str"];
    draft.boosts.background.selectedBoosts.background = "wis";
    draft.boosts.class.keyAbility = "int";

    expect(countDraftLosses(draft, 1)).toBe(12);
    expect(buildClearDraftConfirmationMessage(0)).toBe("Clear this empty Wayfinder draft?");
    expect(buildClearDraftConfirmationMessage(1)).toContain("1 drafted decision?");
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

function readyEvaluation(): WayfinderStepEvaluation {
  return { state: "complete", complete: true, status: "Ready to apply", issue: null };
}

function blockedEvaluation(pendingStep: PendingStep): WayfinderStepEvaluation {
  return {
    state: "incomplete",
    complete: false,
    status: "Choose one",
    issue: {
      code: "missing-choice",
      stepId: pendingStep.id,
      slotId: pendingStep.slotId,
      title: pendingStep.title,
      message: `${pendingStep.title}: choose one.`,
    },
  };
}
