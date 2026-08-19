import { describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import {
  createEquipmentAcquisitionExecutionDependencies,
  createEquipmentAcquisitionExecutionSession,
} from "../src/wayfinder/application/equipment-acquisition-session-service";
import type { PreparedAcquisitionEntryV1 } from "../src/wayfinder/domain/acquisition-identity";
import { acquisitionFixture } from "./fixtures/acquisition-fixture";

describe("equipment acquisition session adapter", () => {
  it("binds current runtime resolution to the complete character draft", async () => {
    const acquisition = acquisitionFixture().draft;
    const characterDraft = createEmptyDraft(1);
    characterDraft.acquisition = acquisition;
    const resolution = { sourceUuid: "resolved" } as never;
    const policy = acquisition.policySnapshot!;
    const resolveSourceForApply = vi.fn(async () => resolution);
    const resolveCurrentPolicySnapshot = vi.fn(() => policy);
    const readHistory = vi.fn(() => ({
      lastAppliedAt: null,
      lastTargetLevel: null,
      completedAcquisitionManifest: null,
      completedAcquisitionManifestCorrupt: false,
    }));
    const assertApplyAuthority = vi.fn();
    const readApplyingUser = vi.fn(() => ({ userId: "owner-1", userName: "Owner" }));
    const readEnvironment = vi.fn(() => ({
      foundryVersion: "14.366",
      pf2eVersion: "8.4.1",
      moduleVersion: "0.8.0",
    }));
    const options = {
      characterDraft,
      runtime: { resolveSourceForApply, resolveCurrentPolicySnapshot },
      readHistory,
      assertApplyAuthority,
      readApplyingUser,
      readEnvironment,
    };
    const dependencies = createEquipmentAcquisitionExecutionDependencies(options);
    const actor = { id: "actor-1" };
    const entry = { entryId: "entry-1" } as PreparedAcquisitionEntryV1;

    await expect(dependencies.resolveSource({ actor, draft: acquisition, entry })).resolves.toBe(resolution);
    expect(resolveSourceForApply).toHaveBeenCalledWith({
      actor,
      characterDraft,
      acquisition,
      entry,
    });
    expect(await dependencies.resolveCurrentPolicySnapshot({ actor, draft: acquisition })).toBe(policy);
    expect(resolveCurrentPolicySnapshot).toHaveBeenCalledWith(actor, acquisition);
    expect(dependencies.readHistory).toBe(readHistory);
    expect(dependencies.assertApplyAuthority).toBe(assertApplyAuthority);
    expect(dependencies.readApplyingUser).toBe(readApplyingUser);
    expect(dependencies.readEnvironment).toBe(readEnvironment);

    const firstSession = createEquipmentAcquisitionExecutionSession(options);
    const secondSession = createEquipmentAcquisitionExecutionSession(options);
    expect(firstSession).not.toBe(secondSession);
  });

  it("rejects construction without a persisted acquisition", () => {
    const characterDraft = createEmptyDraft(1);
    expect(() =>
      createEquipmentAcquisitionExecutionDependencies({
        characterDraft,
        runtime: {
          resolveSourceForApply: vi.fn(),
          resolveCurrentPolicySnapshot: vi.fn(),
        },
        readHistory: vi.fn(),
        assertApplyAuthority: vi.fn(),
        readApplyingUser: vi.fn(),
        readEnvironment: vi.fn(),
      })
    ).toThrow(/requires an acquisition draft/i);
  });
});
