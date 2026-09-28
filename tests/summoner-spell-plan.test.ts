import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type * as PackAccess from "../src/pack/access";
import { fetchSelectionDocument } from "../src/pack/access";
import type { SelectionRef } from "../src/types";
import { buildWayfinderAppPlan } from "../src/wayfinder/application/wayfinder-plan-builder-service";
import { buildWayfinderPlan } from "../src/wayfinder/plan-service";
import { pf2e841AngelEidolonEntry, pf2e841DragonEidolonEntry } from "./fixtures/pf2e-841-eidolons";

vi.mock("../src/wayfinder/plan-service", () => ({ buildWayfinderPlan: vi.fn() }));
vi.mock("../src/pack/access", async (importOriginal) => ({
  ...(await importOriginal<typeof PackAccess>()),
  fetchSelectionDocument: vi.fn(),
}));

const SLOT = "class-choice-dragon-eidolon-eidolonTradition-level-1";
const classDocument = { type: "class", system: { slug: "summoner", items: {} } };
const dragon = pf2e841DragonEidolonEntry();
const angel = pf2e841AngelEidolonEntry();
function selection(doc: Record<string, unknown>): SelectionRef {
  return {
    slotId: "class-branch-eidolon-level-1",
    itemType: "feat",
    featType: "classfeature",
    packId: "pf2e.classfeatures",
    documentId: String(doc._id),
    uuid: `Compendium.pf2e.classfeatures.Item.${doc._id}`,
    name: String(doc.name),
    level: 1,
  };
}

beforeEach(() => {
  vi.mocked(buildWayfinderPlan).mockImplementation(async (snapshot, draft, deps) => ({
    recommendedTargetLevel: 4,
    targetLevel: 4,
    steps: await deps.buildSpellChoiceSteps(snapshot, draft, 4),
  }));
  vi.mocked(fetchSelectionDocument).mockImplementation(async (ref) => {
    const doc = ref.documentId === dragon._id ? dragon : ref.documentId === angel._id ? angel : null;
    return doc
      ? { ...structuredClone(doc), name: String(doc.name), img: "", toObject: () => structuredClone(doc) }
      : null;
  });
});

describe("Summoner application plan source context", () => {
  it.each([
    "system",
    "pf2e",
  ])("plans from the owned %s rule selection after the draft is cleared", async (namespace) => {
    const plan = await build(createEmptyDraft(4), namespace);
    expect(plan.steps).toHaveLength(5);
    expect(plan.steps.every((step) => step.spellChoice?.destination.tradition === "primal")).toBe(true);
  });

  it("uses a source-matched draft override instead of the owned choice", async () => {
    const draft = createEmptyDraft(4);
    draft.classChoices[SLOT] = "occult";
    const plan = await build(draft);
    expect(plan.steps.every((step) => step.spellChoice?.destination.tradition === "occult")).toBe(true);
    expect(plan.steps).toHaveLength(5);
  });

  it("uses a replacement eidolon rather than the old owned Dragon", async () => {
    const draft = createEmptyDraft(4);
    draft.branchSelections["class-branch-eidolon-level-1"] = selection(angel);
    draft.classChoices[SLOT] = "occult";
    const plan = await build(draft);
    expect(plan.steps).toHaveLength(5);
    expect(plan.steps.every((step) => step.spellChoice?.destination.tradition === "divine")).toBe(true);
  });
});

async function build(draft = createEmptyDraft(4), namespace = "system") {
  return buildWayfinderAppPlan({
    actor: {
      items: [
        {
          ...structuredClone(dragon),
          type: "feat",
          flags: {
            core: { sourceId: selection(dragon).uuid },
            [namespace]: { rulesSelections: { eidolonTradition: { skill: "nature", tradition: "primal" } } },
          },
        },
      ],
    },
    snapshot: {
      actorId: "summoner",
      level: 1,
      isBlank: false,
      freeArchetypeEnabled: false,
      campaignFeatSections: [],
      gradualBoostsEnabled: false,
      singletonSlots: { ancestry: true, heritage: true, background: true, class: true, deity: false },
      featCounts: { ancestry: 0, class: 0, archetype: 0, skill: 0, general: 0 },
      fulfilledStepIds: [],
      sourceIds: [],
      namesByType: {},
      skillRanks: {},
    },
    draft,
    resolveDocument: async (type) => (type === "class" ? classDocument : null),
    resolveArcaneSchoolDocument: async () => null,
    localize: (value) => value,
  });
}
