import { describe, expect, it } from "vitest";
import { buildDraftPatch, createEmptyDraft, createEmptyState, normalizeDraft, normalizeState } from "../src/draft-service";

describe("draft-service", () => {
  it("creates an empty draft", () => {
    expect(createEmptyDraft(4)).toEqual({
      version: 1,
      targetLevel: 4,
      selections: {},
      manual: {},
      updatedAt: null
    });
  });

  it("creates an empty module state", () => {
    expect(createEmptyState()).toEqual({
      version: 1,
      lastAppliedAt: null,
      lastTargetLevel: null,
      completedStepIds: []
    });
  });

  it("sanitizes malformed draft values", () => {
    const draft = normalizeDraft({
      targetLevel: 99,
      selections: {
        keep: {
          packId: "pf2e.feats-srd",
          documentId: "abc",
          uuid: "Compendium.pf2e.feats-srd.abc",
          itemType: "feat",
          name: "Test Feat",
          featType: "general",
          level: 3
        },
        drop: {
          packId: "pf2e.feats-srd"
        }
      },
      manual: {
        one: true,
        two: false
      }
    }, 1);

    expect(draft.targetLevel).toBe(20);
    expect(Object.keys(draft.selections)).toEqual(["keep"]);
    expect(draft.manual).toEqual({
      one: true,
      two: false
    });
  });

  it("adds an updated timestamp when patching a draft", () => {
    const patched = buildDraftPatch(createEmptyDraft(2));
    expect(patched.version).toBe(1);
    expect(patched.updatedAt).not.toBeNull();
  });

  it("sanitizes module state", () => {
    expect(normalizeState({
      lastAppliedAt: "2026-04-08T00:00:00.000Z",
      lastTargetLevel: 24,
      completedStepIds: ["a", 1, "b"]
    })).toEqual({
      version: 1,
      lastAppliedAt: "2026-04-08T00:00:00.000Z",
      lastTargetLevel: 20,
      completedStepIds: ["a", "b"]
    });
  });
});
