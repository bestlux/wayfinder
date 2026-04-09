import { beforeEach, describe, expect, it } from "vitest";
import { clearPackServiceCache, getOptionsForStep, getPickerBlockedState, getPickerInfoState } from "../src/pack-service";
import type { OptionContext, PendingStep } from "../src/types";

const EMPTY_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: null,
  hasDedicationFeat: false
};

describe("pack-service dependency filtering", () => {
  beforeEach(() => {
    clearPackServiceCache();
    globalThis.CONFIG = {
      PF2E: {
        ancestryTraits: {
          human: "Human",
          dhampir: "Dhampir",
          sarangay: "Sarangay",
          gnoll: "Gnoll",
          grippli: "Grippli"
        },
        classTraits: {
          fighter: "Fighter",
          cleric: "Cleric",
          barbarian: "Barbarian"
        }
      }
    } as any;
    globalThis.game = {
      packs: new Map(),
      settings: {
        get: () => ""
      }
    } as any;
  });

  it("filters heritages to the drafted ancestry plus versatile heritages", async () => {
    setPack("pf2e.heritages", [
      heritageEntry("ancient-elf", "Ancient Elf", "elf"),
      heritageEntry("ancient-blooded-dwarf", "Ancient-Blooded Dwarf", "dwarf"),
      heritageEntry("changeling", "Changeling", null)
    ]);

    const options = await getOptionsForStep(makeStep("heritage", {
      itemType: "heritage"
    }), {
      ...EMPTY_CONTEXT,
      ancestrySlug: "elf",
      ancestryTraits: ["elf"]
    });

    expect(options.map((option) => option.name)).toEqual(["Ancient Elf", "Changeling"]);
  });

  it("filters ancestry feats from drafted ancestry and versatile heritage traits even when pack slugs are missing", async () => {
    setPack("pf2e.ancestries", [
      ancestryEntry("human", "Human", false),
      ancestryEntry("sarangay", "Sarangay", false)
    ]);
    setPack("pf2e.heritages", [
      heritageEntry("dhampir", "Dhampir", null, false)
    ]);
    setPack("pf2e.feats-srd", [
      featEntry("cooperative-nature", "Cooperative Nature", "ancestry", ["human"], false),
      featEntry("fanged-blood", "Fanged Blood", "ancestry", ["dhampir"], false),
      featEntry("wilderness-born", "Wilderness Born", "ancestry", [], false),
      featEntry("sky-herd-guard", "Sky Herd Guard", "ancestry", ["sarangay"], false),
      featEntry("bog-sprint", "Bog Sprint", "ancestry", ["grippli"], false),
      featEntry("pack-stalker", "Pack Stalker", "ancestry", ["gnoll"], false)
    ]);

    const options = await getOptionsForStep(makeStep("ancestry-feat", {
      itemType: "feat",
      featTypes: ["ancestry"],
      maxLevel: 1
    }), {
      ancestrySlug: "human",
      ancestryTraits: ["human"],
      heritageTraits: ["dhampir"],
      classSlug: null,
      hasDedicationFeat: false
    });

    expect(options.map((option) => option.name)).toEqual([
      "Cooperative Nature",
      "Fanged Blood",
      "Wilderness Born"
    ]);
  });

  it("filters class feats to the drafted class plus dedication feats before the actor has a dedication", async () => {
    setPack("pf2e.classes", [
      classEntry("fighter", "Fighter"),
      classEntry("cleric", "Cleric")
    ]);
    setPack("pf2e.feats-srd", [
      featEntry("combat-flexibility", "Combat Flexibility", "class", ["fighter"]),
      featEntry("sudden-charge", "Sudden Charge", "class", ["barbarian", "fighter"]),
      featEntry("cleric-doctrine", "Cleric Doctrine", "class", ["cleric"]),
      featEntry("acrobat-dedication", "Acrobat Dedication", "archetype", ["archetype", "dedication"]),
      featEntry("advanced-maneuver", "Advanced Maneuver", "archetype", ["archetype"])
    ]);

    const options = await getOptionsForStep(makeStep("class-feat", {
      itemType: "feat",
      featTypes: ["class", "archetype"],
      maxLevel: 2
    }), {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: false
    });

    expect(options.map((option) => option.name)).toEqual([
      "Acrobat Dedication",
      "Combat Flexibility",
      "Sudden Charge"
    ]);
  });

  it("filters class feats to archetype follow-up feats after a dedication is already present", async () => {
    setPack("pf2e.classes", [
      classEntry("fighter", "Fighter"),
      classEntry("cleric", "Cleric")
    ]);
    setPack("pf2e.feats-srd", [
      featEntry("combat-flexibility", "Combat Flexibility", "class", ["fighter"]),
      featEntry("acrobat-dedication", "Acrobat Dedication", "archetype", ["archetype", "dedication"]),
      featEntry("advanced-maneuver", "Advanced Maneuver", "archetype", ["archetype"]),
      featEntry("cleric-doctrine", "Cleric Doctrine", "class", ["cleric"])
    ]);

    const options = await getOptionsForStep(makeStep("class-feat", {
      itemType: "feat",
      featTypes: ["class", "archetype"],
      maxLevel: 2
    }), {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true
    });

    expect(options.map((option) => option.name)).toEqual([
      "Acrobat Dedication",
      "Advanced Maneuver",
      "Combat Flexibility"
    ]);
  });

  it("excludes unrelated class-category feats that do not match the drafted class or archetype path", async () => {
    setPack("pf2e.classes", [
      classEntry("fighter", "Fighter")
    ]);
    setPack("pf2e.feats-srd", [
      featEntry("combat-flexibility", "Combat Flexibility", "class", ["fighter"]),
      featEntry("mythic-destiny", "Mythic Destiny", "class", ["mythic", "destiny"])
    ]);

    const options = await getOptionsForStep(makeStep("class-feat", {
      itemType: "feat",
      featTypes: ["class", "archetype"],
      maxLevel: 12
    }), {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: false
    });

    expect(options.map((option) => option.name)).toEqual([
      "Combat Flexibility"
    ]);
  });

  it("hides archetype-tagged skill feats from generic skill-feat steps", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("battle-medicine", "Battle Medicine", "skill", ["healing"]),
      featEntry("engine-bay", "Engine Bay", "skill", ["archetype", "vehicle-mechanic"])
    ]);

    const options = await getOptionsForStep(makeStep("skill-feat", {
      itemType: "feat",
      featTypes: ["skill"],
      maxLevel: 2
    }), EMPTY_CONTEXT);

    expect(options.map((option) => option.name)).toEqual([
      "Battle Medicine"
    ]);
  });

  it("distinguishes blocked, empty-source, and search-empty picker states", () => {
    const heritageStep = makeStep("heritage", {
      itemType: "heritage"
    });

    expect(getPickerBlockedState(heritageStep, EMPTY_CONTEXT)?.tone).toBe("blocked");
    expect(getPickerInfoState(heritageStep, EMPTY_CONTEXT, 0, 0, "")?.tone).toBe("blocked");
    expect(getPickerInfoState(heritageStep, {
      ...EMPTY_CONTEXT,
      ancestrySlug: "elf",
      ancestryTraits: ["elf"]
    }, 0, 0, "")?.tone).toBe("empty");
    expect(getPickerInfoState(heritageStep, {
      ...EMPTY_CONTEXT,
      ancestrySlug: "elf",
      ancestryTraits: ["elf"]
    }, 2, 0, "zzz")?.tone).toBe("search");
  });
});

function makeStep(slotKind: PendingStep["slotKind"], filters: PendingStep["filters"]): PendingStep {
  return {
    id: `${slotKind}-level-1`,
    level: 1,
    kind: "pick-item",
    slotKind,
    title: "Test Step",
    description: "Test description",
    required: true,
    slotId: `${slotKind}-level-1`,
    filters
  };
}

function setPack(id: string, entries: any[]): void {
  globalThis.game.packs.set(id, {
    metadata: { id },
    getIndex: async () => entries
  });
}

function heritageEntry(slug: string, name: string, ancestrySlug: string | null, includeSlug = true): any {
  return {
    _id: slug,
    name,
    img: `${slug}.webp`,
    type: "heritage",
    system: {
      ...(includeSlug ? { slug } : {}),
      ancestry: ancestrySlug ? { slug: ancestrySlug } : null,
      traits: {
        rarity: "common",
        value: ancestrySlug ? [ancestrySlug] : [slug]
      },
      publication: {
        title: "Player Core"
      }
    }
  };
}

function ancestryEntry(slug: string, name: string, includeSlug = true): any {
  return {
    _id: slug,
    name,
    img: `${slug}.webp`,
    type: "ancestry",
    system: {
      ...(includeSlug ? { slug } : {}),
      traits: {
        rarity: "common",
        value: [slug]
      },
      publication: {
        title: "Player Core"
      }
    }
  };
}

function classEntry(slug: string, name: string): any {
  return {
    _id: slug,
    name,
    img: `${slug}.webp`,
    type: "class",
    system: {
      slug,
      publication: {
        title: "Player Core"
      }
    }
  };
}

function featEntry(slug: string, name: string, featType: string, traits: string[], includeFeatType = true): any {
  const category = featType === "ancestry" || featType === "class" || featType === "skill"
    ? featType
    : "class";
  return {
    _id: slug,
    name,
    img: `${slug}.webp`,
    type: "feat",
    system: {
      slug,
      category,
      ...(includeFeatType
        ? {
            featType: {
              value: featType
            }
          }
        : {}),
      level: {
        value: 1
      },
      traits: {
        rarity: "common",
        value: traits
      },
      publication: {
        title: "Player Core"
      }
    }
  };
}
