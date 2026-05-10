import { describe, expect, it } from "vitest";
import { inspectActor } from "../src/actor-inspector";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import { buildWayfinderAppPlan } from "../src/wayfinder/application/wayfinder-plan-builder-service";

describe("wayfinder level-up depth", () => {
  it("plans rogue level 2-5 skill feat cadence without letting level 1 consume level 2", async () => {
    const classDocument = rogueClassDocument();
    const actor = actorWithItems([
      singletonItem("ancestry", "Human"),
      singletonItem("heritage", "Versatile Human"),
      singletonItem("background", "Acolyte"),
      singletonItem("class", "Rogue", classDocument.system),
      featItem("Cooperative Nature", "ancestry", "ancestry-feat-level-1"),
      featItem("Nimble Dodge", "class", "class-feat-level-1"),
      featItem("Experienced Smuggler", "skill", "skill-feat-level-1"),
    ]);
    const draft = createEmptyDraft(5);

    const plan = await buildPlan(actor, classDocument, draft);

    expect(slotIds(plan, "skill-feat")).toEqual([
      "skill-feat-level-2",
      "skill-feat-level-3",
      "skill-feat-level-4",
      "skill-feat-level-5",
    ]);
    expect(slotIds(plan, "class-feat")).toEqual(["class-feat-level-2", "class-feat-level-4"]);
    expect(slotIds(plan, "general-feat")).toEqual(["general-feat-level-3"]);
    expect(slotIds(plan, "skill-increase")).toEqual(["skill-increase-level-3", "skill-increase-level-5"]);
    expect(slotIds(plan, "ability-boosts")).toEqual(["ability-boosts-level-5"]);
  });

  it("uses PF2E feat slots to skip already-filled native level-up slots", async () => {
    const classDocument = rogueClassDocument();
    const actor = {
      ...actorWithItems([
        singletonItem("ancestry", "Human"),
        singletonItem("heritage", "Versatile Human"),
        singletonItem("background", "Acolyte"),
        singletonItem("class", "Rogue", classDocument.system),
      ]),
      feats: {
        skill: {
          slots: {
            level1: { level: 1, feat: {} },
            level2: { level: 2, feat: {} },
          },
        },
        class: {
          slots: {
            level1: { level: 1, feat: {} },
          },
        },
      },
    };
    const draft = createEmptyDraft(4);

    const plan = await buildPlan(actor, classDocument, draft);

    expect(slotIds(plan, "skill-feat")).toEqual(["skill-feat-level-3", "skill-feat-level-4"]);
    expect(slotIds(plan, "class-feat")).toEqual(["class-feat-level-2", "class-feat-level-4"]);
  });
});

async function buildPlan(actor: unknown, classDocument: Record<string, unknown>, draft = createEmptyDraft(1)) {
  return buildWayfinderAppPlan({
    actor: actor as never,
    snapshot: inspectActor(actor),
    draft,
    resolveDocument: async (itemType) => (itemType === "class" ? classDocument : null),
    resolveArcaneSchoolDocument: async () => null,
    localize: (value) => value,
  });
}

function slotIds(plan: { steps: PendingStep[] }, slotKind: PendingStep["slotKind"]): string[] {
  return plan.steps.filter((step) => step.slotKind === slotKind).map((step) => step.slotId);
}

function actorWithItems(items: unknown[]) {
  return {
    system: {
      details: {
        level: {
          value: 1,
        },
      },
      build: {
        attributes: {
          boosts: {
            1: ["str", "dex", "con", "wis"],
            5: [],
            10: [],
            15: [],
            20: [],
          },
        },
      },
    },
    items: {
      contents: items,
    },
  };
}

function singletonItem(type: string, name: string, system: Record<string, unknown> = {}) {
  return {
    id: `${type}-1`,
    type,
    name,
    system,
  };
}

function featItem(name: string, featType: string, slotId: string) {
  return {
    id: slotId,
    type: "feat",
    name,
    system: {
      featType: {
        value: featType,
      },
    },
    flags: {
      [MODULE_ID]: {
        slotId,
      },
    },
  };
}

function rogueClassDocument() {
  return {
    name: "Rogue",
    type: "class",
    system: {
      slug: "rogue",
      classFeatLevels: {
        value: [1, 2, 4, 6, 8, 10],
      },
      skillFeatLevels: {
        value: [1, 2, 3, 4, 5, 6, 7, 8],
      },
      items: {},
    },
  };
}
