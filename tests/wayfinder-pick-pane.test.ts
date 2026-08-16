import { beforeEach, describe, expect, it } from "vitest";
import { clearPackServiceCache } from "../src/pack/access";
import type { OptionRecord } from "../src/types";
import { buildPreview, buildPreviewDisclosure, DEDICATION_SUPPORT_DISCLOSURE } from "../src/wayfinder/panes/pick-pane";

const globals = globalThis as typeof globalThis & { game?: unknown };

describe("wayfinder pick pane", () => {
  beforeEach(() => {
    clearPackServiceCache();
    globals.game = {
      packs: new Map(),
    };
  });

  it("adds an honest manual-setup notice to dedication previews even when the document cannot hydrate", async () => {
    const preview = await buildPreview(option({ traits: ["archetype", "dedication", "multiclass"] }), "");

    expect(preview?.disclosure).toBe(DEDICATION_SUPPORT_DISCLOSURE);
  });

  it("preserves a specific PF2E follow-up disclosure before the general dedication notice", () => {
    expect(buildPreviewDisclosure("PF2E will ask you to choose an emotion when this is applied.", ["Dedication"])).toBe(
      `PF2E will ask you to choose an emotion when this is applied. ${DEDICATION_SUPPORT_DISCLOSURE}`
    );
    expect(buildPreviewDisclosure("Existing notice", ["general"])).toBe("Existing notice");
    expect(buildPreviewDisclosure(null, ["general"])).toBeNull();
  });
});

function option(overrides: Partial<OptionRecord> = {}): OptionRecord {
  return {
    value: "pf2e.feats-srd:Tt6WVxyR4YjmvZLO",
    packId: "pf2e.feats-srd",
    documentId: "Tt6WVxyR4YjmvZLO",
    uuid: "Compendium.pf2e.feats-srd.Item.Tt6WVxyR4YjmvZLO",
    img: "necromancer-dedication.webp",
    itemType: "feat",
    featType: "class",
    name: "Necromancer Dedication",
    level: 2,
    slug: "necromancer-dedication",
    traits: ["archetype", "dedication", "multiclass"],
    rarity: "common",
    source: "Pathfinder Impossible Magic",
    label: "Necromancer Dedication (Level 2)",
    disclosure: null,
    ...overrides,
  };
}
