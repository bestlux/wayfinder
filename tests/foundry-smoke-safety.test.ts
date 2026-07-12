import { describe, expect, it } from "vitest";

describe("foundry smoke safety", () => {
  it("allows non-destructive keep-actors runs without a world id", async () => {
    const { validateSmokeSafety } = (await import("../tools/foundry-smoke/safety.mjs")) as {
      validateSmokeSafety(args: { allowDestructive: boolean; expectedWorldId: string; keepActors: boolean }): {
        allowDestructive: boolean;
        expectedWorldId: string;
      };
    };

    expect(
      validateSmokeSafety({
        allowDestructive: false,
        expectedWorldId: "",
        keepActors: true,
      })
    ).toEqual({
      allowDestructive: false,
      expectedWorldId: "",
    });
  });

  it("requires explicit destructive opt-in before cleanup/deletion", async () => {
    const { validateSmokeSafety } = (await import("../tools/foundry-smoke/safety.mjs")) as {
      validateSmokeSafety(args: { allowDestructive: boolean; expectedWorldId: string; keepActors: boolean }): unknown;
    };

    expect(() =>
      validateSmokeSafety({
        allowDestructive: false,
        expectedWorldId: "test-world",
        keepActors: false,
      })
    ).toThrow(/FOUNDRY_SMOKE_ALLOW_DESTRUCTIVE=1/);
  });

  it("requires an expected world id for destructive runs", async () => {
    const { validateSmokeSafety } = (await import("../tools/foundry-smoke/safety.mjs")) as {
      validateSmokeSafety(args: { allowDestructive: boolean; expectedWorldId: string; keepActors: boolean }): unknown;
    };

    expect(() =>
      validateSmokeSafety({
        allowDestructive: true,
        expectedWorldId: "",
        keepActors: false,
      })
    ).toThrow(/FOUNDRY_SMOKE_WORLD_ID/);
  });

  it("requires destructive opt-in and an expected world before changing Free Archetype", async () => {
    const { validateSmokeSafety } = (await import("../tools/foundry-smoke/safety.mjs")) as {
      validateSmokeSafety(args: {
        allowDestructive: boolean;
        expectedWorldId: string;
        freeArchetypeMode: string;
        keepActors: boolean;
      }): unknown;
    };

    expect(() =>
      validateSmokeSafety({
        allowDestructive: false,
        expectedWorldId: "testing-world",
        freeArchetypeMode: "on",
        keepActors: true,
      })
    ).toThrow("required to change the Free Archetype world setting");
    expect(() =>
      validateSmokeSafety({
        allowDestructive: true,
        expectedWorldId: "",
        freeArchetypeMode: "off",
        keepActors: true,
      })
    ).toThrow("FOUNDRY_SMOKE_WORLD_ID is required");
  });

  it("rejects mismatched Foundry worlds", async () => {
    const { assertExpectedWorldId } = (await import("../tools/foundry-smoke/safety.mjs")) as {
      assertExpectedWorldId(args: { actualWorldId: string; expectedWorldId: string }): void;
    };

    expect(() => assertExpectedWorldId({ actualWorldId: "wrong-world", expectedWorldId: "target-world" })).toThrow(
      /target-world/
    );
    expect(() =>
      assertExpectedWorldId({ actualWorldId: "target-world", expectedWorldId: "target-world" })
    ).not.toThrow();
  });
});
