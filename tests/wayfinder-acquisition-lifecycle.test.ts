import { describe, expect, it, vi } from "vitest";
import { DRAFT_FLAG, STATE_FLAG } from "../src/constants";
import { createEmptyDraft, createEmptyState } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import {
  applyDraftLifecycle,
  type BuildApplyFinalActorUpdate,
} from "../src/wayfinder/application/draft-lifecycle-service";
import { computeCompletedAcquisitionManifestFingerprint } from "../src/wayfinder/domain/completed-acquisition-manifest";
import type { WayfinderStepEvaluation } from "../src/wayfinder/domain/step-evaluation";
import { completedAcquisitionFixture } from "./fixtures/acquisition-fixture";

describe("acquisition lifecycle completion", () => {
  it("atomically persists exact completion evidence with draft clear and a consistent timestamp", async () => {
    const completed = await completedAcquisitionFixture();
    const draft = createEmptyDraft(5);
    draft.acquisition = completed.draft;
    const persist = vi.fn();

    const result = await applyDraftLifecycle({
      actorName: "Merisiel",
      currentLevel: 4,
      draft,
      steps: [step()],
      acquisitionExecutionAvailable: true,
      evaluateStep: async () => readyEvaluation(),
      applyDraftToActor: async (buildFinalActorUpdate) => {
        const update = buildFinalActorUpdate(createEmptyState(), {
          classGrantReconciliations: [completed.finalClassGrantReconciliation],
          acquisition: { kind: "completed", identityPlan: completed.identityPlan, manifest: completed.manifest },
        });
        persist(update);
      },
      now: () => "2026-08-18T21:59:00.000Z",
    });

    expect(result.kind).toBe("applied");
    expect(persist).toHaveBeenCalledWith({
      [DRAFT_FLAG]: null,
      [STATE_FLAG]: expect.objectContaining({
        version: 4,
        lastAppliedAt: completed.manifest.appliedAt,
        completedAcquisitionManifest: completed.manifest,
        completedAcquisitionManifestCorrupt: false,
      }),
    });
  });

  it("cannot clear an acquisition draft without exact completed evidence", async () => {
    const completed = await completedAcquisitionFixture();
    const draft = createEmptyDraft(5);
    draft.acquisition = completed.draft;

    await expect(
      applyLifecycleWithFinalizer(draft, (buildFinalActorUpdate) =>
        buildFinalActorUpdate(createEmptyState(), { classGrantReconciliations: [], acquisition: { kind: "none" } })
      )
    ).rejects.toThrow(/cannot clear its draft without completed manifest evidence/i);
  });

  it("converges an exact durable outcome across retry metadata but rejects a different same-id outcome", async () => {
    const completed = await completedAcquisitionFixture();
    const draft = createEmptyDraft(5);
    draft.acquisition = completed.draft;
    const current = {
      ...createEmptyState(),
      completedAcquisitionManifest: completed.manifest,
    };
    const retry = structuredClone(completed.manifest) as Mutable<typeof completed.manifest>;
    retry.appliedBy = { userId: "gm-1", userName: "Game Master" };
    retry.appliedAt = "2026-08-19T22:00:00.000Z";
    retry.environment = { foundryVersion: "14.367", pf2eVersion: "8.4.1", moduleVersion: "0.8.1" };
    retry.fingerprint = computeCompletedAcquisitionManifestFingerprint(retry);

    await applyLifecycleWithFinalizer(draft, (buildFinalActorUpdate) => {
      const update = buildFinalActorUpdate(current, {
        classGrantReconciliations: [completed.finalClassGrantReconciliation],
        acquisition: { kind: "completed", identityPlan: completed.identityPlan, manifest: retry },
      });
      expect((update[STATE_FLAG] as { completedAcquisitionManifest: unknown }).completedAcquisitionManifest).toEqual(
        completed.manifest
      );
      return update;
    });

    const different = structuredClone(completed.manifest) as Mutable<typeof completed.manifest>;
    different.entries[0]!.observedItems[0]!.actualItemId = "another-actor-item";
    different.fingerprint = computeCompletedAcquisitionManifestFingerprint(different);
    await expect(
      applyLifecycleWithFinalizer(draft, (buildFinalActorUpdate) =>
        buildFinalActorUpdate(current, {
          classGrantReconciliations: [completed.finalClassGrantReconciliation],
          acquisition: { kind: "completed", identityPlan: completed.identityPlan, manifest: different },
        })
      )
    ).rejects.toThrow(/already exists for another outcome/i);
  });

  it("rejects stale prepared identity after reviewed policy material changes", async () => {
    const completed = await completedAcquisitionFixture();
    const draft = createEmptyDraft(5);
    draft.acquisition = structuredClone(completed.draft);
    (draft.acquisition as Mutable<NonNullable<typeof draft.acquisition>>).policySnapshot!.fingerprint =
      "changed-policy-diagnostic";

    await expect(
      applyLifecycleWithFinalizer(draft, (buildFinalActorUpdate) =>
        buildFinalActorUpdate(createEmptyState(), {
          classGrantReconciliations: [completed.finalClassGrantReconciliation],
          acquisition: { kind: "completed", identityPlan: completed.identityPlan, manifest: completed.manifest },
        })
      )
    ).rejects.toThrow(/no longer matches the current reviewed material/i);
  });

  it("preserves prior completion on non-acquisition Apply and blocks replacement over corrupt state", async () => {
    const completed = await completedAcquisitionFixture();
    const ordinary = createEmptyDraft(5);
    await applyLifecycleWithFinalizer(
      ordinary,
      (buildFinalActorUpdate) => {
        const update = buildFinalActorUpdate(
          { ...createEmptyState(), completedAcquisitionManifest: completed.manifest },
          { classGrantReconciliations: [], acquisition: { kind: "none" } }
        );
        expect((update[STATE_FLAG] as { completedAcquisitionManifest: unknown }).completedAcquisitionManifest).toEqual(
          completed.manifest
        );
        expect((update[STATE_FLAG] as { lastAppliedAt: string }).lastAppliedAt).toBe("2026-08-19T12:00:00.000Z");
        return update;
      },
      false,
      () => "2026-08-19T12:00:00.000Z"
    );

    await applyLifecycleWithFinalizer(
      ordinary,
      (buildFinalActorUpdate) => {
        const update = buildFinalActorUpdate(
          { ...createEmptyState(), completedAcquisitionManifestCorrupt: true },
          { classGrantReconciliations: [], acquisition: { kind: "none" } }
        );
        expect(update[STATE_FLAG]).toEqual(
          expect.objectContaining({ completedAcquisitionManifest: null, completedAcquisitionManifestCorrupt: true })
        );
        return update;
      },
      false
    );

    const acquisition = createEmptyDraft(5);
    acquisition.acquisition = completed.draft;
    await expect(
      applyLifecycleWithFinalizer(acquisition, (buildFinalActorUpdate) =>
        buildFinalActorUpdate(
          { ...createEmptyState(), completedAcquisitionManifestCorrupt: true },
          {
            classGrantReconciliations: [completed.finalClassGrantReconciliation],
            acquisition: { kind: "completed", identityPlan: completed.identityPlan, manifest: completed.manifest },
          }
        )
      )
    ).rejects.toThrow(/malformed and cannot be replaced/i);
  });
});

function applyLifecycleWithFinalizer(
  draft: ReturnType<typeof createEmptyDraft>,
  finalize: (buildFinalActorUpdate: BuildApplyFinalActorUpdate) => unknown,
  acquisitionExecutionAvailable = true,
  now?: () => string
) {
  return applyDraftLifecycle({
    actorName: "Merisiel",
    currentLevel: 4,
    draft,
    steps: [step()],
    acquisitionExecutionAvailable,
    evaluateStep: async () => readyEvaluation(),
    applyDraftToActor: async (buildFinalActorUpdate) => {
      finalize(buildFinalActorUpdate);
    },
    now,
  });
}

function step(): PendingStep {
  return {
    id: "starting-equipment",
    level: 5,
    kind: "manual",
    slotKind: "class",
    title: "Starting equipment",
    description: "",
    required: true,
    slotId: "starting-equipment",
  };
}

function readyEvaluation(): WayfinderStepEvaluation {
  return { state: "complete", complete: true, status: "Ready to apply", issue: null };
}

type Mutable<T> = T extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;
