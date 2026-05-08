import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectActor } from "../src/actor-inspector";
import { getEffectiveBuildState, getEffectiveSingletonDocument } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import { clearPackServiceCache, getOptionsForStep } from "../src/pack-service";
import type { DraftState, OptionContext, PendingStep, SelectionRef } from "../src/types";
import { buildWayfinderAppPlan } from "../src/wayfinder/application/wayfinder-plan-builder-service";

const testGlobals = globalThis as typeof globalThis & { CONFIG?: any; game: any };
const ALL_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const EMPTY_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: null,
  classHasSpellcasting: false,
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: false,
};

type BaselineAncestryRow = {
  id: string;
  name: string;
  source: "Player Core" | "Player Core 2";
};

type BaselineClassRow = BaselineAncestryRow & {
  keyAbility: string[];
  additionalSkills: number;
  fixedSkills: string[];
  spellcasting: boolean;
};

type HeritageRow = BaselineAncestryRow & {
  ancestryId: string;
};

const BASELINE_ANCESTRIES: BaselineAncestryRow[] = [
  { id: "dwarf", name: "Dwarf", source: "Player Core" },
  { id: "elf", name: "Elf", source: "Player Core" },
  { id: "gnome", name: "Gnome", source: "Player Core" },
  { id: "goblin", name: "Goblin", source: "Player Core" },
  { id: "halfling", name: "Halfling", source: "Player Core" },
  { id: "human", name: "Human", source: "Player Core" },
  { id: "leshy", name: "Leshy", source: "Player Core" },
  { id: "orc", name: "Orc", source: "Player Core" },
  { id: "catfolk", name: "Catfolk", source: "Player Core 2" },
  { id: "hobgoblin", name: "Hobgoblin", source: "Player Core 2" },
  { id: "kholo", name: "Kholo", source: "Player Core 2" },
  { id: "kobold", name: "Kobold", source: "Player Core 2" },
  { id: "lizardfolk", name: "Lizardfolk", source: "Player Core 2" },
  { id: "ratfolk", name: "Ratfolk", source: "Player Core 2" },
  { id: "tengu", name: "Tengu", source: "Player Core 2" },
  { id: "tripkee", name: "Tripkee", source: "Player Core 2" },
];

const BASELINE_CLASSES: BaselineClassRow[] = [
  {
    id: "bard",
    name: "Bard",
    source: "Player Core",
    keyAbility: ["cha"],
    additionalSkills: 4,
    fixedSkills: ["occultism"],
    spellcasting: true,
  },
  {
    id: "cleric",
    name: "Cleric",
    source: "Player Core",
    keyAbility: ["wis"],
    additionalSkills: 2,
    fixedSkills: ["religion"],
    spellcasting: true,
  },
  {
    id: "druid",
    name: "Druid",
    source: "Player Core",
    keyAbility: ["wis"],
    additionalSkills: 2,
    fixedSkills: ["nature"],
    spellcasting: true,
  },
  {
    id: "fighter",
    name: "Fighter",
    source: "Player Core",
    keyAbility: ["str", "dex"],
    additionalSkills: 3,
    fixedSkills: [],
    spellcasting: false,
  },
  {
    id: "ranger",
    name: "Ranger",
    source: "Player Core",
    keyAbility: ["str", "dex"],
    additionalSkills: 4,
    fixedSkills: ["survival"],
    spellcasting: false,
  },
  {
    id: "rogue",
    name: "Rogue",
    source: "Player Core",
    keyAbility: ["dex"],
    additionalSkills: 7,
    fixedSkills: ["stealth"],
    spellcasting: false,
  },
  {
    id: "witch",
    name: "Witch",
    source: "Player Core",
    keyAbility: ["int"],
    additionalSkills: 3,
    fixedSkills: ["occultism"],
    spellcasting: true,
  },
  {
    id: "wizard",
    name: "Wizard",
    source: "Player Core",
    keyAbility: ["int"],
    additionalSkills: 2,
    fixedSkills: ["arcana"],
    spellcasting: true,
  },
  {
    id: "alchemist",
    name: "Alchemist",
    source: "Player Core 2",
    keyAbility: ["int"],
    additionalSkills: 3,
    fixedSkills: ["crafting"],
    spellcasting: false,
  },
  {
    id: "barbarian",
    name: "Barbarian",
    source: "Player Core 2",
    keyAbility: ["str"],
    additionalSkills: 3,
    fixedSkills: ["athletics"],
    spellcasting: false,
  },
  {
    id: "champion",
    name: "Champion",
    source: "Player Core 2",
    keyAbility: ["str", "dex"],
    additionalSkills: 2,
    fixedSkills: ["religion"],
    spellcasting: false,
  },
  {
    id: "investigator",
    name: "Investigator",
    source: "Player Core 2",
    keyAbility: ["int"],
    additionalSkills: 4,
    fixedSkills: ["society"],
    spellcasting: false,
  },
  {
    id: "monk",
    name: "Monk",
    source: "Player Core 2",
    keyAbility: ["str", "dex"],
    additionalSkills: 4,
    fixedSkills: ["acrobatics"],
    spellcasting: false,
  },
  {
    id: "oracle",
    name: "Oracle",
    source: "Player Core 2",
    keyAbility: ["cha"],
    additionalSkills: 3,
    fixedSkills: ["religion"],
    spellcasting: true,
  },
  {
    id: "sorcerer",
    name: "Sorcerer",
    source: "Player Core 2",
    keyAbility: ["cha"],
    additionalSkills: 2,
    fixedSkills: ["arcana"],
    spellcasting: true,
  },
  {
    id: "swashbuckler",
    name: "Swashbuckler",
    source: "Player Core 2",
    keyAbility: ["dex"],
    additionalSkills: 4,
    fixedSkills: ["acrobatics"],
    spellcasting: false,
  },
];

const BASELINE_HERITAGES: HeritageRow[] = [
  { ancestryId: "dwarf", id: "ancient-blooded-dwarf", name: "Ancient-Blooded Dwarf", source: "Player Core" },
  { ancestryId: "dwarf", id: "death-warden-dwarf", name: "Death Warden Dwarf", source: "Player Core" },
  { ancestryId: "dwarf", id: "forge-dwarf", name: "Forge Dwarf", source: "Player Core" },
  { ancestryId: "dwarf", id: "rock-dwarf", name: "Rock Dwarf", source: "Player Core" },
  { ancestryId: "dwarf", id: "strong-blooded-dwarf", name: "Strong-Blooded Dwarf", source: "Player Core" },
  { ancestryId: "elf", id: "ancient-elf", name: "Ancient Elf", source: "Player Core" },
  { ancestryId: "elf", id: "arctic-elf", name: "Arctic Elf", source: "Player Core" },
  { ancestryId: "elf", id: "cavern-elf", name: "Cavern Elf", source: "Player Core" },
  { ancestryId: "elf", id: "seer-elf", name: "Seer Elf", source: "Player Core" },
  { ancestryId: "elf", id: "whisper-elf", name: "Whisper Elf", source: "Player Core" },
  { ancestryId: "elf", id: "woodland-elf", name: "Woodland Elf", source: "Player Core" },
  { ancestryId: "gnome", id: "chameleon-gnome", name: "Chameleon Gnome", source: "Player Core" },
  { ancestryId: "gnome", id: "fey-touched-gnome", name: "Fey-Touched Gnome", source: "Player Core" },
  { ancestryId: "gnome", id: "sensate-gnome", name: "Sensate Gnome", source: "Player Core" },
  { ancestryId: "gnome", id: "umbral-gnome", name: "Umbral Gnome", source: "Player Core" },
  { ancestryId: "gnome", id: "wellspring-gnome", name: "Wellspring Gnome", source: "Player Core" },
  { ancestryId: "goblin", id: "charhide-goblin", name: "Charhide Goblin", source: "Player Core" },
  { ancestryId: "goblin", id: "irongut-goblin", name: "Irongut Goblin", source: "Player Core" },
  { ancestryId: "goblin", id: "razortooth-goblin", name: "Razortooth Goblin", source: "Player Core" },
  { ancestryId: "goblin", id: "snow-goblin", name: "Snow Goblin", source: "Player Core" },
  { ancestryId: "goblin", id: "unbreakable-goblin", name: "Unbreakable Goblin", source: "Player Core" },
  { ancestryId: "halfling", id: "gutsy-halfling", name: "Gutsy Halfling", source: "Player Core" },
  { ancestryId: "halfling", id: "hillock-halfling", name: "Hillock Halfling", source: "Player Core" },
  { ancestryId: "halfling", id: "jinxed-halfling", name: "Jinxed Halfling", source: "Player Core" },
  { ancestryId: "halfling", id: "nomadic-halfling", name: "Nomadic Halfling", source: "Player Core" },
  { ancestryId: "halfling", id: "twilight-halfling", name: "Twilight Halfling", source: "Player Core" },
  { ancestryId: "halfling", id: "wildwood-halfling", name: "Wildwood Halfling", source: "Player Core" },
  { ancestryId: "human", id: "skilled-human", name: "Skilled Human", source: "Player Core" },
  { ancestryId: "human", id: "versatile-human", name: "Versatile Human", source: "Player Core" },
  { ancestryId: "leshy", id: "cactus-leshy", name: "Cactus Leshy", source: "Player Core" },
  { ancestryId: "leshy", id: "fruit-leshy", name: "Fruit Leshy", source: "Player Core" },
  { ancestryId: "leshy", id: "fungus-leshy", name: "Fungus Leshy", source: "Player Core" },
  { ancestryId: "leshy", id: "gourd-leshy", name: "Gourd Leshy", source: "Player Core" },
  { ancestryId: "leshy", id: "leaf-leshy", name: "Leaf Leshy", source: "Player Core" },
  { ancestryId: "leshy", id: "lotus-leshy", name: "Lotus Leshy", source: "Player Core" },
  { ancestryId: "leshy", id: "root-leshy", name: "Root Leshy", source: "Player Core" },
  { ancestryId: "leshy", id: "seaweed-leshy", name: "Seaweed Leshy", source: "Player Core" },
  { ancestryId: "leshy", id: "vine-leshy", name: "Vine Leshy", source: "Player Core" },
  { ancestryId: "orc", id: "badlands-orc", name: "Badlands Orc", source: "Player Core" },
  { ancestryId: "orc", id: "battle-ready-orc", name: "Battle-Ready Orc", source: "Player Core" },
  { ancestryId: "orc", id: "deep-orc", name: "Deep Orc", source: "Player Core" },
  { ancestryId: "orc", id: "grave-orc", name: "Grave Orc", source: "Player Core" },
  { ancestryId: "orc", id: "hold-scarred-orc", name: "Hold-Scarred Orc", source: "Player Core" },
  { ancestryId: "orc", id: "rainfall-orc", name: "Rainfall Orc", source: "Player Core" },
  { ancestryId: "orc", id: "winter-orc", name: "Winter Orc", source: "Player Core" },
  { ancestryId: "catfolk", id: "clawed-catfolk", name: "Clawed Catfolk", source: "Player Core 2" },
  { ancestryId: "catfolk", id: "hunting-catfolk", name: "Hunting Catfolk", source: "Player Core 2" },
  { ancestryId: "catfolk", id: "jungle-catfolk", name: "Jungle Catfolk", source: "Player Core 2" },
  { ancestryId: "catfolk", id: "liminal-catfolk", name: "Liminal Catfolk", source: "Player Core 2" },
  { ancestryId: "catfolk", id: "nine-lives-catfolk", name: "Nine Lives Catfolk", source: "Player Core 2" },
  { ancestryId: "catfolk", id: "sharp-eared-catfolk", name: "Sharp-Eared Catfolk", source: "Player Core 2" },
  { ancestryId: "catfolk", id: "winter-catfolk", name: "Winter Catfolk", source: "Player Core 2" },
  { ancestryId: "hobgoblin", id: "elfbane-hobgoblin", name: "Elfbane Hobgoblin", source: "Player Core 2" },
  { ancestryId: "hobgoblin", id: "runtboss-hobgoblin", name: "Runtboss Hobgoblin", source: "Player Core 2" },
  { ancestryId: "hobgoblin", id: "shortshanks-hobgoblin", name: "Shortshanks Hobgoblin", source: "Player Core 2" },
  { ancestryId: "hobgoblin", id: "smokeworker-hobgoblin", name: "Smokeworker Hobgoblin", source: "Player Core 2" },
  { ancestryId: "hobgoblin", id: "warmarch-hobgoblin", name: "Warmarch Hobgoblin", source: "Player Core 2" },
  { ancestryId: "hobgoblin", id: "warrenbred-hobgoblin", name: "Warrenbred Hobgoblin", source: "Player Core 2" },
  { ancestryId: "kholo", id: "ant-kholo", name: "Ant Kholo", source: "Player Core 2" },
  { ancestryId: "kholo", id: "cave-kholo", name: "Cave Kholo", source: "Player Core 2" },
  { ancestryId: "kholo", id: "dog-kholo", name: "Dog Kholo", source: "Player Core 2" },
  { ancestryId: "kholo", id: "great-kholo", name: "Great Kholo", source: "Player Core 2" },
  { ancestryId: "kholo", id: "sweetbreath-kholo", name: "Sweetbreath Kholo", source: "Player Core 2" },
  { ancestryId: "kholo", id: "winter-kholo", name: "Winter Kholo", source: "Player Core 2" },
  { ancestryId: "kholo", id: "witch-kholo", name: "Witch Kholo", source: "Player Core 2" },
  { ancestryId: "kobold", id: "cavernstalker-kobold", name: "Cavernstalker Kobold", source: "Player Core 2" },
  { ancestryId: "kobold", id: "dragonscaled-kobold", name: "Dragonscaled Kobold", source: "Player Core 2" },
  { ancestryId: "kobold", id: "elementheart-kobold", name: "Elementheart Kobold", source: "Player Core 2" },
  { ancestryId: "kobold", id: "spellhorn-kobold", name: "Spellhorn Kobold", source: "Player Core 2" },
  { ancestryId: "kobold", id: "strongjaw-kobold", name: "Strongjaw Kobold", source: "Player Core 2" },
  { ancestryId: "kobold", id: "tunnelflood-kobold", name: "Tunnelflood Kobold", source: "Player Core 2" },
  { ancestryId: "kobold", id: "venomtail-kobold", name: "Venomtail Kobold", source: "Player Core 2" },
  { ancestryId: "lizardfolk", id: "cliffscale-lizardfolk", name: "Cliffscale Lizardfolk", source: "Player Core 2" },
  { ancestryId: "lizardfolk", id: "cloudleaper-lizardfolk", name: "Cloudleaper Lizardfolk", source: "Player Core 2" },
  { ancestryId: "lizardfolk", id: "frilled-lizardfolk", name: "Frilled Lizardfolk", source: "Player Core 2" },
  { ancestryId: "lizardfolk", id: "sandstrider-lizardfolk", name: "Sandstrider Lizardfolk", source: "Player Core 2" },
  { ancestryId: "lizardfolk", id: "unseen-lizardfolk", name: "Unseen Lizardfolk", source: "Player Core 2" },
  { ancestryId: "lizardfolk", id: "wetlander-lizardfolk", name: "Wetlander Lizardfolk", source: "Player Core 2" },
  { ancestryId: "lizardfolk", id: "woodstalker-lizardfolk", name: "Woodstalker Lizardfolk", source: "Player Core 2" },
  { ancestryId: "ratfolk", id: "deep-rat", name: "Deep Rat", source: "Player Core 2" },
  { ancestryId: "ratfolk", id: "desert-rat", name: "Desert Rat", source: "Player Core 2" },
  { ancestryId: "ratfolk", id: "longsnout-rat", name: "Longsnout Rat", source: "Player Core 2" },
  { ancestryId: "ratfolk", id: "sewer-rat", name: "Sewer Rat", source: "Player Core 2" },
  { ancestryId: "ratfolk", id: "shadow-rat", name: "Shadow Rat", source: "Player Core 2" },
  { ancestryId: "ratfolk", id: "snow-rat", name: "Snow Rat", source: "Player Core 2" },
  { ancestryId: "ratfolk", id: "tunnel-rat", name: "Tunnel Rat", source: "Player Core 2" },
  { ancestryId: "tengu", id: "dogtooth-tengu", name: "Dogtooth Tengu", source: "Player Core 2" },
  { ancestryId: "tengu", id: "jinxed-tengu", name: "Jinxed Tengu", source: "Player Core 2" },
  { ancestryId: "tengu", id: "mountainkeeper-tengu", name: "Mountainkeeper Tengu", source: "Player Core 2" },
  { ancestryId: "tengu", id: "skyborn-tengu", name: "Skyborn Tengu", source: "Player Core 2" },
  { ancestryId: "tengu", id: "stormtossed-tengu", name: "Stormtossed Tengu", source: "Player Core 2" },
  { ancestryId: "tengu", id: "taloned-tengu", name: "Taloned Tengu", source: "Player Core 2" },
  { ancestryId: "tengu", id: "wavediver-tengu", name: "Wavediver Tengu", source: "Player Core 2" },
  { ancestryId: "tripkee", id: "poisonhide-tripkee", name: "Poisonhide Tripkee", source: "Player Core 2" },
  { ancestryId: "tripkee", id: "riverside-tripkee", name: "Riverside Tripkee", source: "Player Core 2" },
  { ancestryId: "tripkee", id: "snaptongue-tripkee", name: "Snaptongue Tripkee", source: "Player Core 2" },
  { ancestryId: "tripkee", id: "stickytoe-tripkee", name: "Stickytoe Tripkee", source: "Player Core 2" },
  { ancestryId: "tripkee", id: "thickskin-tripkee", name: "Thickskin Tripkee", source: "Player Core 2" },
  { ancestryId: "tripkee", id: "windweb-tripkee", name: "Windweb Tripkee", source: "Player Core 2" },
];

const BASELINE_BUILD_ROWS = BASELINE_ANCESTRIES.map((ancestry, index) => ({
  ancestryId: ancestry.id,
  heritageId: BASELINE_HERITAGES.find((heritage) => heritage.ancestryId === ancestry.id)?.id ?? "",
  classId: BASELINE_CLASSES[index].id,
}));

describe("wayfinder level 1 breadth coverage", () => {
  beforeEach(() => {
    clearPackServiceCache();
    testGlobals.CONFIG = {
      PF2E: {
        ancestryTraits: Object.fromEntries([
          ...BASELINE_ANCESTRIES.map((ancestry) => [ancestry.id, ancestry.name]),
          ["kashrishi", "Kashrishi"],
        ]),
        classTraits: Object.fromEntries(BASELINE_CLASSES.map((classRow) => [classRow.id, classRow.name])),
        skills: {
          acrobatics: { label: "PF2E.Skill.Acrobatics" },
          arcana: { label: "PF2E.Skill.Arcana" },
          athletics: { label: "PF2E.Skill.Athletics" },
          crafting: { label: "PF2E.Skill.Crafting" },
          deception: { label: "PF2E.Skill.Deception" },
          diplomacy: { label: "PF2E.Skill.Diplomacy" },
          intimidation: { label: "PF2E.Skill.Intimidation" },
          medicine: { label: "PF2E.Skill.Medicine" },
          nature: { label: "PF2E.Skill.Nature" },
          occultism: { label: "PF2E.Skill.Occultism" },
          performance: { label: "PF2E.Skill.Performance" },
          religion: { label: "PF2E.Skill.Religion" },
          society: { label: "PF2E.Skill.Society" },
          stealth: { label: "PF2E.Skill.Stealth" },
          survival: { label: "PF2E.Skill.Survival" },
          thievery: { label: "PF2E.Skill.Thievery" },
        },
      },
    };
    setGamePacks(buildLevel1Packs());
  });

  afterEach(() => {
    clearPackServiceCache();
    delete testGlobals.CONFIG;
  });

  it("smokes supported PC and PC2 ancestry, heritage, and class inventory through plan options and build state", async () => {
    const plan = await buildPlan(buildActor(), createEmptyDraft(1));

    const ancestryOptions = await getOptionsForStep(expectStep(plan, "ancestry-level-1"), EMPTY_CONTEXT);
    const classOptions = await getOptionsForStep(expectStep(plan, "class-level-1"), EMPTY_CONTEXT);
    const humanHeritageOptions = await getOptionsForStep(expectStep(plan, "heritage-level-1"), {
      ...EMPTY_CONTEXT,
      ancestrySlug: "human",
      ancestryTraits: ["human"],
    });
    const pc2HeritageOptions = await getOptionsForStep(expectStep(plan, "heritage-level-1"), {
      ...EMPTY_CONTEXT,
      ancestrySlug: "catfolk",
      ancestryTraits: ["catfolk"],
    });

    expect(ancestryOptions.map((option) => option.name)).toEqual([
      "Catfolk",
      "Dwarf",
      "Elf",
      "Gnome",
      "Goblin",
      "Halfling",
      "Hobgoblin",
      "Human",
      "Kashrishi",
      "Kholo",
      "Kobold",
      "Leshy",
      "Lizardfolk",
      "Orc",
      "Ratfolk",
      "Tengu",
      "Tripkee",
    ]);
    expect(classOptions.map((option) => option.name)).toEqual([
      "Alchemist",
      "Barbarian",
      "Bard",
      "Champion",
      "Cleric",
      "Druid",
      "Fighter",
      "Investigator",
      "Monk",
      "Oracle",
      "Ranger",
      "Rogue",
      "Sorcerer",
      "Swashbuckler",
      "Witch",
      "Wizard",
    ]);
    expect(humanHeritageOptions.map((option) => option.name)).toEqual([
      "Skilled Human",
      "Versatile Human",
      "Wellspring Gnome",
    ]);
    expect(pc2HeritageOptions.map((option) => option.name)).toEqual([
      "Clawed Catfolk",
      "Hunting Catfolk",
      "Jungle Catfolk",
      "Liminal Catfolk",
      "Nine Lives Catfolk",
      "Sharp-Eared Catfolk",
      "Wellspring Gnome",
      "Winter Catfolk",
    ]);

    for (const { ancestryId, heritageId, classId } of BASELINE_BUILD_ROWS) {
      await expectEffectiveBuildState({ ancestryId, heritageId, classId });
    }

    for (const heritage of BASELINE_HERITAGES) {
      const heritageOptions = await getOptionsForStep(expectStep(plan, "heritage-level-1"), {
        ...EMPTY_CONTEXT,
        ancestrySlug: heritage.ancestryId,
        ancestryTraits: [heritage.ancestryId],
      });

      expect(
        heritageOptions.map((option) => option.name),
        `Expected ${heritage.name} to match ${heritage.ancestryId}`
      ).toContain(heritage.name);
      await expectEffectiveBuildState({
        ancestryId: heritage.ancestryId,
        heritageId: heritage.id,
        classId: "fighter",
      });
    }
  });

  it("constructs plan-level grant choices for Natural Ambition, Ancient Elf, Nascent, and Versatile Human", async () => {
    const naturalAmbitionPlan = await buildPlan(
      buildActor(),
      createBaseDraft({
        ancestryId: "human",
        heritageId: "skilled-human",
        classId: "fighter",
        ancestryFeatId: "natural-ambition",
      })
    );
    const naturalAmbitionStep = expectStep(
      naturalAmbitionPlan,
      "grant-choice-class-feat-natural-ambition-naturalAmbition-level-1"
    );
    expect(naturalAmbitionStep.grantSelection).toMatchObject({
      sourceItemType: "feat",
      dependsOn: "class",
      flag: "naturalAmbition",
    });
    await expectOptionNames(
      naturalAmbitionStep,
      {
        ...EMPTY_CONTEXT,
        ancestrySlug: "human",
        ancestryTraits: ["human"],
        classSlug: "fighter",
      },
      ["Reactive Strike", "Sudden Charge"]
    );

    const ancientElfPlan = await buildPlan(
      buildActor(),
      createBaseDraft({ ancestryId: "elf", heritageId: "ancient-elf", classId: "wizard" })
    );
    const ancientElfStep = expectStep(ancientElfPlan, "grant-choice-class-heritage-ancient-elf-ancientElf-level-1");
    expect(ancientElfStep.grantSelection).toMatchObject({
      sourceItemType: "heritage",
      dependsOn: "class",
      flag: "ancientElf",
    });
    await expectOptionNames(
      ancientElfStep,
      {
        ...EMPTY_CONTEXT,
        ancestrySlug: "elf",
        ancestryTraits: ["elf"],
        classSlug: "wizard",
      },
      ["Fighter Dedication", "Rogue Dedication"]
    );

    const nascentPlan = await buildPlan(
      buildActor(),
      createBaseDraft({ ancestryId: "kashrishi", heritageId: "nascent", classId: "fighter" })
    );
    const nascentStep = expectStep(nascentPlan, "grant-choice-none-heritage-nascent-nascent-level-1");
    expect(nascentStep.grantSelection).toMatchObject({
      sourceItemType: "heritage",
      dependsOn: null,
      flag: "nascent",
    });
    await expectOptionNames(
      nascentStep,
      {
        ...EMPTY_CONTEXT,
        ancestrySlug: "kashrishi",
        ancestryTraits: ["kashrishi"],
        classSlug: "fighter",
      },
      ["Kashrishi Lore"]
    );

    const versatileHumanPlan = await buildPlan(
      buildActor(),
      createBaseDraft({ ancestryId: "human", heritageId: "versatile-human", classId: "wizard" })
    );
    const versatileHumanStep = expectStep(
      versatileHumanPlan,
      "grant-choice-none-heritage-versatile-human-versatileHeritage-level-1"
    );
    expect(versatileHumanStep.grantSelection).toMatchObject({
      sourceItemType: "heritage",
      dependsOn: null,
      flag: "versatileHeritage",
    });
    await expectOptionNames(
      versatileHumanStep,
      {
        ...EMPTY_CONTEXT,
        ancestrySlug: "human",
        ancestryTraits: ["human"],
        classSlug: "wizard",
      },
      ["Additional Lore", "Fleet"]
    );

    const generalTrainingPlan = await buildPlan(
      buildActor(),
      createBaseDraft({
        ancestryId: "human",
        heritageId: "skilled-human",
        classId: "fighter",
        ancestryFeatId: "general-training",
      })
    );
    const generalTrainingStep = expectStep(generalTrainingPlan, "grant-choice-none-feat-general-training-feat-level-1");
    expect(generalTrainingStep.grantSelection).toMatchObject({
      sourceItemType: "feat",
      dependsOn: null,
      flag: "feat",
    });
    await expectOptionNames(
      generalTrainingStep,
      {
        ...EMPTY_CONTEXT,
        ancestrySlug: "human",
        ancestryTraits: ["human"],
        classSlug: "fighter",
      },
      ["Additional Lore", "Fleet"]
    );
  });

  it("folds Skilled Human and grant-selected feat training into class skill training", async () => {
    const skilledHumanPlan = await buildPlan(
      buildActor(),
      createBaseDraft({ ancestryId: "human", heritageId: "skilled-human", classId: "wizard" })
    );
    const skilledHumanTraining = expectTrainingStep(skilledHumanPlan, "wizard");

    expect(skilledHumanTraining.training.choiceRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "heritage:skilled-human:trainedSkill",
          sourceLabel: "Skilled Human",
          options: expect.arrayContaining([
            expect.objectContaining({ slug: "arcana", label: "Arcana" }),
            expect.objectContaining({ slug: "society", label: "Society" }),
          ]),
          persistence: expect.objectContaining({
            sourceItemType: "heritage",
            sourceDocumentId: "skilled-human",
          }),
        }),
      ])
    );

    const versatileDraft = createBaseDraft({
      ancestryId: "human",
      heritageId: "versatile-human",
      classId: "wizard",
    });
    versatileDraft.selections["grant-choice-none-heritage-versatile-human-versatileHeritage-level-1"] = selection(
      "grant-choice-none-heritage-versatile-human-versatileHeritage-level-1",
      "pf2e.feats-srd",
      "additional-lore",
      "feat",
      "Additional Lore",
      "general"
    );
    const versatileTraining = expectTrainingStep(await buildPlan(buildActor(), versatileDraft), "wizard");
    expect(versatileTraining.training.loreChoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLabel: "Additional Lore",
          allowCustom: true,
          placeholder: "Custom Lore",
        }),
      ])
    );

    const generalTrainingDraft = createBaseDraft({
      ancestryId: "human",
      heritageId: "skilled-human",
      classId: "wizard",
      ancestryFeatId: "general-training",
    });
    generalTrainingDraft.selections["grant-choice-none-feat-general-training-feat-level-1"] = selection(
      "grant-choice-none-feat-general-training-feat-level-1",
      "pf2e.feats-srd",
      "additional-lore",
      "feat",
      "Additional Lore",
      "general"
    );
    const generalTraining = expectTrainingStep(await buildPlan(buildActor(), generalTrainingDraft), "wizard");
    expect(generalTraining.training.loreChoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLabel: "Additional Lore",
          allowCustom: true,
          placeholder: "Custom Lore",
        }),
      ])
    );

    const ancientElfDraft = createBaseDraft({ ancestryId: "elf", heritageId: "ancient-elf", classId: "wizard" });
    ancientElfDraft.selections["grant-choice-class-heritage-ancient-elf-ancientElf-level-1"] = selection(
      "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
      "pf2e.feats-srd",
      "fighter-dedication",
      "feat",
      "Fighter Dedication",
      "class"
    );
    const ancientElfTraining = expectTrainingStep(await buildPlan(buildActor(), ancientElfDraft), "wizard");
    expect(ancientElfTraining.training.choiceRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLabel: "Fighter Dedication",
          prompt: "Skill",
          flag: "skill",
          persistence: expect.objectContaining({
            sourceItemType: "feat",
            sourceUuid: "Compendium.pf2e.feats-srd.Item.fighter-dedication",
          }),
        }),
      ])
    );
  });
});

async function buildPlan(actor: ReturnType<typeof buildActor>, draft: DraftState) {
  return buildWayfinderAppPlan({
    actor,
    snapshot: inspectActor(actor),
    draft,
    resolveDocument: (itemType) => getEffectiveSingletonDocument(actor, draft, itemType),
    resolveArcaneSchoolDocument: async () => null,
    localize: localizeValue,
  });
}

function localizeValue(value: string): string {
  return value
    .replace(/^PF2E\.Skill\./, "")
    .replace(/^PF2E\.SpecificRule\.Prompt\./, "")
    .replace(/^PF2E\./, "");
}

function buildActor() {
  return {
    system: {
      details: {
        level: {
          value: 1,
        },
        languages: {
          value: [],
        },
      },
      build: {
        attributes: {
          boosts: {
            1: [],
            5: [],
            10: [],
            15: [],
            20: [],
          },
        },
      },
      skills: {},
    },
    items: {
      contents: [],
    },
  };
}

function createBaseDraft(args: {
  ancestryId: string;
  heritageId: string;
  classId: string;
  ancestryFeatId?: string;
}): DraftState {
  const draft = createEmptyDraft(1);
  const packs = buildLevel1Packs();
  const ancestry = packs["pf2e.ancestries"][args.ancestryId];
  const heritage = packs["pf2e.heritages"][args.heritageId];
  const classDocument = packs["pf2e.classes"][args.classId];

  draft.selections["ancestry-level-1"] = selection(
    "ancestry-level-1",
    "pf2e.ancestries",
    args.ancestryId,
    "ancestry",
    ancestry.name
  );
  draft.selections["heritage-level-1"] = selection(
    "heritage-level-1",
    "pf2e.heritages",
    args.heritageId,
    "heritage",
    heritage.name
  );
  draft.selections["background-level-1"] = selection(
    "background-level-1",
    "pf2e.backgrounds",
    "scholar",
    "background",
    "Scholar"
  );
  draft.selections["class-level-1"] = selection(
    "class-level-1",
    "pf2e.classes",
    args.classId,
    "class",
    classDocument.name
  );
  if (args.ancestryFeatId) {
    draft.selections["ancestry-feat-level-1"] = selection(
      "ancestry-feat-level-1",
      "pf2e.feats-srd",
      args.ancestryFeatId,
      "feat",
      packs["pf2e.feats-srd"][args.ancestryFeatId].name,
      "ancestry"
    );
  }

  draft.boosts.ancestry.selectedBoosts = {
    fixed: "con",
    free: "int",
    free1: "int",
    free2: "dex",
  };
  draft.boosts.background.selectedBoosts = {
    fixed: "int",
    free: "wis",
  };
  draft.boosts.class.keyAbility = firstKeyAbility(classDocument);
  draft.boosts.levels["1"] = ["str", "dex", "con", "wis"];

  return draft;
}

function firstKeyAbility(document: PackDocumentDefinition): "str" | "dex" | "con" | "int" | "wis" | "cha" {
  const value = document.system?.keyAbility;
  const options = isRecord(value) && Array.isArray(value.value) ? value.value : [];
  const first = options.find((entry): entry is "str" | "dex" | "con" | "int" | "wis" | "cha" =>
    ALL_ABILITIES.includes(String(entry))
  );
  return first ?? "int";
}

function expectStep(plan: { steps: PendingStep[] }, slotId: string): PendingStep {
  const step = plan.steps.find((entry) => entry.slotId === slotId);
  expect(step, `Expected plan step ${slotId}`).toBeTruthy();
  return step as PendingStep;
}

function expectTrainingStep(plan: { steps: PendingStep[] }, classSlug: string) {
  const step = plan.steps.find((entry) => entry.kind === "skill-training" && entry.training.classSlug === classSlug);
  expect(step, `Expected ${classSlug} skill training step`).toBeTruthy();
  return step as Extract<PendingStep, { kind: "skill-training" }>;
}

function documentSlug(document: unknown): string | null {
  const slug = (document as { system?: { slug?: unknown } } | null | undefined)?.system?.slug;
  return typeof slug === "string" ? slug : null;
}

async function expectEffectiveBuildState(args: {
  ancestryId: string;
  heritageId: string;
  classId: string;
}): Promise<void> {
  const draft = createBaseDraft(args);
  const buildState = await getEffectiveBuildState(buildActor(), draft);
  const plan = await buildPlan(buildActor(), draft);

  expect(documentSlug(buildState.ancestry?.document), `${args.ancestryId}/${args.heritageId}`).toBe(args.ancestryId);
  expect(documentSlug(buildState.heritage), `${args.ancestryId}/${args.heritageId}`).toBe(args.heritageId);
  expect(documentSlug(buildState.class?.document), `${args.ancestryId}/${args.heritageId}`).toBe(args.classId);
  expect(buildState.class?.selectedKeyAbility, `${args.classId} key ability`).toBeTruthy();
  expect(buildState.levelBoosts[1], `${args.ancestryId}/${args.heritageId} level boosts`).toHaveLength(4);
  expect(expectStep(plan, "ancestry-level-1").required).toBe(true);
  expect(expectStep(plan, "heritage-level-1").required).toBe(true);
  expect(expectStep(plan, "class-level-1").required).toBe(true);
}

async function expectOptionNames(step: PendingStep, context: OptionContext, expectedNames: string[]): Promise<void> {
  const options = await getOptionsForStep(step, context);
  expect(options.map((option) => option.name)).toEqual(expectedNames);
}

function selection(
  slotId: string,
  packId: string,
  documentId: string,
  itemType: string,
  name: string,
  featType: string | null = null
): SelectionRef {
  return {
    slotId,
    packId,
    documentId,
    uuid: `Compendium.${packId}.Item.${documentId}`,
    itemType,
    featType,
    name,
    level: 1,
  };
}

type PackDocumentDefinition = {
  name: string;
  type: string;
  img?: string;
  system?: Record<string, any>;
  flags?: Record<string, any>;
  _stats?: Record<string, any>;
};

function setGamePacks(packs: Record<string, Record<string, PackDocumentDefinition>>): void {
  testGlobals.game = {
    i18n: {
      localize: (value: string) => value,
    },
    settings: {
      get: () => "",
    },
    packs: new Map(
      Object.entries(packs).map(([packId, documents]) => [
        packId,
        {
          metadata: { id: packId },
          getIndex: async () =>
            Object.entries(documents).map(([documentId, document]) => ({
              _id: documentId,
              name: document.name,
              img: document.img ?? `${documentId}.webp`,
              type: document.type,
              system: cloneValue(document.system ?? {}),
            })),
          getDocument: async (documentId: string) => {
            const document = documents[documentId];
            if (!document) {
              return null;
            }

            return {
              id: documentId,
              name: document.name,
              img: document.img ?? `${documentId}.webp`,
              type: document.type,
              system: cloneValue(document.system ?? {}),
              flags: cloneValue(document.flags ?? {}),
              _stats: cloneValue(document._stats ?? {}),
              toObject: () => ({
                name: document.name,
                img: document.img ?? `${documentId}.webp`,
                type: document.type,
                system: cloneValue(document.system ?? {}),
                flags: cloneValue(document.flags ?? {}),
                _stats: cloneValue(document._stats ?? {}),
              }),
            };
          },
        },
      ])
    ),
  };
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function buildLevel1Packs(): Record<string, Record<string, PackDocumentDefinition>> {
  return {
    "pf2e.ancestries": Object.fromEntries([
      ...BASELINE_ANCESTRIES.map((ancestry) => [
        ancestry.id,
        ancestryDocument(
          ancestry.name,
          ancestry.id,
          ancestry.source,
          ancestry.id === "human" ? humanBoosts() : undefined
        ),
      ]),
      ["kashrishi", ancestryDocument("Kashrishi", "kashrishi", "Player Core 2")],
    ]),
    "pf2e.heritages": Object.fromEntries([
      ...BASELINE_HERITAGES.map((heritage) => [
        heritage.id,
        heritageDocument(
          heritage.name,
          heritage.id,
          heritage.ancestryId,
          heritage.source,
          heritageRulesFor(heritage.id)
        ),
      ]),
      ["nascent", heritageDocument("Nascent", "nascent", "kashrishi", "Player Core 2", heritageRulesFor("nascent"))],
      ["wellspring-gnome", heritageDocument("Wellspring Gnome", "wellspring-gnome", null, "Player Core")],
    ]),
    "pf2e.backgrounds": {
      scholar: {
        name: "Scholar",
        type: "background",
        system: {
          slug: "scholar",
          boosts: {
            fixed: {
              value: ["int"],
              selected: "int",
            },
            free: {
              value: ALL_ABILITIES,
              selected: null,
            },
          },
          trainedSkills: {
            value: ["arcana"],
            lore: ["Academia Lore"],
          },
        },
      },
    },
    "pf2e.classes": Object.fromEntries(
      BASELINE_CLASSES.map((classRow) => [
        classRow.id,
        classDocument(
          classRow.name,
          classRow.id,
          classRow.keyAbility,
          classRow.additionalSkills,
          classRow.fixedSkills,
          classRow.spellcasting,
          classRow.source
        ),
      ])
    ),
    "pf2e.feats-srd": {
      "additional-lore": featDocument("Additional Lore", "additional-lore", "general", ["general"], {
        description: {
          value:
            "<p>Your knowledge has expanded to encompass a new field. Choose a Lore skill subcategory. You become trained in it.</p>",
        },
      }),
      fleet: featDocument("Fleet", "fleet", "general", ["general"]),
      "kashrishi-lore": featDocument("Kashrishi Lore", "kashrishi-lore", "ancestry", ["kashrishi"], {
        description: {
          value: "<p>You gain the trained proficiency rank in Occultism and Society.</p>",
        },
      }),
      "natural-ambition": featDocument("Natural Ambition", "natural-ambition", "ancestry", ["human"], {
        rules: [
          {
            adjustName: false,
            choices: {
              filter: [
                "item:level:1",
                "item:category:class",
                "item:trait:{actor|system.details.class.trait}",
                { or: ["feature:dragon-instinct", { not: "item:draconic-arrogance" }] },
                { nor: ["item:animal-companion", "item:bardic-lore"] },
              ],
              itemType: "feat",
            },
            flag: "naturalAmbition",
            key: "ChoiceSet",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.naturalAmbition}",
          },
        ],
      }),
      "general-training": featDocument("General Training", "general-training", "ancestry", ["human"], {
        rules: [
          {
            key: "ChoiceSet",
            flag: "feat",
            choices: {
              itemType: "feat",
              filter: ["item:level:1", "item:trait:general"],
            },
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.feat}",
          },
        ],
      }),
      "reactive-strike": featDocument("Reactive Strike", "reactive-strike", "class", ["fighter"]),
      "sudden-charge": featDocument("Sudden Charge", "sudden-charge", "class", ["barbarian", "fighter"]),
      "animal-companion": featDocument("Animal Companion", "animal-companion", "class", ["fighter"]),
      "trap-finder": featDocument("Trap Finder", "trap-finder", "class", ["rogue"]),
      "fighter-dedication": featDocument(
        "Fighter Dedication",
        "fighter-dedication",
        "class",
        ["fighter", "dedication", "multiclass"],
        {
          level: {
            value: 2,
          },
          description: {
            value:
              "<p>You become trained in martial weapons. You become trained in your choice of Acrobatics or Athletics; if you are already trained in both of these skills, you instead become trained in a skill of your choice. You become trained in fighter class DC.</p>",
          },
          rules: [
            {
              key: "ChoiceSet",
              flag: "skill",
              prompt: "PF2E.SpecificRule.Prompt.Skill",
              choices: [
                { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
                { value: "athletics", label: "PF2E.Skill.Athletics" },
              ],
            },
          ],
        }
      ),
      "rogue-dedication": featDocument(
        "Rogue Dedication",
        "rogue-dedication",
        "class",
        ["rogue", "dedication", "multiclass"],
        {
          level: {
            value: 2,
          },
        }
      ),
      "wizard-dedication": featDocument(
        "Wizard Dedication",
        "wizard-dedication",
        "class",
        ["wizard", "dedication", "multiclass"],
        {
          level: {
            value: 2,
          },
        }
      ),
    },
    "pf2e.classfeatures": {},
    "pf2e.spells-srd": {},
    "pf2e.deities": {},
  };
}

function ancestryDocument(
  name: string,
  slug: string,
  source: "Player Core" | "Player Core 2",
  boosts: Record<string, { value: string[]; selected: string | null }> = {
    fixed: { value: ["con"], selected: "con" },
    free: { value: ALL_ABILITIES, selected: null },
  }
): PackDocumentDefinition {
  return {
    name,
    type: "ancestry",
    system: {
      slug,
      boosts,
      languages: {
        value: ["common"],
      },
      additionalLanguages: {
        count: 0,
        value: ["draconic", "dwarven"],
      },
      traits: {
        rarity: "common",
        value: [slug],
      },
      publication: {
        title: source,
      },
    },
  };
}

function humanBoosts(): Record<string, { value: string[]; selected: string | null }> {
  return {
    free1: { value: ALL_ABILITIES, selected: null },
    free2: { value: ALL_ABILITIES, selected: null },
  };
}

function heritageDocument(
  name: string,
  slug: string,
  ancestrySlug: string | null,
  source: "Player Core" | "Player Core 2",
  rules: Array<Record<string, any>> = []
): PackDocumentDefinition {
  return {
    name,
    type: "heritage",
    system: {
      slug,
      level: {
        value: 1,
      },
      ancestry: ancestrySlug ? { slug: ancestrySlug } : null,
      rules,
      traits: {
        rarity: "common",
        value: ancestrySlug ? [ancestrySlug] : [slug],
      },
      publication: {
        title: source,
      },
    },
  };
}

function heritageRulesFor(slug: string): Array<Record<string, any>> {
  if (slug === "ancient-elf") {
    return [
      {
        key: "ChoiceSet",
        flag: "ancientElf",
        choices: {
          itemType: "feat",
          filter: ["item:category:class", "item:trait:dedication", "item:trait:multiclass"],
        },
      },
      {
        key: "GrantItem",
        uuid: "{item|flags.system.rulesSelections.ancientElf}",
      },
    ];
  }

  if (slug === "skilled-human") {
    return [
      {
        key: "ChoiceSet",
        flag: "trainedSkill",
        prompt: "PF2E.SpecificRule.Prompt.Skill",
        choices: {
          config: "skills",
        },
      },
    ];
  }

  if (slug === "versatile-human") {
    return [
      {
        key: "ChoiceSet",
        flag: "versatileHeritage",
        choices: {
          itemType: "feat",
          filter: ["item:level:1", "item:trait:general"],
        },
      },
      {
        key: "GrantItem",
        uuid: "{item|flags.system.rulesSelections.versatileHeritage}",
      },
    ];
  }

  if (slug === "nascent") {
    return [
      {
        key: "ChoiceSet",
        flag: "nascent",
        choices: {
          itemType: "feat",
          filter: ["item:level:1", "item:category:ancestry", "item:trait:kashrishi"],
        },
      },
      {
        key: "GrantItem",
        uuid: "{item|flags.system.rulesSelections.nascent}",
      },
    ];
  }

  return [];
}

function classDocument(
  name: string,
  slug: string,
  keyAbility: string[],
  additionalSkills: number,
  fixedSkills: string[],
  spellcasting: boolean,
  source: "Player Core" | "Player Core 2"
): PackDocumentDefinition {
  return {
    name,
    type: "class",
    system: {
      slug,
      keyAbility: {
        value: keyAbility,
        selected: null,
      },
      trainedSkills: {
        additional: additionalSkills,
        value: fixedSkills,
      },
      rules: [],
      items: spellcasting
        ? {
            spellcasting: {
              level: 1,
              uuid: `Compendium.pf2e.classfeatures.Item.${slug}-spellcasting`,
              name: `${name} Spellcasting`,
            },
          }
        : {},
      traits: {
        rarity: "common",
        value: [slug],
      },
      publication: {
        title: source,
      },
    },
  };
}

function featDocument(
  name: string,
  slug: string,
  featType: string,
  traits: string[],
  overrides: Record<string, any> = {}
): PackDocumentDefinition {
  return {
    name,
    type: "feat",
    system: {
      slug,
      category: featType,
      featType: {
        value: featType,
      },
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
      ...overrides,
    },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object";
}
