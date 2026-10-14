import { describe, expect, it } from "vitest";
import { projectCommanderNativeLoreExpectation } from "../src/actor-updater/commander-native-lore-profile";
import type { EmbeddedItemSource } from "../src/shared/actor-model";
import { COMMANDER_NATIVE_LORE_UUID, commanderNativeLoreSource } from "./fixtures/commander-native-lore";

function project(
  document = commanderNativeLoreSource(),
  currentActorLevel: unknown = 1,
  sourceId = COMMANDER_NATIVE_LORE_UUID
) {
  return projectCommanderNativeLoreExpectation({ document, currentActorLevel, sourceId });
}

describe("reviewed Commander native Lore expectation", () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [5, 2],
    [6, 2],
    [7, 3],
    [14, 3],
    [15, 4],
    [20, 4],
  ])("current actor level %i expects native Warfare Lore rank %i", (level, rank) => {
    expect(project(commanderNativeLoreSource(), level)).toEqual([
      { slug: "warfare-lore", rank, sourceId: COMMANDER_NATIVE_LORE_UUID },
    ]);
  });

  it("does not mutate source data and freezes the recognized expectation", () => {
    const document = commanderNativeLoreSource();
    const original = structuredClone(document);
    const result = project(document);
    expect(document).toEqual(original);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it("does not authorize a different class or compendium source", () => {
    expect(project(commanderNativeLoreSource(), 1, "Compendium.third-party.classes.Item.Oyee5Ds9uwYLEkD0")).toEqual([]);
    expect(project(commanderNativeLoreSource(), 1, "Compendium.pf2e.classes.Item.Commander")).toEqual([]);
  });

  it.each([{ rules: undefined }, { rules: [] }])("preserves earlier Commander sources without the native rule", ({
    rules,
  }) => {
    const document = commanderNativeLoreSource();
    document.system!.rules = rules;
    expect(project(document, undefined)).toEqual([]);
  });

  it.each([
    [
      "wrong type",
      (document: EmbeddedItemSource) => {
        document.type = "feat";
      },
    ],
    [
      "wrong slug",
      (document: EmbeddedItemSource) => {
        document.system!.slug = "fighter";
      },
    ],
    [
      "conditional rule",
      (document: EmbeddedItemSource) => {
        document.system!.rules![0].predicate = ["class:commander"];
      },
    ],
    [
      "changed rule mode",
      (document: EmbeddedItemSource) => {
        document.system!.rules![0].mode = "upgrade";
      },
    ],
    [
      "changed rule path",
      (document: EmbeddedItemSource) => {
        document.system!.rules![0].path = "system.skills.warfare-lore.rank";
      },
    ],
    [
      "changed formula",
      (document: EmbeddedItemSource) => {
        (document.system!.rules![0].value as Record<string, unknown>).rank = "@actor.level";
      },
    ],
    [
      "literal replacement rank",
      (document: EmbeddedItemSource) => {
        (document.system!.rules![0].value as Record<string, unknown>).rank = 1;
      },
    ],
    [
      "changed attribute",
      (document: EmbeddedItemSource) => {
        (document.system!.rules![0].value as Record<string, unknown>).attribute = "str";
      },
    ],
    [
      "changed label",
      (document: EmbeddedItemSource) => {
        (document.system!.rules![0].value as Record<string, unknown>).label = "Other Lore";
      },
    ],
    [
      "unreviewed value field",
      (document: EmbeddedItemSource) => {
        (document.system!.rules![0].value as Record<string, unknown>).lore = true;
      },
    ],
    [
      "additional rule",
      (document: EmbeddedItemSource) => {
        document.system!.rules!.push({ key: "RollOption", option: "extra" });
      },
    ],
    [
      "missing value",
      (document: EmbeddedItemSource) => {
        delete document.system!.rules![0].value;
      },
    ],
  ])("rejects %s instead of broadening the phase guard", (_label, mutate) => {
    const document = commanderNativeLoreSource();
    mutate(document);
    expect(() => project(document)).toThrow("Commander native Warfare Lore changed");
  });

  it.each([
    undefined,
    null,
    0,
    21,
    1.5,
    "1",
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects an unreviewed current actor level %s", (level) => {
    expect(() =>
      projectCommanderNativeLoreExpectation({
        document: commanderNativeLoreSource(),
        sourceId: COMMANDER_NATIVE_LORE_UUID,
        currentActorLevel: level,
      })
    ).toThrow("Commander native Warfare Lore changed");
  });
});
