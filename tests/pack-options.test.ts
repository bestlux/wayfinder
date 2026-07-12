import { beforeEach, describe, expect, it } from "vitest";
import { clearPackServiceCache } from "../src/pack/access";
import { getOptionsForStep } from "../src/pack/options";
import type { OptionContext, PendingStep, PickItemSlotKind } from "../src/types";
import { createPickItemStep } from "../src/wayfinder/domain/step-types";

const testGlobals = globalThis as typeof globalThis & { CONFIG: any; game: any };

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

describe("pack options dependency filtering", () => {
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
        classHasSpellcasting: false,
        hasDedicationFeat: false,
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Cooperative Nature", "Fanged Blood", "Wilderness Born"]);
  });

  it("keeps Human ancestry feats whose ChoiceSet is handled by a follow-up grant choice", async () => {
    setPack("pf2e.ancestries", [ancestryEntry("human", "Human", false)]);
    setPack("pf2e.feats-srd", [
      featEntry("cooperative-nature", "Cooperative Nature", "ancestry", ["human"], false),
      featEntry("PodajLVxqYSAqVox", "Natural Ambition", "ancestry", ["human"], false, {
        rules: [
          {
            key: "ChoiceSet",
            flag: "naturalAmbition",
            choices: {
              itemType: "feat",
              filter: ["item:level:1", "item:category:class", "item:trait:{actor|system.details.class.trait}"],
            },
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.naturalAmbition}",
          },
        ],
      }),
      featEntry("partial-ambition", "Partial Ambition", "ancestry", ["human"], false, {
        rules: [
          {
            key: "ChoiceSet",
            flag: "naturalAmbition",
            choices: {
              itemType: "feat",
              filter: ["item:level:1", "item:category:class", "item:trait:{actor|system.details.class.trait}"],
            },
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.naturalAmbition}",
          },
          {
            key: "ChoiceSet",
            flag: "unsupported",
          },
        ],
      }),
      featEntry("unsupported-human-choice", "Unsupported Human Choice", "ancestry", ["human"], false, {
        rules: [
          {
            key: "ChoiceSet",
            flag: "unsupported",
          },
        ],
      }),
    ]);

    const options = await getOptionsForStep(
      makeStep("ancestry-feat", {
        itemType: "feat",
        featTypes: ["ancestry"],
        maxLevel: 1,
      }),
      {
        ...EMPTY_CONTEXT,
        ancestrySlug: "human",
        ancestryTraits: ["human"],
        classSlug: "fighter",
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Cooperative Nature", "Natural Ambition"]);
  });

  it("filters ancestry feat spellcasting prerequisites against the drafted class", async () => {
    setPack("pf2e.ancestries", [ancestryEntry("human", "Human", false)]);
    setPack("pf2e.feats-srd", [
      featEntry("cooperative-nature", "Cooperative Nature", "ancestry", ["human"], false),
      featEntry("adapted-cantrip", "Adapted Cantrip", "ancestry", ["human"], false, {
        prerequisites: {
          value: [{ value: "spellcasting class feature" }],
        },
      }),
    ]);

    const step = makeStep("ancestry-feat", {
      itemType: "feat",
      featTypes: ["ancestry"],
      maxLevel: 1,
    });
    const fighterOptions = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      ancestrySlug: "human",
      ancestryTraits: ["human"],
      classSlug: "fighter",
    });
    const wizardOptions = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      ancestrySlug: "human",
      ancestryTraits: ["human"],
      classSlug: "wizard",
      classHasSpellcasting: true,
    });

    expect(fighterOptions.map((option) => option.name)).toEqual(["Cooperative Nature"]);
    expect(wizardOptions.map((option) => option.name)).toEqual(["Adapted Cantrip", "Cooperative Nature"]);
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
        classHasSpellcasting: false,
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

  it("filters skill feat prerequisites against projected trained skills and lores", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("additional-lore", "Additional Lore", "skill", ["general", "skill"], true, {
        prerequisites: { value: [] },
      }),
      featEntry("assurance", "Assurance", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "trained in at least one skill" }] },
      }),
      featEntry("battle-medicine", "Battle Medicine", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "trained in Medicine" }] },
      }),
      featEntry("cat-fall", "Cat Fall", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "trained in Acrobatics" }] },
      }),
      featEntry("dubious-knowledge", "Dubious Knowledge", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "trained in a skill with the Recall Knowledge action" }] },
      }),
      featEntry("armor-assist", "Armor Assist", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "trained in Athletics or Warfare Lore" }] },
      }),
      featEntry("seasoned", "Seasoned", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "trained in Alcohol Lore, Cooking Lore, or Crafting" }] },
      }),
    ]);

    const options = await getOptionsForStep(
      makeStep("skill-feat", {
        itemType: "feat",
        featTypes: ["skill"],
        maxLevel: 1,
      }),
      {
        ...EMPTY_CONTEXT,
        skillRanks: {
          acrobatics: 1,
          medicine: 0,
          "warfare-lore": 1,
        },
      }
    );

    expect(options.map((option) => option.name)).toEqual([
      "Additional Lore",
      "Armor Assist",
      "Assurance",
      "Cat Fall",
      "Dubious Knowledge",
    ]);
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

  it("filters grant-choice options to explicit static UUID allowlists", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("dubious-knowledge-id", "Dubious Knowledge", "skill", ["skill"]),
      featEntry("quick-identification-id", "Quick Identification", "skill", ["skill"]),
      featEntry("fleet", "Fleet", "general", ["general"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        packIds: ["pf2e.feats-srd"],
        uuids: [
          "Compendium.pf2e.feats-srd.Item.Dubious Knowledge",
          "Compendium.pf2e.feats-srd.Item.Quick Identification",
        ],
      }),
      EMPTY_CONTEXT
    );

    expect(options.map((option) => option.name)).toEqual(["Dubious Knowledge", "Quick Identification"]);
    expect(options.map((option) => option.uuid)).toEqual([
      "Compendium.pf2e.feats-srd.Item.dubious-knowledge-id",
      "Compendium.pf2e.feats-srd.Item.quick-identification-id",
    ]);
  });

  it("filters static UUID grant choices by choice-level predicates", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("charming-liar-id", "Charming Liar", "skill", ["skill"]),
      featEntry("group-impression-id", "Group Impression", "skill", ["skill"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        packIds: ["pf2e.feats-srd"],
        uuids: ["Compendium.pf2e.feats-srd.Item.Charming Liar", "Compendium.pf2e.feats-srd.Item.Group Impression"],
        uuidPredicates: {
          "Compendium.pf2e.feats-srd.Item.Charming Liar": ["molten-wit:deception"],
          "Compendium.pf2e.feats-srd.Item.Group Impression": ["molten-wit:diplomacy"],
        },
      } as any),
      {
        ...EMPTY_CONTEXT,
        rollOptions: ["molten-wit:deception"],
      } as any
    );

    expect(options.map((option) => option.name)).toEqual(["Charming Liar"]);
  });

  it("evaluates static UUID grant predicates against actor skill ranks", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("charming-liar-id", "Charming Liar", "skill", ["skill"]),
      featEntry("group-impression-id", "Group Impression", "skill", ["skill"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        packIds: ["pf2e.feats-srd"],
        uuids: ["Compendium.pf2e.feats-srd.Item.Charming Liar", "Compendium.pf2e.feats-srd.Item.Group Impression"],
        uuidPredicates: {
          "Compendium.pf2e.feats-srd.Item.Charming Liar": ["skill:deception:rank:0"],
          "Compendium.pf2e.feats-srd.Item.Group Impression": ["skill:diplomacy:rank:0"],
        },
      } as any),
      {
        ...EMPTY_CONTEXT,
        skillRanks: {
          deception: 1,
          diplomacy: 0,
        },
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Group Impression"]);
  });

  it("hides choices already selected in a different draft slot", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("community-knowledge", "Community Knowledge", "ancestry", ["kashrishi"]),
      featEntry("puncturing-horn", "Puncturing Horn", "ancestry", ["kashrishi"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        predicate: ["item:level:1", "item:category:ancestry", "item:trait:kashrishi"],
      }),
      {
        ...EMPTY_CONTEXT,
        selectedUuidsBySlotId: {
          "ancestry-feat-level-1": "Compendium.pf2e.feats-srd.Item.puncturing-horn",
        },
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Community Knowledge"]);
  });

  it("hides actor-owned choices during existing-character reruns", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("reactive-shield", "Reactive Shield", "class", ["fighter"]),
      featEntry("intimidating-strike", "Intimidating Strike", "class", ["fighter"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("class-feat", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 2,
      }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        actorSourceIds: ["Compendium.pf2e.feats-srd.Item.reactive-shield"],
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Intimidating Strike"]);
  });

  it("keeps the current draft slot's selected choice visible", async () => {
    setPack("pf2e.feats-srd", [featEntry("puncturing-horn", "Puncturing Horn", "ancestry", ["kashrishi"])]);

    const step = makeStep("grant-choice", {
      itemType: "feat",
      predicate: ["item:level:1", "item:category:ancestry", "item:trait:kashrishi"],
    });
    const options = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      selectedUuidsBySlotId: {
        [step.slotId]: "Compendium.pf2e.feats-srd.Item.puncturing-horn",
      },
    });

    expect(options.map((option) => option.name)).toEqual(["Puncturing Horn"]);
  });

  it("honors item type predicates from PF2E grant ChoiceSets", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("counterspell-prepared", "Counterspell (Prepared)", "class", ["wizard"]),
      featEntry("reach-spell", "Reach Spell", "class", ["wizard"]),
      featEntry("reactive-shield", "Reactive Shield", "class", ["fighter"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        predicate: ["item:type:feat", "item:trait:wizard", "item:level:1"],
      }),
      EMPTY_CONTEXT
    );

    expect(options.map((option) => option.name)).toEqual(["Counterspell (Prepared)", "Reach Spell"]);
  });

  it("treats PF2E item:type:feature predicates as classfeature feat documents", async () => {
    setPack("pf2e.classfeatures", [
      classFeatureEntry("harmonic-oscillator", "Harmonic Oscillator", ["inventor"], ["armor-innovation-modification"]),
      classFeatureEntry("warrior-muse", "Warrior Muse", ["bard"], ["bard-muse"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        packIds: ["pf2e.classfeatures"],
        predicate: [
          "item:level:1",
          "item:type:feature",
          "item:trait:inventor",
          "item:tag:armor-innovation-modification",
        ],
      }),
      EMPTY_CONTEXT
    );

    expect(options.map((option) => option.name)).toEqual(["Harmonic Oscillator"]);
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

  it("filters class-dependent grant-choice options from injected PF2E predicates", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("reactive-strike", "Reactive Strike", "class", ["fighter"]),
      featEntry("sudden-charge", "Sudden Charge", "class", ["barbarian", "fighter"]),
      featEntry("trap-finder", "Trap Finder", "class", ["rogue"]),
      featEntry("animal-companion", "Animal Companion", "class", ["fighter"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        predicate: [
          "item:level:1",
          "item:category:class",
          "item:trait:{actor|system.details.class.trait}",
          {
            or: [
              "feature:dragon-instinct",
              {
                not: "item:draconic-arrogance",
              },
            ],
          },
          {
            nor: ["item:animal-companion"],
          },
        ],
      }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Reactive Strike", "Sudden Charge"]);
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

  it("hides direct feat picks with embedded ChoiceSets until Wayfinder can render their choices", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("cat-fall", "Cat Fall", "skill", ["skill"]),
      featEntry("assured-training", "Assured Training", "skill", ["skill"], true, {
        rules: [
          {
            key: "ChoiceSet",
            flag: "trainedSkill",
            choices: [
              { value: "arcana", label: "Arcana" },
              { value: "crafting", label: "Crafting" },
            ],
          },
        ],
      }),
      featEntry("additional-lore", "Additional Lore", "skill", ["skill"], true, {
        rules: [
          {
            key: "ChoiceSet",
            flag: "lore",
          },
        ],
      }),
    ]);

    const directOptions = await getOptionsForStep(
      makeStep("skill-feat", {
        itemType: "feat",
        featTypes: ["skill"],
        maxLevel: 1,
      }),
      EMPTY_CONTEXT
    );
    const grantOptions = await getOptionsForStep(
      makeStep("grant-choice", {
        itemType: "feat",
        featTypes: ["skill"],
        maxLevel: 1,
      }),
      EMPTY_CONTEXT
    );

    expect(directOptions.map((option) => option.name)).toEqual(["Assured Training", "Cat Fall"]);
    expect(grantOptions.map((option) => option.name)).toEqual(["Additional Lore", "Assured Training", "Cat Fall"]);
  });

  it("filters class-branch choices to the selector tag for the drafted class", async () => {
    setPack("pf2e.classfeatures", [
      classFeatureEntry("scoundrel", "Scoundrel", ["rogue"], ["rogue-racket"]),
      classFeatureEntry("ruffian", "Ruffian", ["rogue"], ["rogue-racket"]),
      classFeatureEntry("battle-creed", "Battle Creed", ["cleric"], ["cleric-doctrine", "class-archetype"]),
      classFeatureEntry("empiricism", "Empiricism", ["investigator"], ["investigator-methodology"], {
        rules: [
          {
            key: "ChoiceSet",
            flag: "skill",
          },
        ],
      }),
      classFeatureEntry("interrogation", "Interrogation", ["investigator"], ["investigator-methodology"]),
      classFeatureEntry("known-methodology", "Known Methodology", ["investigator"], ["investigator-methodology"], {
        rules: [
          {
            key: "ChoiceSet",
            flag: "specialty",
            choices: [
              { value: "clues", label: "Clues" },
              { value: "deduction", label: "Deduction" },
            ],
          },
        ],
      }),
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

    const clericOptions = await getOptionsForStep(
      {
        id: "class-branch-doctrine-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Doctrine",
        description: "Choose a cleric doctrine.",
        required: true,
        slotId: "class-branch-doctrine-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-doctrine-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "doctrine",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.doctrine",
          selectorName: "Doctrine",
          selectorRuleIndex: 0,
          flag: "doctrine",
          optionTag: "cleric-doctrine",
          classSlug: "cleric",
          dependsOn: "class",
        },
      },
      {
        ...EMPTY_CONTEXT,
        classSlug: "cleric",
      }
    );

    expect(clericOptions.map((option) => option.name)).toEqual(["Warpriest"]);

    const investigatorOptions = await getOptionsForStep(
      {
        id: "class-branch-methodology-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Methodology",
        description: "Choose an investigator methodology.",
        required: true,
        slotId: "class-branch-methodology-level-1",
        filters: {
          itemType: "feat",
          featTypes: ["classfeature"],
          maxLevel: 1,
        },
        branch: {
          slotId: "class-branch-methodology-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "methodology",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.methodology",
          selectorName: "Methodology",
          selectorRuleIndex: 0,
          flag: "methodology",
          optionTag: "investigator-methodology",
          classSlug: "investigator",
          dependsOn: "class",
        },
      },
      {
        ...EMPTY_CONTEXT,
        classSlug: "investigator",
      }
    );

    expect(investigatorOptions.map((option) => option.name)).toEqual(["Interrogation", "Known Methodology"]);
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

  it("filters item-backed action branch choices from PF2E tactic predicates", async () => {
    setPack("pf2e.actionspf2e", [
      actionEntry(
        "coordinating-maneuvers",
        "Coordinating Maneuvers",
        ["brandish", "commander", "tactic"],
        ["commander-mobility-tactic"]
      ),
      actionEntry("strike-hard", "Strike Hard", ["brandish", "commander", "tactic"], ["commander-offensive-tactic"]),
      actionEntry(
        "take-the-high-ground",
        "Take the High Ground",
        ["brandish", "commander", "tactic"],
        ["commander-expert-tactic"]
      ),
      actionEntry("avoid-notice", "Avoid Notice", ["exploration"], []),
    ]);

    const options = await getOptionsForStep(
      {
        id: "class-branch-tactics-firstTactic-level-1",
        level: 1,
        kind: "class-branch",
        slotKind: "class-branch",
        title: "Tactics",
        description: "Choose a tactic.",
        required: true,
        slotId: "class-branch-tactics-firstTactic-level-1",
        filters: {
          itemType: "action",
          packIds: ["pf2e.actionspf2e"],
          predicate: [
            "item:trait:tactic",
            {
              or: ["item:tag:commander-mobility-tactic", "item:tag:commander-offensive-tactic"],
            },
          ],
        },
        branch: {
          slotId: "class-branch-tactics-firstTactic-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "tactics",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.tactics",
          selectorName: "Tactics",
          selectorRuleIndex: 0,
          flag: "firstTactic",
          optionTag: "firsttactic",
          classSlug: "commander",
          dependsOn: "class",
        },
      },
      {
        ...EMPTY_CONTEXT,
        classSlug: "commander",
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Coordinating Maneuvers", "Strike Hard"]);
    expect(options.map((option) => option.uuid)).toEqual([
      "Compendium.pf2e.actionspf2e.Item.coordinating-maneuvers",
      "Compendium.pf2e.actionspf2e.Item.strike-hard",
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

  it("filters adapted cantrip choices away from the class tradition", async () => {
    setPack("pf2e.spells-srd", [
      spellEntry("shield", "Shield", 1, ["arcane"], ["cantrip"]),
      spellEntry("guidance", "Guidance", 1, ["divine", "occult", "primal"], ["cantrip"]),
      spellEntry("heal", "Heal", 1, ["divine", "primal"], []),
    ]);

    const options = await getOptionsForStep(
      {
        id: "spell-choice-feat-adapted-cantrip-cantrip-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Adapted cantrip",
        description: "",
        required: true,
        slotId: "spell-choice-feat-adapted-cantrip-cantrip-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: {
          slotId: "spell-choice-feat-adapted-cantrip-cantrip-level-1",
          sourcePackId: "pf2e.feats-srd",
          sourceDocumentId: "adapted-cantrip",
          sourceUuid: "Compendium.pf2e.feats-srd.Item.adapted-cantrip",
          sourceName: "Adapted Cantrip",
          classSlug: "wizard",
          dependsOn: "class",
          destination: {
            type: "spellbook",
            key: "wizard-arcane-prepared",
            label: "Wizard spellbook",
            entryName: "Wizard spellbook",
            tradition: "arcane",
            ability: "int",
            prepared: "prepared",
          },
          count: 1,
          minRank: 0,
          maxRank: 0,
          cantrip: true,
          excludedTraditions: ["arcane"],
          curriculumSpellNames: [],
          additionalAllowedSpellNames: [],
          restrictToCommon: true,
        },
      },
      EMPTY_CONTEXT
    );

    expect(options.map((option) => option.name)).toEqual(["Guidance"]);
  });

  it("includes deity spell UUID allowances even when the spell is outside the class tradition", async () => {
    setPack("pf2e.spells-srd", [
      spellEntry("heal", "Heal", 1, ["divine"], []),
      spellEntry("y6rAdMK6EFlV6U0t", "Breathe Fire", 1, ["arcane", "primal"], []),
      spellEntry("fireball", "Fireball", 3, ["arcane", "primal"], []),
    ]);

    const options = await getOptionsForStep(
      {
        id: "spell-choice-cleric-rank-1-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Cleric prepared spells",
        description: "",
        required: true,
        slotId: "spell-choice-cleric-rank-1-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: {
          slotId: "spell-choice-cleric-rank-1-level-1",
          sourcePackId: "pf2e.classfeatures",
          sourceDocumentId: "cleric-spellcasting",
          sourceUuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
          sourceName: "Cleric Spellcasting",
          classSlug: "cleric",
          dependsOn: "class",
          destination: {
            type: "prepared",
            key: "cleric-divine-prepared",
            label: "Divine prepared spells",
            entryName: "Divine Prepared Spells",
            tradition: "divine",
            ability: "wis",
            prepared: "prepared",
          },
          count: 2,
          minRank: 1,
          maxRank: 1,
          cantrip: false,
          curriculumSpellNames: [],
          additionalAllowedSpellNames: [],
          additionalAllowedSpellUuids: ["Compendium.pf2e.spells-srd.Item.y6rAdMK6EFlV6U0t"],
          restrictToCommon: true,
        },
      },
      EMPTY_CONTEXT
    );

    expect(options.map((option) => option.name)).toEqual(["Breathe Fire", "Heal"]);
  });

  it("filters feat-owned innate cantrip choices to explicit spell slugs", async () => {
    setPack("pf2e.spells-srd", [
      spellEntry("shield", "Shield", 1, ["arcane"], ["cantrip"]),
      spellEntry("daze", "Daze", 1, ["divine", "occult"], ["cantrip"]),
      spellEntry("electric-arc", "Electric Arc", 1, ["arcane", "primal"], ["cantrip"]),
      spellEntry("guidance", "Guidance", 1, ["divine", "occult", "primal"], ["cantrip"]),
      spellEntry("heal", "Heal", 1, ["divine", "primal"], []),
    ]);

    const options = await getOptionsForStep(
      {
        id: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
        level: 1,
        kind: "spell-choice",
        slotKind: "spell-choice",
        title: "Arcane Tattoos",
        description: "",
        required: true,
        slotId: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
        filters: {
          itemType: "spell",
        },
        spellChoice: {
          slotId: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
          sourcePackId: "pf2e.feats-srd",
          sourceDocumentId: "arcane-tattoos",
          sourceUuid: "Compendium.pf2e.feats-srd.Item.arcane-tattoos",
          sourceName: "Arcane Tattoos",
          classSlug: null,
          dependsOn: null,
          destination: {
            type: "innate",
            key: "feat-arcane-tattoos-innate-arcane",
            label: "Innate arcane spells",
            entryName: "Innate Arcane Spells",
            tradition: "arcane",
            ability: "cha",
            prepared: "innate",
          },
          count: 1,
          minRank: 0,
          maxRank: 0,
          cantrip: true,
          allowedSpellSlugs: ["shield", "daze"],
          curriculumSpellNames: [],
          additionalAllowedSpellNames: [],
          restrictToCommon: true,
        },
      },
      EMPTY_CONTEXT
    );

    expect(options.map((option) => option.name)).toEqual(["Daze", "Shield"]);
  });

  it("allows the same spell in a different spellcasting destination but not twice in one destination", async () => {
    setPack("pf2e.spells-srd", [
      spellEntry("guidance", "Guidance", 1, ["divine", "occult"], ["cantrip"]),
      spellEntry("daze", "Daze", 1, ["divine", "occult"], ["cantrip"]),
    ]);
    const context: OptionContext = {
      ...EMPTY_CONTEXT,
      selectedSpellChoicesBySlotId: {
        "spell-choice-palatine-divine": {
          destinationKey: "palatine-detective-divine-innate",
          uuids: ["Compendium.pf2e.spells-srd.Item.guidance"],
        },
      },
    };

    const occultOptions = await getOptionsForStep(
      spellChoiceStep("spell-choice-palatine-occult", "palatine-detective-occult-innate", "occult"),
      context
    );
    const sameDestinationOptions = await getOptionsForStep(
      spellChoiceStep("spell-choice-palatine-divine-second", "palatine-detective-divine-innate", "divine"),
      context
    );

    expect(occultOptions.map((option) => option.name)).toEqual(["Daze", "Guidance"]);
    expect(sameDestinationOptions.map((option) => option.name)).toEqual(["Daze"]);
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

function featEntry(
  slug: string,
  name: string,
  featType: string,
  traits: string[],
  includeFeatType = true,
  systemOverrides: Record<string, unknown> = {}
): any {
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
      ...systemOverrides,
    },
  };
}

function classFeatureEntry(
  slug: string,
  name: string,
  traits: string[],
  otherTags: string[],
  systemOverrides: Record<string, unknown> = {}
): any {
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
      ...systemOverrides,
    },
  };
}

function actionEntry(slug: string, name: string, traits: string[], otherTags: string[]): any {
  return {
    _id: slug,
    name,
    img: `${slug}.webp`,
    type: "action",
    system: {
      slug,
      traits: {
        otherTags,
        value: traits,
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

function spellChoiceStep(slotId: string, destinationKey: string, tradition: string): PendingStep {
  return {
    id: slotId,
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: slotId,
    description: "",
    required: true,
    slotId,
    filters: { itemType: "spell" },
    spellChoice: {
      slotId,
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "palatine-detective",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.palatine-detective",
      sourceName: "Palatine Detective",
      classSlug: "investigator",
      dependsOn: "class-branch",
      destination: {
        type: "innate",
        key: destinationKey,
        label: destinationKey,
        entryName: destinationKey,
        tradition,
        ability: "int",
        prepared: "innate",
      },
      count: 1,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      requiresCurriculum: false,
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}
