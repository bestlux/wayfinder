import { describe, expect, it } from "vitest";
import type { PendingStep } from "../src/types";
import { buildWayfinderContext } from "../src/wayfinder/application/wayfinder-context-service";
import { evaluateWayfinderDraftReadiness, type WayfinderStepEvaluation } from "../src/wayfinder/domain/step-evaluation";

describe("wayfinder context service", () => {
  it("builds summary rows, dossier text, and navigation state for the active step", async () => {
    const steps = [
      step("ancestry-level-1", "Ancestry"),
      step("class-level-1", "Class"),
      step("deity-level-1", "Deity"),
    ];

    const context = await buildWayfinderContext({
      actorId: "actor-1",
      actorName: "Kyra",
      currentLevel: 1,
      targetLevel: 2,
      steps,
      activeStep: steps[1] ?? null,
      activePane: { kind: "manual", title: "Class" } as never,
      statusNote: "Class changed.",
      summaryDocuments: {
        ancestry: { name: "Human" },
        heritage: { name: "Half-Elf" },
        background: { name: "Scholar" },
        classDocument: { name: "Cleric" },
        deity: { name: "Sarenrae" },
      },
      readiness: await evaluateWayfinderDraftReadiness(steps, async (pendingStep) =>
        pendingStep.id === "deity-level-1"
          ? blockedEvaluation(pendingStep, "dependency-review", `${pendingStep.title} ready`)
          : readyEvaluation(`${pendingStep.title} ready`)
      ),
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
    expect(context.canApplyDraft).toBe(false);
    expect(context.applyBlocker).toMatchObject({ stepId: "deity-level-1", code: "dependency-review" });
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
      actorId: "actor-1",
      actorName: "Valeros",
      currentLevel: 1,
      targetLevel: 1,
      steps,
      activeStep: null,
      activePane: null,
      statusNote: null,
      summaryDocuments: {
        ancestry: null,
        heritage: null,
        background: null,
        classDocument: null,
        deity: null,
      },
      readiness: await evaluateWayfinderDraftReadiness(steps, async (pendingStep) =>
        blockedEvaluation(pendingStep, "missing-choice", "Missing")
      ),
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
    expect(context.canApplyDraft).toBe(false);
    expect(context.applyBlocker?.message).toBe("Class: Missing.");
  });

  it("disables apply when there are no Wayfinder-guided steps", async () => {
    const acquisitionReceipt = {
      manifestId: "manifest-1",
      batchId: "batch-1",
      appliedAt: "2026-08-19T20:00:00.000Z",
      appliedBy: "Owner",
    } as never;
    const context = await buildWayfinderContext({
      actorId: "actor-1",
      actorName: "Valeros",
      currentLevel: 1,
      targetLevel: 1,
      steps: [],
      activeStep: null,
      activePane: null,
      statusNote: null,
      summaryDocuments: {
        ancestry: null,
        heritage: null,
        background: null,
        classDocument: null,
        deity: null,
      },
      readiness: await evaluateWayfinderDraftReadiness([], async (pendingStep) =>
        blockedEvaluation(pendingStep, "missing-choice", "Missing")
      ),
      acquisitionReceipt,
    });

    expect(context.hasPendingSteps).toBe(false);
    expect(context.canApplyDraft).toBe(false);
    expect(context.applyBlocker).toBeNull();
    expect(context.acquisitionReceipt).toBe(acquisitionReceipt);
  });

  it("builds a durable player-attestation receipt view without approval vocabulary", async () => {
    const context = await buildWayfinderContext({
      actorId: "actor-1",
      actorName: "Ezren",
      currentLevel: 1,
      targetLevel: 1,
      steps: [],
      activeStep: null,
      activePane: null,
      statusNote: null,
      summaryDocuments: {
        ancestry: null,
        heritage: null,
        background: null,
        classDocument: null,
        deity: null,
      },
      readiness: await evaluateWayfinderDraftReadiness([], async (pendingStep) =>
        blockedEvaluation(pendingStep, "missing-choice", "Missing")
      ),
      lastAppliedSpellRarityAttestations: [
        {
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
          claimedBasis: "reported-gm-permission",
          reason: "The player reports campaign permission.",
          authorUserId: "user-1",
          authorName: "Player One",
          attestedAt: "2026-08-16T12:34:56.000Z",
          subjectLabel: "Wizard spellbook",
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
        },
      ],
    });

    expect(context.lastAppliedSpellRarityAttestations).toEqual([
      {
        stepId: "spell-choice-wizard-level-1",
        subjectLabel: "Wizard spellbook",
        basisLabel: "GM permission reported by player",
        reason: "The player reports campaign permission.",
        authorName: "Player One",
        attestedAt: "2026-08-16T12:34:56.000Z",
        selectedSpellNames: "Forbidding Ward",
      },
    ]);
  });

  it("groups imported existing-character history by level and exposes review counts", async () => {
    const context = await buildWayfinderContext({
      actorId: "actor-1",
      actorName: "Ezren",
      currentLevel: 5,
      targetLevel: 5,
      steps: [],
      activeStep: null,
      activePane: null,
      statusNote: null,
      summaryDocuments: {
        ancestry: { name: "Human" },
        heritage: { name: "Versatile Heritage" },
        background: { name: "Scholar" },
        classDocument: { name: "Wizard" },
        deity: null,
      },
      readiness: await evaluateWayfinderDraftReadiness([], async (pendingStep) =>
        blockedEvaluation(pendingStep, "missing-choice", "Missing")
      ),
      canImportExistingHistory: true,
      existingCharacterHistory: {
        version: 1,
        importedAt: "2026-07-26T18:00:00.000Z",
        actorLevel: 5,
        entries: [
          {
            slotId: "ancestry-level-1",
            level: 1,
            category: "foundation",
            label: "Ancestry",
            value: "Human",
            status: "mapped",
            sourceUuid: "Compendium.pf2e.ancestries.Item.human",
          },
          {
            slotId: "ability-boosts-level-5",
            level: 5,
            category: "ability-boost",
            label: "Level 5 ability boosts",
            value: "Review required",
            status: "review",
            sourceUuid: null,
          },
        ],
      },
    });

    expect(context.canImportExistingHistory).toBe(true);
    expect(context.existingCharacterHistory).toMatchObject({
      actorLevel: 5,
      mappedCount: 1,
      reviewCount: 1,
      levels: [
        {
          level: 1,
          entries: [expect.objectContaining({ slotId: "ancestry-level-1", mapped: true, review: false })],
        },
        {
          level: 5,
          entries: [expect.objectContaining({ slotId: "ability-boosts-level-5", mapped: false, review: true })],
        },
      ],
    });
  });

  it("keeps readiness separate while save errors and lifecycle barriers gate Apply", async () => {
    const steps = [step("class-level-1", "Class")];
    const base = {
      actorId: "actor-1",
      actorName: "Ezren",
      currentLevel: 1,
      targetLevel: 1,
      steps,
      activeStep: steps[0] ?? null,
      activePane: null,
      statusNote: null,
      summaryDocuments: {
        ancestry: null,
        heritage: null,
        background: null,
        classDocument: null,
        deity: null,
      },
      readiness: await evaluateWayfinderDraftReadiness(steps, async () => readyEvaluation("Ready")),
    };

    const saving = await buildWayfinderContext({
      ...base,
      draftSaveState: {
        phase: "saving",
        revision: 2,
        durableRevision: 1,
        retryable: false,
        message: null,
      },
    });
    const failed = await buildWayfinderContext({
      ...base,
      draftSaveState: {
        phase: "error",
        revision: 2,
        durableRevision: 1,
        retryable: true,
        message: "save failed",
      },
    });
    const busy = await buildWayfinderContext({ ...base, lifecycleBusy: true });

    expect(saving).toMatchObject({
      readinessReady: true,
      canApplyDraft: true,
      draftSave: { labelKey: "wayfinder-pf2e.App.DraftSaving" },
    });
    expect(failed).toMatchObject({
      readinessReady: true,
      canApplyDraft: false,
      draftSave: { error: true, retryable: true, live: "assertive" },
    });
    expect(failed.applyBlocker).toBeNull();
    expect(busy).toMatchObject({ readinessReady: true, canApplyDraft: false, lifecycleBusy: true });
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

function readyEvaluation(status: string): WayfinderStepEvaluation {
  return { state: "complete", complete: true, status, issue: null };
}

function blockedEvaluation(
  step: PendingStep,
  code: "missing-choice" | "dependency-review",
  status: string
): WayfinderStepEvaluation {
  return {
    state: code === "dependency-review" ? "invalid" : "incomplete",
    complete: false,
    status,
    issue: {
      code,
      stepId: step.id,
      slotId: step.slotId,
      title: step.title,
      message: `${step.title}: ${status}.`,
    },
  };
}
