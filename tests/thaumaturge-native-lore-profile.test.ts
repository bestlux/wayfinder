import { describe, expect, it } from "vitest";
import {
  projectThaumaturgeNativeLoreExpectation,
  thaumaturgeNativeLoreSourceSelection,
} from "../src/actor-updater/thaumaturge-native-lore-profile";
import type { EmbeddedItemSource } from "../src/shared/actor-model";
import {
  THAUMATURGE_NATIVE_LORE_CLASS_UUID,
  THAUMATURGE_NATIVE_LORE_UUID,
  thaumaturgeLoreClassSource,
  thaumaturgeLoreFeatureSource,
} from "./fixtures/thaumaturge-native-lore";

function project(loreDocument = thaumaturgeLoreFeatureSource(), currentActorLevel: unknown = 1) {
  return projectThaumaturgeNativeLoreExpectation({
    sourceId: THAUMATURGE_NATIVE_LORE_CLASS_UUID,
    document: thaumaturgeLoreClassSource(),
    loreDocument,
    currentActorLevel,
  });
}

describe("reviewed Thaumaturge native Lore expectation", () => {
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
  ])("current actor level %i expects native Esoteric Lore rank %i", (level, rank) => {
    expect(project(thaumaturgeLoreFeatureSource(), level)).toEqual([
      { slug: "esoteric-lore", rank, sourceId: THAUMATURGE_NATIVE_LORE_UUID },
    ]);
  });

  it("preserves older item-based Lore behavior and does not mutate either source", () => {
    const document = thaumaturgeLoreClassSource();
    const loreDocument = thaumaturgeLoreFeatureSource("8.5.1");
    const original = structuredClone({ document, loreDocument });
    expect(
      projectThaumaturgeNativeLoreExpectation({
        sourceId: THAUMATURGE_NATIVE_LORE_CLASS_UUID,
        document,
        loreDocument,
        currentActorLevel: undefined,
      })
    ).toEqual([]);
    expect({ document, loreDocument }).toEqual(original);
    expect(Object.isFrozen(project())).toBe(true);
    expect(Object.isFrozen(project()[0])).toBe(true);
  });

  it("recognizes canonical name aliases and native grant annotations without weakening the skill rule", () => {
    const document = thaumaturgeLoreClassSource();
    (document.system!.items as Record<string, Record<string, unknown>>)["7qJbx"].uuid =
      "Compendium.pf2e.classfeatures.Item.Esoteric Lore";
    expect(thaumaturgeNativeLoreSourceSelection({ sourceId: THAUMATURGE_NATIVE_LORE_CLASS_UUID, document })?.uuid).toBe(
      THAUMATURGE_NATIVE_LORE_UUID
    );
    const loreDocument = thaumaturgeLoreFeatureSource();
    Object.assign(loreDocument.system!.rules![0], { flag: "dubiousKnowledge", allowDuplicate: true });
    expect(project(loreDocument)).toHaveLength(1);
  });

  it("does not authorize another class or compendium", () => {
    for (const sourceId of [
      "Compendium.third-party.classes.Item.Y5GsHqzCzJlKka6x",
      "Compendium.pf2e.classes.Item.fighter",
    ]) {
      expect(
        projectThaumaturgeNativeLoreExpectation({
          sourceId,
          document: thaumaturgeLoreClassSource(),
          loreDocument: thaumaturgeLoreFeatureSource(),
          currentActorLevel: 1,
        })
      ).toEqual([]);
    }
  });

  it.each([
    [
      "conditional rule",
      (doc: EmbeddedItemSource) => {
        doc.system!.rules![1].predicate = ["class:thaumaturge"];
      },
    ],
    [
      "wrong path",
      (doc: EmbeddedItemSource) => {
        doc.system!.rules![1].path = "system.skills.esoteric-lore.rank";
      },
    ],
    [
      "wrong mode",
      (doc: EmbeddedItemSource) => {
        doc.system!.rules![1].mode = "upgrade";
      },
    ],
    [
      "changed formula",
      (doc: EmbeddedItemSource) => {
        (doc.system!.rules![1].value as Record<string, unknown>).rank = "@actor.level";
      },
    ],
    [
      "changed attribute",
      (doc: EmbeddedItemSource) => {
        (doc.system!.rules![1].value as Record<string, unknown>).attribute = "int";
      },
    ],
    [
      "changed label",
      (doc: EmbeddedItemSource) => {
        (doc.system!.rules![1].value as Record<string, unknown>).label = "Other Lore";
      },
    ],
    [
      "extra value",
      (doc: EmbeddedItemSource) => {
        (doc.system!.rules![1].value as Record<string, unknown>).lore = true;
      },
    ],
    [
      "extra rule",
      (doc: EmbeddedItemSource) => {
        doc.system!.rules!.push({ key: "RollOption", option: "extra" });
      },
    ],
    [
      "conditional grant",
      (doc: EmbeddedItemSource) => {
        doc.system!.rules![0].predicate = ["feat:extra"];
      },
    ],
    [
      "different grant",
      (doc: EmbeddedItemSource) => {
        doc.system!.rules![0].uuid = "Compendium.pf2e.feats-srd.Item.extra";
      },
    ],
    [
      "wrong type",
      (doc: EmbeddedItemSource) => {
        doc.type = "class";
      },
    ],
    [
      "wrong slug",
      (doc: EmbeddedItemSource) => {
        doc.system!.slug = "warfare-lore";
      },
    ],
    [
      "wrong category",
      (doc: EmbeddedItemSource) => {
        doc.system!.category = "skill";
      },
    ],
    [
      "wrong level",
      (doc: EmbeddedItemSource) => {
        doc.system!.level!.value = 2;
      },
    ],
  ] as const)("rejects %s before authorizing native ranks", (_label, mutate) => {
    const doc = thaumaturgeLoreFeatureSource();
    mutate(doc);
    expect(() => project(doc)).toThrow("Thaumaturge native Esoteric Lore changed");
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
  ])("rejects unreviewed level %s", (level) => {
    expect(() =>
      projectThaumaturgeNativeLoreExpectation({
        sourceId: THAUMATURGE_NATIVE_LORE_CLASS_UUID,
        document: thaumaturgeLoreClassSource(),
        loreDocument: thaumaturgeLoreFeatureSource(),
        currentActorLevel: level,
      })
    ).toThrow("Thaumaturge native Esoteric Lore changed");
  });

  it("rejects a conditional, moved, or duplicated recognized class grant", () => {
    for (const change of [
      (link: Record<string, unknown>) => {
        link.predicate = ["extra"];
      },
      (link: Record<string, unknown>) => {
        link.level = 2;
      },
    ]) {
      const document = thaumaturgeLoreClassSource();
      change((document.system!.items as Record<string, Record<string, unknown>>)["7qJbx"]);
      expect(() =>
        thaumaturgeNativeLoreSourceSelection({ sourceId: THAUMATURGE_NATIVE_LORE_CLASS_UUID, document })
      ).toThrow("Thaumaturge native Esoteric Lore changed");
    }
    const document = thaumaturgeLoreClassSource();
    const items = document.system!.items as Record<string, Record<string, unknown>>;
    items.duplicate = { ...items["7qJbx"] };
    expect(() =>
      thaumaturgeNativeLoreSourceSelection({ sourceId: THAUMATURGE_NATIVE_LORE_CLASS_UUID, document })
    ).toThrow("Thaumaturge native Esoteric Lore changed");
  });
});
