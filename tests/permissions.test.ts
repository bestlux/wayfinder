import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertCanUseWayfinder, canUseWayfinder, WayfinderActorAuthorityError } from "../src/permissions";
import {
  requireCurrentGmPrincipal,
  WayfinderGmCommandAuthorityError,
} from "../src/wayfinder/application/gm-command-authority";

beforeEach(() => {
  (globalThis as any).game = {
    system: {
      id: "pf2e",
    },
    user: {
      id: "user-1",
    },
  };

  (globalThis as any).CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: {
      OWNER: 3,
    },
  };
});

describe("canUseWayfinder", () => {
  it("allows an owned PF2E character actor", () => {
    expect(
      canUseWayfinder({
        type: "character",
        isOwner: true,
      })
    ).toBe(true);
  });

  it("rejects non-character actors", () => {
    expect(
      canUseWayfinder({
        type: "npc",
        isOwner: true,
      })
    ).toBe(false);
  });

  it("falls back to testUserPermission when needed", () => {
    const testUserPermission = vi.fn(() => true);

    expect(
      canUseWayfinder({
        type: "character",
        isOwner: false,
        testUserPermission,
      })
    ).toBe(true);
    expect(testUserPermission).toHaveBeenCalled();
  });

  it("fails closed when actor authority is lost", () => {
    expect(() => assertCanUseWayfinder({ type: "character", isOwner: false, permission: 0 })).toThrow(
      WayfinderActorAuthorityError
    );
  });
});

describe("GM command authority", () => {
  it("requires a current GM identity rather than actor ownership or role metadata", () => {
    expect(requireCurrentGmPrincipal({ id: "gm-1", isGM: true, role: 4 })).toEqual({
      userId: "gm-1",
      isGM: true,
    });
    expect(() => requireCurrentGmPrincipal({ id: "owner-1", isGM: false, role: 4, isOwner: true })).toThrow(
      WayfinderGmCommandAuthorityError
    );
    expect(() => requireCurrentGmPrincipal({ id: "", isGM: true })).toThrow(WayfinderGmCommandAuthorityError);
  });
});
