import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUseWayfinder } from "../src/permissions";

beforeEach(() => {
  (globalThis as any).game = {
    system: {
      id: "pf2e"
    },
    user: {
      id: "user-1"
    }
  };

  (globalThis as any).CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: {
      OWNER: 3
    }
  };
});

describe("canUseWayfinder", () => {
  it("allows an owned PF2E character actor", () => {
    expect(canUseWayfinder({
      type: "character",
      isOwner: true
    })).toBe(true);
  });

  it("rejects non-character actors", () => {
    expect(canUseWayfinder({
      type: "npc",
      isOwner: true
    })).toBe(false);
  });

  it("falls back to testUserPermission when needed", () => {
    const testUserPermission = vi.fn(() => true);

    expect(canUseWayfinder({
      type: "character",
      isOwner: false,
      testUserPermission
    })).toBe(true);
    expect(testUserPermission).toHaveBeenCalled();
  });
});
