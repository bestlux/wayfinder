import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPackServiceCache,
  getOptionsForStep,
  getPickerBlockedState,
  getPickerInfoState,
} from "../src/pack-service";
import type { OptionContext, PendingStep, PickItemSlotKind } from "../src/types";
import { createPickItemStep } from "../src/wayfinder/domain/step-types";

const testGlobals = globalThis as typeof globalThis & { CONFIG: any; game: any };

const EMPTY_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: null,
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: false,
};

describe("pack-service dependency filtering", () => {
  beforeEach(() => {
    clearPackServiceCache();
    testGlobals.CONFIG = {
      PF2E: {
        ancestryTraits: {
          human: "Human",
          dhampir: "Dhampir",
          sarangay: "Sarangay",
          gnoll: "Gnoll",
          grippli: "Grippli",
        },
        classTraits: {
          fighter: "Fighter",
          cleric: "Cleric",
          barbarian: "Barbarian",
        },
      },
    } as any;
    testGlobals.game = {
      packs: new Map(),
      settings: {
        get: () => "",
      },
    } as any;
  });

  it("filters heritages to the drafted ancestry plus versatile heritages", async () => {
    setPack("pf2e.heritages", [
      heritageEntry("ancient-elf", "Ancient Elf", "elf"),
      heritageEntry("ancient-blooded-dwarf", "Ancient-Blooded Dwarf", "dwarf"),
      heritageEntry("changeling", "Changeling", null),
    ]);

    const options = await getOptionsForStep(
      makeStep("heritage", {
        itemType: "heritage",
      }),
      {
        ...EMPTY_CONTEXT,
        ancestrySlug: "elf",
        ancestryTraits: ["elf"],
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Ancient Elf", "Changeling"]);
  });

  it("filters ancestry feats from drafted ancestry and versatile heritage traits even when pack slugs are missing", async () => {
    setPack("pf2e.ancestries", [ancestryEntry("human", "Human", false), ancestryEntry("sarangay", "Sarangay", false)]);
    setPack("pf2e.heritages", [heritageEntry("dhampir", "Dhampir", null, false)]);
    setPack("pf2e.feats-srd", [
      featEntry("cooperative-nature", "Cooperative Nature", "ancestry", ["human"], false),
      featEntry("fanged-blood", "Fanged Blood", "ancestry", ["dhampir"], false),
      featEntry("wilderness-born", "Wilderness Born", "ancestry", [], false),
      featEntry("sky-herd-guard", "Sky Herd Guard", "ancestry", ["sarangay"], false),
      featEntry("bog-sprint", "Bog Sprint", "ancestry", ["grippli"], false),
      featEntry("pack-stalker", "Pack Stalker", "ancestry", ["gnoll"], false),
    ]);

    const options = await getOptionsForStep(
      makeStep("ancestry-feat", {
        itemType: "feat",
        featTypes: ["ancestry"],
        maxLevel: 1,
      }),
      {
        ancestrySlug: "human",
        ancestryTraits: ["human"],
        heritageTraits: ["dhampir"],
        classSlug: null,
        hasDedicationFeat: false,
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Cooperative Nature", "Fanged Blood", "Wilderness Born"]);
  });

  it("normalizes explicit ancestry slugs before building the trait catalog", async () => {
    setPack("pf2e.ancestries", [
      {
        _id: "human",
        name: "Human",
        img: "human.webp",
        type: "ancestry",
        system: {
          slug: " Human ",
          traits: {
            rarity: "common",
            value: ["human"],
          },
          publication: {
            title: "Player Core",
          },
        },
      },
    ]);
    setPack("pf2e.feats-srd", [
      featEntry("cooperative-nature", "Cooperative Nature", "ancestry", ["human"], false),
      featEntry("bog-sprint", "Bog Sprint", "ancestry", ["grippli"], false),
    ]);

    const options = await getOptionsForStep(
      makeStep("ancestry-feat", {
        itemType: "feat",
        featTypes: ["ancestry"],
        maxLevel: 1,
      }),
      {
        ancestrySlug: "human",
        ancestryTraits: ["human"],
        heritageTraits: [],
        classSlug: null,
        hasDedicationFeat: false,
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Cooperative Nature"]);
  });

  it("filters class feats to the drafted class plus dedication feats before the actor has a dedication", async () => {
    setPack("pf2e.classes", [classEntry("fighter", "Fighter"), classEntry("cleric", "Cleric")]);
    setPack("pf2e.feats-srd", [
      featEntry("combat-flexibility", "Combat Flexibility", "class", ["fighter"]),
      featEntry("sudden-charge", "Sudden Charge", "class", ["barbarian", "fighter"]),
      featEntry("cleric-doctrine", "Cleric Doctrine", "class", ["cleric"]),
      featEntry("acrobat-dedication", "Acrobat Dedication", "archetype", ["archetype", "dedication"]),
      featEntry("advanced-maneuver", "Advanced Maneuver", "archetype", ["archetype"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("class-feat", {
        itemType: "feat",
        featTypes: ["class", "archetype"],
        maxLevel: 2,
      }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        hasDedicationFeat: false,
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Acrobat Dedication", "Combat Flexibility", "Sudden Charge"]);
  });

  it("filters class feats to archetype follow-up feats after a dedication is already present", async () => {
    setPack("pf2e.classes", [classEntry("fighter", "Fighter"), classEntry("cleric", "Cleric")]);
    setPack("pf2e.feats-srd", [
      featEntry("combat-flexibility", "Combat Flexibility", "class", ["fighter"]),
      featEntry("acrobat-dedication", "Acrobat Dedication", "archetype", ["archetype", "dedication"]),
      featEntry("advanced-maneuver", "Advanced Maneuver", "archetype", ["archetype"]),
      featEntry("cleric-doctrine", "Cleric Doctrine", "class", ["cleric"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("class-feat", {
        itemType: "feat",
        featTypes: ["class", "archetype"],
        maxLevel: 2,
      }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        hasDedicationFeat: true,
      }
    );

    expect(options.map((option) => option.name)).toEqual([
      "Acrobat Dedication",
      "Advanced Maneuver",
      "Combat Flexibility",
    ]);
  });

  it("excludes unrelated class-category feats that do not match the drafted class or archetype path", async () => {
    setPack("pf2e.classes", [classEntry("fighter", "Fighter")]);
    setPack("pf2e.feats-srd", [
      featEntry("combat-flexibility", "Combat Flexibility", "class", ["fighter"]),
      featEntry("mythic-destiny", "Mythic Destiny", "class", ["mythic", "destiny"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("class-feat", {
        itemType: "feat",
        featTypes: ["class", "archetype"],
        maxLevel: 12,
      }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        hasDedicationFeat: false,
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Combat Flexibility"]);
  });

  it("filters grant-choice feat options from raw ChoiceSet predicates", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("incredible-initiative", "Incredible Initiative", "general", ["general"]),
      featEntry("battle-medicine", "Battle Medicine", "skill", ["healing"]),
      featEntry("fleet", "Fleet", "general", ["general"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        predicate: ["item:level:1", "item:trait:general"],
      }),
      EMPTY_CONTEXT
    );

    expect(options.map((option) => option.name)).toEqual(["Fleet", "Incredible Initiative"]);
  });

  it("excludes the actor's own class from multiclass dedication grant choices", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("fighter-dedication", "Fighter Dedication", "class", ["fighter", "dedication", "multiclass"]),
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["wizard", "dedication", "multiclass"]),
      featEntry("rogue-dedication", "Rogue Dedication", "class", ["rogue", "dedication", "multiclass"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        predicate: ["item:category:class", "item:trait:dedication", "item:trait:multiclass"],
      }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "wizard",
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Fighter Dedication", "Rogue Dedication"]);
  });

  it("hides archetype-tagged skill feats from generic skill-feat steps", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("battle-medicine", "Battle Medicine", "skill", ["healing"]),
      featEntry("engine-bay", "Engine Bay", "skill", ["archetype", "vehicle-mechanic"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("skill-feat", {
        itemType: "feat",
        featTypes: ["skill"],
        maxLevel: 2,
      }),
      EMPTY_CONTEXT
    );

    expect(options.map((option) => option.name)).toEqual(["Battle Medicine"]);
  });

  it("filters class-branch choices to the selector tag for the drafted class", async () => {
    setPack("pf2e.classfeatures", [
      classFeatureEntry("scoundrel", "Scoundrel", ["rogue"], ["rogue-racket"]),
      classFeatureEntry("ruffian", "Ruffian", ["rogue"], ["rogue-racket"]),
      classFeatureEntry("warpriest", "Warpriest", ["cleric"], ["cleric-doctrine"]),
      classFeatureEntry("thesis-of-unity", "Thesis of Unity", ["wizard"], ["arcane-thesis"]),
    ]);

    const options = await getOptionsForStep(
      {
        id: "class-branch-rogues-racket-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Rogue's Racket",
        description: "Choose a rogue's racket.",
        required: true,
        slotId: "class-branch-rogues-racket-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-rogues-racket-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "uGuCGQvUmioFV2Bd",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.uGuCGQvUmioFV2Bd",
          selectorName: "Rogue's Racket",
          selectorRuleIndex: 0,
          flag: "roguesRacket",
          optionTag: "rogue-racket",
          classSlug: "rogue",
          dependsOn: "class",
        },
      },
      {
        ...EMPTY_CONTEXT,
        classSlug: "rogue",
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Ruffian", "Scoundrel"]);
  });

  it("filters wizard branch choices separately for arcane school and arcane thesis", async () => {
    setPack("pf2e.classfeatures", [
      classFeatureEntry("school-of-battle-magic", "School of Battle Magic", ["wizard"], ["wizard-arcane-school"]),
      classFeatureEntry(
        "school-of-unified-magical-theory",
        "School of Unified Magical Theory",
        ["wizard"],
        ["wizard-arcane-school"]
      ),
      classFeatureEntry("spell-blending", "Spell Blending", ["wizard"], ["wizard-arcane-thesis"]),
      classFeatureEntry("staff-nexus", "Staff Nexus", ["wizard"], ["wizard-arcane-thesis"]),
      classFeatureEntry("scoundrel", "Scoundrel", ["rogue"], ["rogue-racket"]),
    ]);

    const schoolOptions = await getOptionsForStep(
      {
        id: "class-branch-arcane-school-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Arcane School",
        description: "Choose an arcane school.",
        required: true,
        slotId: "class-branch-arcane-school-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-arcane-school-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "school-selector",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.school-selector",
          selectorName: "Arcane School",
          selectorRuleIndex: 0,
          flag: "arcaneSchool",
          optionTag: "wizard-arcane-school",
          classSlug: "wizard",
          dependsOn: "class",
        },
      },
      {
        ...EMPTY_CONTEXT,
        classSlug: "wizard",
      }
    );

    const thesisOptions = await getOptionsForStep(
      {
        id: "class-branch-arcane-thesis-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Arcane Thesis",
        description: "Choose an arcane thesis.",
        required: true,
        slotId: "class-branch-arcane-thesis-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-arcane-thesis-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "thesis-selector",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.thesis-selector",
          selectorName: "Arcane Thesis",
          selectorRuleIndex: 0,
          flag: "arcaneThesis",
          optionTag: "wizard-arcane-thesis",
          classSlug: "wizard",
          dependsOn: "class",
        },
      },
      {
        ...EMPTY_CONTEXT,
        classSlug: "wizard",
      }
    );

    expect(schoolOptions.map((option) => option.name)).toEqual([
      "School of Battle Magic",
      "School of Unified Magical Theory",
    ]);
    expect(thesisOptions.map((option) => option.name)).toEqual(["Spell Blending", "Staff Nexus"]);
    expect(schoolOptions.map((option) => option.uuid)).toEqual([
      "Compendium.pf2e.classfeatures.Item.school-of-battle-magic",
      "Compendium.pf2e.classfeatures.Item.school-of-unified-magical-theory",
    ]);
    expect(thesisOptions.map((option) => option.uuid)).toEqual([
      "Compendium.pf2e.classfeatures.Item.spell-blending",
      "Compendium.pf2e.classfeatures.Item.staff-nexus",
    ]);
  });

  it("filters champion causes by the effective sanctification state", async () => {
    setPack("pf2e.classfeatures", [
      classFeatureEntry("justice", "Justice", ["champion"], ["champion-cause"]),
      classFeatureEntry("liberation", "Liberation", ["champion"], ["champion-cause"]),
      classFeatureEntry("redemption", "Redemption", ["champion"], ["champion-cause", "holy"]),
      classFeatureEntry("grandeur", "Grandeur", ["champion"], ["champion-cause", "holy"]),
      classFeatureEntry("desecration", "Desecration", ["champion"], ["champion-cause", "unholy"]),
      classFeatureEntry("iniquity", "Iniquity", ["champion"], ["champion-cause", "unholy"]),
    ]);

    const step: PendingStep = {
      id: "class-branch-cause-level-1",
      level: 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: "Cause",
      description: "Choose a cause.",
      required: true,
      slotId: "class-branch-cause-level-1",
      filters: {
        itemType: "feat",
        featTypes: ["classfeature"],
        maxLevel: 1,
      },
      branch: {
        slotId: "class-branch-cause-level-1",
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: "cause",
        selectorUuid: "Compendium.pf2e.classfeatures.Item.cause",
        selectorName: "Cause",
        selectorRuleIndex: 0,
        flag: "cause",
        optionTag: "champion-cause",
        classSlug: "champion",
        dependsOn: "deity",
      },
    };

    const unresolvedOptions = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "champion",
      deitySelected: true,
      sanctification: null,
    });
    const holyOptions = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "champion",
      deitySelected: true,
      sanctification: "holy",
    });
    const unholyOptions = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "champion",
      deitySelected: true,
      sanctification: "unholy",
    });

    expect(unresolvedOptions.map((option) => option.name)).toEqual(["Justice", "Liberation"]);
    expect(holyOptions.map((option) => option.name)).toEqual(["Grandeur", "Justice", "Liberation", "Redemption"]);
    expect(unholyOptions.map((option) => option.name)).toEqual(["Desecration", "Iniquity", "Justice", "Liberation"]);
  });

  it("filters spell-choice options to legal arcane ranks and curriculum names", async () => {
    setPack("pf2e.spells-srd", [
      spellEntry("shield", "Shield", 1, ["arcane"], ["cantrip"]),
      spellEntry("force-barrage", "Force Barrage", 1, ["arcane"], []),
      spellEntry("mystic-armor", "Mystic Armor", 1, ["arcane"], []),
      spellEntry("heal", "Heal", 1, ["divine"], []),
      spellEntry("fireball", "Fireball", 3, ["arcane"], []),
    ]);

    const options = await getOptionsForStep(
      {
        id: "spell-choice-wizard-curriculum-rank-1-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Arcane school curriculum spells",
        description: "",
        required: true,
        slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: {
          slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
          sourcePackId: "pf2e.classfeatures",
          sourceDocumentId: "school-of-battle-magic",
          sourceUuid: "Compendium.pf2e.classfeatures.Item.school-of-battle-magic",
          sourceName: "School of Battle Magic",
          classSlug: "wizard",
          dependsOn: "class-branch",
          destination: {
            type: "spellbook",
            key: "wizard-arcane-prepared",
            label: "Wizard spellbook",
            entryName: "Arcane Prepared Spells",
            tradition: "arcane",
            ability: "int",
            prepared: "prepared",
          },
          count: 2,
          minRank: 1,
          maxRank: 1,
          cantrip: false,
          curriculumSpellNames: ["Force Barrage", "Mystic Armor"],
          additionalAllowedSpellNames: [],
          restrictToCommon: false,
        },
      },
      {
        ...EMPTY_CONTEXT,
        classSlug: "wizard",
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Force Barrage", "Mystic Armor"]);
  });

  it("distinguishes blocked, empty-source, and search-empty picker states", () => {
    const heritageStep = makeStep("heritage", {
      itemType: "heritage",
    });

    expect(getPickerBlockedState(heritageStep, EMPTY_CONTEXT)?.tone).toBe("blocked");
    expect(getPickerInfoState(heritageStep, EMPTY_CONTEXT, 0, 0, "")?.tone).toBe("blocked");
    expect(
      getPickerInfoState(
        heritageStep,
        {
          ...EMPTY_CONTEXT,
          ancestrySlug: "elf",
          ancestryTraits: ["elf"],
        },
        0,
        0,
        ""
      )?.tone
    ).toBe("empty");
    expect(
      getPickerInfoState(
        heritageStep,
        {
          ...EMPTY_CONTEXT,
          ancestrySlug: "elf",
          ancestryTraits: ["elf"],
        },
        2,
        0,
        "zzz"
      )?.tone
    ).toBe("search");
    expect(
      getPickerInfoState(
        heritageStep,
        {
          ...EMPTY_CONTEXT,
          ancestrySlug: "elf",
          ancestryTraits: ["elf"],
        },
        2,
        0,
        "",
        true
      )?.title
    ).toBe("No choices match current filters");
  });

  it("blocks deity-dependent class branches until a deity is chosen", () => {
    const step: PendingStep = {
      id: "class-branch-cause-level-1",
      level: 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: "Cause",
      description: "Choose a cause.",
      required: true,
      slotId: "class-branch-cause-level-1",
      filters: {
        itemType: "feat",
        featTypes: ["classfeature"],
      },
      branch: {
        slotId: "class-branch-cause-level-1",
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: "cause",
        selectorUuid: "Compendium.pf2e.classfeatures.Item.cause",
        selectorName: "Cause",
        selectorRuleIndex: 0,
        flag: "cause",
        optionTag: "champion-cause",
        classSlug: "champion",
        dependsOn: "deity",
      },
    };

    expect(
      getPickerBlockedState(step, {
        ...EMPTY_CONTEXT,
        classSlug: "champion",
        deitySelected: false,
      })?.tone
    ).toBe("blocked");
  });
});

function makeStep(slotKind: PickItemSlotKind, filters: PendingStep["filters"]): PendingStep {
  return createPickItemStep(slotKind, 1, "Test Step", "Test description", filters ?? { itemType: "feat" });
}

function setPack(id: string, entries: any[]): void {
  testGlobals.game.packs.set(id, {
    metadata: { id },
    getIndex: async () => entries,
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
        value: ancestrySlug ? [ancestrySlug] : [slug],
      },
      publication: {
        title: "Player Core",
      },
    },
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
        value: [slug],
      },
      publication: {
        title: "Player Core",
      },
    },
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
        title: "Player Core",
      },
    },
  };
}

function featEntry(slug: string, name: string, featType: string, traits: string[], includeFeatType = true): any {
  const category = featType === "ancestry" || featType === "class" || featType === "skill" ? featType : "class";
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
              value: featType,
            },
          }
        : {}),
      level: {
        value: 1,
      },
      traits: {
        rarity: "common",
        value: traits,
      },
      publication: {
        title: "Player Core",
      },
    },
  };
}

function classFeatureEntry(slug: string, name: string, traits: string[], otherTags: string[]): any {
  return {
    _id: slug,
    name,
    img: `${slug}.webp`,
    type: "feat",
    system: {
      slug,
      category: "classfeature",
      level: {
        value: 1,
      },
      traits: {
        rarity: "common",
        value: traits,
        otherTags,
      },
      publication: {
        title: "Player Core",
      },
    },
  };
}

function spellEntry(slug: string, name: string, level: number, traditions: string[], traits: string[]): any {
  return {
    _id: slug,
    name,
    img: `${slug}.webp`,
    type: "spell",
    system: {
      slug,
      level: {
        value: level,
      },
      traits: {
        rarity: "common",
        traditions,
        value: traits,
      },
      publication: {
        title: "Player Core",
      },
    },
  };
}
