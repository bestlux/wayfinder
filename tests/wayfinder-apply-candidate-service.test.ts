import { describe, expect, it, vi } from "vitest";
import { createEmptyDraft, createEmptyState } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import {
  assertApplyCandidateCurrent,
  persistApplyCandidateIfCurrent,
  WayfinderApplyDriftError,
} from "../src/wayfinder/application/apply-candidate-service";

describe("Wayfinder Apply candidate", () => {
  it("accepts one unchanged draft, actor state, module state, and plan", async () => {
    const harness = candidateHarness();
    await expect(assertApplyCandidateCurrent(harness)).resolves.toBeUndefined();
  });

  it("rejects local draft drift before rebuilding the plan", async () => {
    const harness = candidateHarness();
    harness.currentDraft = () => {
      const changed = createEmptyDraft(1);
      changed.manual.changed = true;
      return changed;
    };

    await expect(assertApplyCandidateCurrent(harness)).rejects.toBeInstanceOf(WayfinderApplyDriftError);
    expect(harness.buildCurrentSteps).not.toHaveBeenCalled();
  });

  it.each(["actor", "state", "plan"] as const)("rejects %s drift after confirmation", async (kind) => {
    const harness = candidateHarness();
    if (kind === "actor") {
      harness.inspectCurrentActor = () => ({ level: 2, skillRanks: { arcana: 0 } });
    } else if (kind === "state") {
      harness.readCurrentState = () => ({ ...createEmptyState(), lastTargetLevel: 2 });
    } else {
      harness.buildCurrentSteps = vi.fn(async () => [step("changed")]);
    }

    await expect(assertApplyCandidateCurrent(harness)).rejects.toMatchObject({
      name: "WayfinderApplyDriftError",
      message: expect.stringContaining("actor or Wayfinder plan changed"),
    });
  });

  it("does not persist a candidate that already drifted after confirmation", async () => {
    const harness = candidateHarness();
    harness.readCurrentState = () => ({ ...createEmptyState(), lastTargetLevel: 2 });
    const persistCandidate = vi.fn(async () => undefined);

    await expect(persistApplyCandidateIfCurrent(harness, persistCandidate)).rejects.toBeInstanceOf(
      WayfinderApplyDriftError
    );
    expect(persistCandidate).not.toHaveBeenCalled();
  });
});

function candidateHarness() {
  const draft = createEmptyDraft(1);
  const state = createEmptyState();
  const steps = [step("manual")];
  return {
    actorSnapshot: { level: 1, skillRanks: { arcana: 0 } },
    stateSnapshot: state,
    draftSnapshot: draft,
    stepSnapshots: steps,
    currentDraft: () => draft,
    inspectCurrentActor: () => ({ level: 1, skillRanks: { arcana: 0 } }),
    readCurrentState: () => state,
    buildCurrentSteps: vi.fn(async () => steps),
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
