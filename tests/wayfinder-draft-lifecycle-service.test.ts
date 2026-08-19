import { describe, expect, it, vi } from "vitest";
import { DRAFT_FLAG, STATE_FLAG } from "../src/constants";
import { createEmptyDraft, createEmptyState } from "../src/draft-service";
import { enqueueActorOperation } from "../src/shared/actor-operation-queue";
import type { AppliedSpellRarityAttestation, PendingStep } from "../src/types";
import {
  applyDraftLifecycle,
  assertRecoveryDraftWriteAllowed,
  type BuildApplyFinalActorUpdate,
  buildApplyAttemptDraft,
  buildClearDraftConfirmationMessage,
  buildSaveDraftUpdate,
  clearDraftLifecycle,
  countDraftLosses,
  createClearedDraftResult,
  hasApplyRecoveryState,
  WayfinderRecoveryDraftConflictError,
} from "../src/wayfinder/application/draft-lifecycle-service";
import {
  PersistedDraftWriteGuard,
  saveDraftWithWriteGuard,
  WayfinderDraftWriteConflictError,
} from "../src/wayfinder/application/draft-write-guard";
import type { WayfinderStepEvaluation } from "../src/wayfinder/domain/step-evaluation";

describe("wayfinder draft lifecycle service", () => {
  it("locks any persisted in-flight or partially completed Apply for exact recovery", () => {
    const ordinary = createEmptyDraft(5);
    const inFlight = createEmptyDraft(5);
    const partial = createEmptyDraft(5);
    inFlight.applyAttemptStepIds = ["class-level-1"];
    partial.applyCompletedStepIds = ["ancestry-level-1"];

    expect(hasApplyRecoveryState(ordinary)).toBe(false);
    expect(hasApplyRecoveryState(inFlight)).toBe(true);
    expect(hasApplyRecoveryState(partial)).toBe(true);
  });

  it("allows only semantic-preserving, monotonic writes over a live recovery draft", () => {
    const live = createEmptyDraft(5);
    live.selections["class-level-1"] = {
      packId: "pf2e.classes",
      documentId: "fighter",
      uuid: "Compendium.pf2e.classes.Item.fighter",
      name: "Fighter",
      slotId: "class-level-1",
      itemType: "class",
      featType: null,
      level: 1,
    };
    live.applyCompletedStepIds = ["ancestry-level-1"];
    live.applyAttemptStepIds = ["class-level-1", "background-level-1"];
    live.applySpellRarityAttestations = [spellAttestationEvidence()];

    expect(() => assertRecoveryDraftWriteAllowed(live, structuredClone(live))).not.toThrow();

    const reclassified = structuredClone(live);
    reclassified.applyCompletedStepIds.push("class-level-1");
    reclassified.applyAttemptStepIds = ["background-level-1"];
    expect(() => assertRecoveryDraftWriteAllowed(live, reclassified)).not.toThrow();

    const stale = createEmptyDraft(5);
    expect(() => assertRecoveryDraftWriteAllowed(live, stale)).toThrow(WayfinderRecoveryDraftConflictError);

    const divergent = structuredClone(live);
    divergent.targetLevel = 4;
    expect(() => assertRecoveryDraftWriteAllowed(live, divergent)).toThrow(WayfinderRecoveryDraftConflictError);

    const truncated = structuredClone(live);
    truncated.applyAttemptStepIds = ["background-level-1"];
    expect(() => assertRecoveryDraftWriteAllowed(live, truncated)).toThrow(WayfinderRecoveryDraftConflictError);

    const tamperedAttestation = structuredClone(live);
    tamperedAttestation.applySpellRarityAttestations[0]!.reason = "Changed after the partial Apply.";
    expect(() => assertRecoveryDraftWriteAllowed(live, tamperedAttestation)).toThrow(
      WayfinderRecoveryDraftConflictError
    );
  });

  it("freezes the original Apply attestation evidence across a rebuilt retry", () => {
    const frozenEvidence = spellAttestationEvidence();
    const draft = createEmptyDraft(1);
    draft.applyAttemptStepIds = ["spell-choice-wizard-level-1"];
    draft.applySpellRarityAttestations = [frozenEvidence];
    const replacementEvidence = structuredClone(frozenEvidence);
    replacementEvidence.reason = "A newly recomputed reason that must not replace the frozen receipt.";

    const retry = buildApplyAttemptDraft(draft, [step("class-level-1")], [replacementEvidence]);

    expect(retry.applySpellRarityAttestations).toEqual([frozenEvidence]);
    expect(retry.applySpellRarityAttestations).not.toBe(draft.applySpellRarityAttestations);
    replacementEvidence.selectedSpells[0]!.name = "Changed after capture";
    expect(retry.applySpellRarityAttestations[0]?.selectedSpells[0]?.name).toBe("Forbidding Ward");
  });

  it("preserves an intentionally empty frozen attestation receipt across recovery", () => {
    const draft = createEmptyDraft(1);
    draft.applyAttemptStepIds = ["class-level-1"];

    const retry = buildApplyAttemptDraft(draft, [step("background-level-1")], [spellAttestationEvidence()]);

    expect(retry.applySpellRarityAttestations).toEqual([]);
  });

  it("re-reads the live recovery draft inside the actor queue before saving", async () => {
    const actorKey = {};
    const stale = createEmptyDraft(5);
    const recovery = createEmptyDraft(5);
    recovery.applyAttemptStepIds = ["class-level-1"];
    let persisted: unknown = stale;
    const update = vi.fn(async (actorUpdate: Record<string, unknown>) => {
      persisted = actorUpdate[DRAFT_FLAG];
    });
    const actor = {
      getFlag: () => persisted,
      update,
    };
    const guard = new PersistedDraftWriteGuard(stale);

    const establishRecovery = enqueueActorOperation(actorKey, async () => {
      persisted = recovery;
    });
    const staleSave = enqueueActorOperation(actorKey, () => saveDraftWithWriteGuard(actor, stale, 5, guard));
    await establishRecovery;
    await expect(staleSave).rejects.toBeInstanceOf(WayfinderDraftWriteConflictError);
    expect(update).not.toHaveBeenCalled();

    guard.acceptCurrent(recovery);
    await saveDraftWithWriteGuard(actor, recovery, 5, guard);
    expect(update).toHaveBeenCalledOnce();
  });

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

  it("finalizes a zero-step recovery without rerunning the prepared Apply path", async () => {
    const draft = createEmptyDraft(5);
    const frozenEvidence = spellAttestationEvidence();
    draft.applyCompletedStepIds = ["ancestry-level-1"];
    draft.applyAttemptStepIds = ["class-level-1"];
    draft.applyRecoveryActorUpdate = { "system.skills.arcana.rank": 1 };
    draft.applySpellRarityAttestations = [frozenEvidence];
    const order: string[] = [];
    const applyDraftToActor = vi.fn(async () => {
      order.push("apply");
    });
    const finalizeRecoveredDraft = vi.fn(
      async (recoveryActorUpdate: Record<string, unknown>, buildFinalActorUpdate: BuildApplyFinalActorUpdate) => {
        order.push("finalize");
        expect(recoveryActorUpdate).toEqual({ "system.skills.arcana.rank": 1 });
        expect(buildFinalActorUpdate()).toEqual(
          expect.objectContaining({
            [DRAFT_FLAG]: null,
            [STATE_FLAG]: expect.objectContaining({
              completedStepIds: ["ancestry-level-1", "class-level-1"],
              lastTargetLevel: 5,
              lastAppliedSpellRarityAttestations: [frozenEvidence],
            }),
          })
        );
      }
    );

    const result = await applyDraftLifecycle({
      actorName: "Valeros",
      currentLevel: 5,
      draft,
      steps: [],
      evaluateStep: async () => readyEvaluation(),
      confirmApply: (message) => {
        order.push("confirm");
        expect(message).toContain("No build steps remain to reapply");
        expect(message).toContain("Player attestation — not GM authorization");
        return true;
      },
      appliedSpellRarityAttestations: [],
      reviewLines: ["Player attestation — not GM authorization: Wizard spells"],
      beforeApply: async (attempt) => {
        order.push("persist");
        expect(attempt.applyCompletedStepIds).toEqual(["ancestry-level-1", "class-level-1"]);
        expect(attempt.applyAttemptStepIds).toEqual([]);
        expect(attempt.applySpellRarityAttestations).toEqual([frozenEvidence]);
      },
      applyDraftToActor,
      finalizeRecoveredDraft,
      now: () => "2026-08-16T12:00:00.000Z",
    });

    expect(result.kind).toBe("applied");
    expect(order).toEqual(["confirm", "persist", "finalize"]);
    expect(applyDraftToActor).not.toHaveBeenCalled();
    expect(finalizeRecoveredDraft).toHaveBeenCalledOnce();
  });

  it("blocks acquisition before confirmation or Apply-attempt persistence when no executor is active", async () => {
    const draft = createEmptyDraft(5);
    draft.acquisition = {
      schemaVersion: 2,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 5,
      recipe: { kind: "lump-sum" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const confirmApply = vi.fn();
    const beforeApply = vi.fn();
    const applyDraftToActor = vi.fn();

    const result = await applyDraftLifecycle({
      actorName: "Valeros",
      currentLevel: 5,
      draft,
      steps: [],
      evaluateStep: async () => readyEvaluation(),
      confirmApply,
      beforeApply,
      applyDraftToActor,
    });

    expect(result).toMatchObject({
      kind: "warning",
      warning: "draft-not-ready",
      blockers: [{ code: "dependency-review", slotId: "starting-equipment" }],
    });
    expect(confirmApply).not.toHaveBeenCalled();
    expect(beforeApply).not.toHaveBeenCalled();
    expect(applyDraftToActor).not.toHaveBeenCalled();
  });

  it("routes zero-step acquisition recovery through the guarded recovery finalizer", async () => {
    const draft = createEmptyDraft(5);
    draft.applyAttemptStepIds = ["starting-equipment"];
    draft.acquisition = {
      schemaVersion: 2,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 5,
      recipe: { kind: "lump-sum" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const finalizeRecoveredDraft = vi.fn();

    const result = await applyDraftLifecycle({
      actorName: "Valeros",
      currentLevel: 5,
      draft,
      steps: [],
      acquisitionExecutionAvailable: true,
      assertAcquisitionApplyAuthority: () => undefined,
      evaluateStep: async () => readyEvaluation(),
      applyDraftToActor: vi.fn(),
      finalizeRecoveredDraft,
    });

    expect(result).toMatchObject({ kind: "applied" });
    expect(finalizeRecoveredDraft).toHaveBeenCalledOnce();
  });

  it("blocks acquisition authority before confirmation or Apply-attempt persistence", async () => {
    const draft = createEmptyDraft(5);
    draft.acquisition = {
      schemaVersion: 2,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 5,
      recipe: { kind: "lump-sum" },
      policySnapshot: null,
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const confirmApply = vi.fn();
    const beforeApply = vi.fn();

    const result = await applyDraftLifecycle({
      actorName: "Valeros",
      currentLevel: 5,
      draft,
      steps: [],
      acquisitionExecutionAvailable: true,
      assertAcquisitionApplyAuthority: () => {
        throw new Error("Only a current GM may apply this equipment draft.");
      },
      evaluateStep: async () => readyEvaluation(),
      confirmApply,
      beforeApply,
      applyDraftToActor: vi.fn(),
    });

    expect(result).toMatchObject({
      kind: "warning",
      warning: "draft-not-ready",
      blockers: [{ slotId: "starting-equipment", message: expect.stringMatching(/current GM/i) }],
    });
    expect(confirmApply).not.toHaveBeenCalled();
    expect(beforeApply).not.toHaveBeenCalled();
  });

  it("blocks malformed acquisition recovery instead of silently treating it as legacy recovery", async () => {
    const draft = createEmptyDraft(5);
    draft.acquisitionCorrupt = true;
    draft.applyAttemptStepIds = ["starting-equipment"];
    const finalizeRecoveredDraft = vi.fn();

    const result = await applyDraftLifecycle({
      actorName: "Valeros",
      currentLevel: 5,
      draft,
      steps: [],
      evaluateStep: async () => readyEvaluation(),
      applyDraftToActor: vi.fn(),
      finalizeRecoveredDraft,
    });

    expect(result).toMatchObject({
      kind: "warning",
      warning: "draft-not-ready",
      blockers: [{ code: "dependency-review", slotId: "starting-equipment" }],
    });
    expect(finalizeRecoveredDraft).not.toHaveBeenCalled();
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

  it("retains the full persisted Apply attempt across a rebuilt partial retry", async () => {
    const draft = createEmptyDraft(5);
    draft.applyAttemptStepIds = [
      "ancestry-level-1",
      "ability-boosts-level-2",
      "ability-boosts-level-3",
      "class-feat-level-2",
    ];
    const remainingSteps = [step("language-choice-level-1"), step("ability-boosts-level-4")];
    let persistedAttempt = createEmptyDraft(1);
    let buildFinalActorUpdate: BuildApplyFinalActorUpdate | null = null;

    await applyDraftLifecycle({
      actorName: "Valeros",
      currentLevel: 1,
      draft,
      existingCompletedStepIds: ["prior-completed-step"],
      steps: remainingSteps,
      evaluateStep: async () => readyEvaluation(),
      confirmApply: () => true,
      beforeApply: async (applyAttemptDraft) => {
        persistedAttempt = applyAttemptDraft;
      },
      applyDraftToActor: async (buildUpdate) => {
        buildFinalActorUpdate = buildUpdate;
      },
    });

    expect(persistedAttempt.applyCompletedStepIds).toEqual([
      "ancestry-level-1",
      "ability-boosts-level-2",
      "ability-boosts-level-3",
      "class-feat-level-2",
    ]);
    expect(persistedAttempt.applyAttemptStepIds).toEqual(["language-choice-level-1", "ability-boosts-level-4"]);
    expect(buildFinalActorUpdate?.()).toEqual(
      expect.objectContaining({
        [STATE_FLAG]: expect.objectContaining({
          completedStepIds: [
            "prior-completed-step",
            "ancestry-level-1",
            "ability-boosts-level-2",
            "ability-boosts-level-3",
            "class-feat-level-2",
            "language-choice-level-1",
            "ability-boosts-level-4",
          ],
        }),
      })
    );
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

  it("blocks draft-level attestation issues before confirmation or candidate persistence", async () => {
    const confirmApply = vi.fn(() => true);
    const beforeApply = vi.fn(async () => undefined);
    const applyDraftToActor = vi.fn(async () => undefined);
    const blocker = {
      code: "access-attestation" as const,
      stepId: "spell-choice-wizard-level-1",
      slotId: "spell-choice-wizard-level-1",
      title: "Wizard spells",
      message: "Review the migrated player attestation.",
    };

    const result = await applyDraftLifecycle({
      actorName: "Ezren",
      currentLevel: 1,
      draft: createEmptyDraft(1),
      steps: [step("spell-choice-wizard-level-1")],
      evaluateStep: async () => readyEvaluation(),
      additionalBlockers: [blocker],
      confirmApply,
      beforeApply,
      applyDraftToActor,
    });

    expect(result).toEqual({ kind: "warning", warning: "draft-not-ready", blockers: [blocker] });
    expect(confirmApply).not.toHaveBeenCalled();
    expect(beforeApply).not.toHaveBeenCalled();
    expect(applyDraftToActor).not.toHaveBeenCalled();
  });

  it("reviews and atomically retains player-attestation evidence in the final state", async () => {
    const evidence = spellAttestationEvidence();
    const confirmApply = vi.fn(() => true);
    let finalUpdate: Record<string, unknown> | null = null;

    await applyDraftLifecycle({
      actorName: "Ezren",
      currentLevel: 1,
      draft: createEmptyDraft(1),
      steps: [step("spell-choice-wizard-level-1")],
      evaluateStep: async () => readyEvaluation(),
      appliedSpellRarityAttestations: [evidence],
      reviewLines: ["Player attestation — not GM authorization: Wizard spells"],
      confirmApply,
      applyDraftToActor: async (buildUpdate) => {
        finalUpdate = buildUpdate();
      },
    });

    expect(confirmApply).toHaveBeenCalledWith(
      "Apply 1 Wayfinder step(s) to Ezren?\n\nPlayer attestation — not GM authorization: Wizard spells"
    );
    expect(finalUpdate).toEqual(
      expect.objectContaining({
        [DRAFT_FLAG]: null,
        [STATE_FLAG]: expect.objectContaining({
          lastAppliedSpellRarityAttestations: [evidence],
        }),
      })
    );
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
    draft.spellRarityAttestations.spells = {
      version: 1,
      kind: "spell-rarity-access",
      trust: "player-attestation",
      status: "unresolved",
      slotId: "spells",
      migratedFrom: "legacy-boolean",
    };
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
    draft.spellRarityAttestations.spells = {
      version: 1,
      kind: "spell-rarity-access",
      trust: "player-attestation",
      status: "unresolved",
      slotId: "spells",
      migratedFrom: "legacy-boolean",
    };
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

function spellAttestationEvidence(): AppliedSpellRarityAttestation {
  return {
    version: 1,
    kind: "spell-rarity-access",
    trust: "player-attestation",
    status: "attested",
    subject: {
      actorId: "actor-1",
      slotId: "spell-choice-wizard-level-1",
      stepId: "spell-choice-wizard-level-1",
      targetLevel: 1,
      stepLevel: 1,
      destinationKey: "wizard-spellbook",
      stepRarityCeiling: "common",
      worldRarityCeiling: "common",
    },
    claimedBasis: "rules-access",
    reason: "Wizard feature grants Access.",
    authorUserId: "user-1",
    authorName: "Player One",
    attestedAt: "2026-08-16T12:34:56.000Z",
    subjectLabel: "Wizard spells",
    selectedSpells: [
      {
        slotId: "spell-choice-wizard-level-1",
        packId: "pf2e.spells-srd",
        documentId: "forbidding-ward",
        uuid: "Compendium.pf2e.spells-srd.Item.forbidding-ward",
        itemType: "spell",
        featType: null,
        name: "Forbidding Ward",
        level: 1,
      },
    ],
  };
}

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
