import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import {
  materializedPhysicalItemSize,
  prepareTransientDraftedEquipmentActor,
  resolvePreparedDraftedEquipmentSize,
} from "../src/wayfinder/application/equipment-size-preparation-service";

const ANCESTRY_UUID = "Compendium.pf2e.ancestries.Item.automaton";
const HERITAGE_UUID = "Compendium.pf2e.heritages.Item.littlehorn";

describe("equipment drafted-size preparation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["tiny", "tiny"],
    ["small", "med"],
    ["medium", "med"],
    ["large", "lg"],
    ["huge", "huge"],
    ["gargantuan", "grg"],
  ] as const)("materializes logical %s equipment at PF2E item size %s", (logicalSize, itemSize) => {
    expect(materializedPhysicalItemSize(logicalSize)).toBe(itemSize);
  });

  it("stamps an ancestry ChoiceSet selection before reading prepared actor size", async () => {
    vi.stubGlobal("CONFIG", { Actor: { documentClass: PreparedSizeActor } });
    const draft = draftedAncestry();
    draft.singletonChoices["singleton-choice-ancestry-automaton-size-level-1"] = "small";

    await expect(
      resolvePreparedDraftedEquipmentSize({
        actor: blankActor(),
        draft,
        targetLevel: 1,
        fetchDocumentByUuid: async (uuid) => (uuid === ANCESTRY_UUID ? document(automaton()) : null),
        prepareDraftedActor: prepareTransientDraftedEquipmentActor,
      })
    ).resolves.toBe("small");
  });

  it("lets a prepared heritage CreatureSize override the selected ancestry size", async () => {
    vi.stubGlobal("CONFIG", { Actor: { documentClass: PreparedSizeActor } });
    const draft = draftedAncestry();
    draft.singletonChoices["singleton-choice-ancestry-automaton-size-level-1"] = "small";
    draft.selections["heritage-level-1"] = {
      slotId: "heritage-level-1",
      packId: "pf2e.heritages",
      documentId: "littlehorn",
      uuid: HERITAGE_UUID,
      itemType: "heritage",
      featType: null,
      name: "Littlehorn Minotaur",
      level: 0,
    };

    await expect(
      resolvePreparedDraftedEquipmentSize({
        actor: blankActor(),
        draft,
        targetLevel: 1,
        fetchDocumentByUuid: async (uuid) =>
          uuid === ANCESTRY_UUID ? document(automaton()) : uuid === HERITAGE_UUID ? document(littlehorn()) : null,
        prepareDraftedActor: prepareTransientDraftedEquipmentActor,
      })
    ).resolves.toBe("medium");
  });

  it("prefers PF2E prepared naturalSize for Plane-Hopper equipment sizing", async () => {
    const draft = draftedAncestry();

    await expect(
      resolvePreparedDraftedEquipmentSize({
        actor: blankActor(),
        draft,
        targetLevel: 1,
        fetchDocumentByUuid: async () => null,
        prepareDraftedActor: async () => ({
          system: { traits: { size: { value: "med" }, naturalSize: "lg" } },
        }),
      })
    ).resolves.toBe("large");
  });

  it("uses Awakened Animal's structured size choice for authoritative equipment sizing", async () => {
    vi.stubGlobal("CONFIG", { Actor: { documentClass: PreparedSizeActor } });
    const draft = draftedAncestry();
    draft.selections["ancestry-level-1"] = {
      ...draft.selections["ancestry-level-1"]!,
      documentId: "awakened-animal",
      uuid: "Compendium.pf2e.ancestries.Item.awakened-animal",
      name: "Awakened Animal",
    };
    draft.singletonChoices["singleton-choice-ancestry-awakened-animal-choice-level-1"] = "tiny";

    await expect(
      resolvePreparedDraftedEquipmentSize({
        actor: blankActor(),
        draft,
        targetLevel: 1,
        fetchDocumentByUuid: async () => document(awakenedAnimal()),
        prepareDraftedActor: prepareTransientDraftedEquipmentActor,
      })
    ).resolves.toBe("tiny");
  });
});

class PreparedSizeActor {
  readonly size: string;
  readonly system: { readonly traits: { readonly size: { readonly value: string } } };

  constructor(source: { readonly items?: readonly Record<string, any>[] }) {
    let size = "med";
    for (const item of source.items ?? []) {
      const selected = item.flags?.pf2e?.rulesSelections?.size;
      if (item.type === "ancestry" && typeof selected === "string") size = selected;
      const structuredChoice = item.flags?.pf2e?.rulesSelections?.choice;
      if (item.type === "ancestry" && typeof structuredChoice?.size === "string") size = structuredChoice.size;
      const creatureSize = item.system?.rules?.find((rule: Record<string, unknown>) => rule.key === "CreatureSize");
      if (item.type === "heritage" && typeof creatureSize?.value === "string") size = creatureSize.value;
    }
    this.size = size;
    this.system = { traits: { size: { value: size } } };
  }
}

function draftedAncestry() {
  const draft = createEmptyDraft(1);
  draft.selections["ancestry-level-1"] = {
    slotId: "ancestry-level-1",
    packId: "pf2e.ancestries",
    documentId: "automaton",
    uuid: ANCESTRY_UUID,
    itemType: "ancestry",
    featType: null,
    name: "Automaton",
    level: 0,
  };
  return draft;
}

function automaton() {
  return {
    _id: "automaton",
    type: "ancestry",
    system: {
      slug: "automaton",
      size: "med",
      rules: [{ key: "ChoiceSet", flag: "size", choices: ["small", "medium"] }],
    },
  };
}

function awakenedAnimal() {
  return {
    _id: "awakened-animal",
    type: "ancestry",
    system: {
      slug: "awakened-animal",
      size: "med",
      rules: [
        {
          key: "ChoiceSet",
          flag: "choice",
          choices: [
            { label: "Large", value: { hitPoints: 10, size: "large" } },
            { label: "Medium", value: { hitPoints: 8, size: "medium" } },
            { label: "Small", value: { hitPoints: 6, size: "small" } },
            { label: "Tiny", value: { hitPoints: 6, size: "tiny" } },
          ],
        },
        { key: "CreatureSize", value: "{item|flags.system.rulesSelections.choice.size}" },
        {
          key: "ActiveEffectLike",
          mode: "upgrade",
          path: "system.attributes.ancestryhp",
          priority: 51,
          value: "{item|flags.system.rulesSelections.choice.hitPoints}",
        },
      ],
    },
  };
}

function littlehorn() {
  return {
    _id: "littlehorn",
    type: "heritage",
    system: { slug: "littlehorn-minotaur", rules: [{ key: "CreatureSize", value: "med" }] },
  };
}

function document(source: Record<string, unknown>) {
  return { toObject: () => structuredClone(source) };
}

function blankActor() {
  return {
    toObject: () => ({
      _id: "actor-1",
      name: "Blank",
      type: "character",
      system: { details: { level: { value: 1 } } },
    }),
  };
}
