import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { clearPackServiceCache } from "../src/pack/access";
import { projectedArchetypeFeat as projectArchetypeFeat } from "../src/pack/archetype-legality";
import { getOptionQueryForStep, getOptionsForStep, resolveSelection } from "../src/pack/options";
import { buildSteps } from "../src/progression";
import type { ActorSnapshot, OptionContext, PendingStep, PickItemSlotKind, SelectionRef } from "../src/types";
import { buildOptionContext } from "../src/wayfinder/application/option-context-service";
import { createPickItemStep } from "../src/wayfinder/domain/step-types";
import { withRestrictedSpellRarityAccess } from "../src/wayfinder/spell-choice/rarity-access";
import {
  PF2E_841_DRAGON_EIDOLON_RULES,
  pf2e841AngelEidolonEntry,
  pf2e841DragonEidolonEntry,
} from "./fixtures/pf2e-841-eidolons";

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

  it("discovers every installed pack matching a module-prefix allowlist wildcard", async () => {
    testGlobals.game.settings.get = () => "battlezoo-dragons.*";
    setPack("battlezoo-dragons.dragon-ancestries", [ancestryEntry("dragon", "Dragon")]);
    setPack("battlezoo-dragons.dragon-heritages", [heritageEntry("brine-dragon", "Brine Dragon", "dragon")]);
    setPack("other-module.ancestries", [ancestryEntry("outsider", "Outsider")]);

    const options = await getOptionsForStep(makeStep("ancestry", { itemType: "ancestry" }));

    expect(options.map((option) => option.name)).toEqual(["Dragon"]);
  });

  it("applies the existing item-type filters when the global allowlist wildcard searches all installed packs", async () => {
    testGlobals.game.settings.get = () => "*";
    setPack("homebrew.ancestries", [ancestryEntry("dragon", "Dragon")]);
    setPack("homebrew.feats", [featEntry("dragon-flight", "Dragon Flight", "ancestry", ["dragon"])]);
    testGlobals.game.packs.set("homebrew.journals", {
      documentName: "JournalEntry",
      metadata: { id: "homebrew.journals", type: "JournalEntry" },
      getIndex: async () => {
        throw new Error("Non-Item compendiums must not be indexed");
      },
    });

    const options = await getOptionsForStep(makeStep("ancestry", { itemType: "ancestry" }));

    expect(options.map((option) => option.name)).toEqual(["Dragon"]);
  });

  it("keeps equipment source policy isolated from ancestry, feat, and spell resolution", async () => {
    testGlobals.game.settings.get = (_moduleId: string, key: string) =>
      key === "additionalSourcePacks"
        ? "home.ancestries,home.feats,home.spells"
        : { allowedEquipmentPackFamilies: ["gear"] };
    setPack("home.ancestries", [ancestryEntry("homefolk", "Homefolk")]);
    setPack("home.feats", [featEntry("home-training", "Home Training", "general", [])]);
    setPack("home.spells", [spellEntry("home-spark", "Home Spark", 1, ["arcane"], ["cantrip"])]);
    setPack("gear.equipment", [
      ancestryEntry("gear-ancestry", "Gear Ancestry"),
      featEntry("gear-feat", "Gear Feat", "general", []),
      spellEntry("gear-spell", "Gear Spell", 1, ["arcane"], ["cantrip"]),
    ]);

    const ancestry = await getOptionsForStep(makeStep("ancestry", { itemType: "ancestry" }));
    const feats = await getOptionsForStep(
      makeStep("general-feat", { itemType: "feat", featTypes: ["general"], maxLevel: 1 })
    );
    const spells = await getOptionsForStep(spellChoiceStep("equipment-isolation", "test-arcane", "arcane"));

    expect(ancestry.map((option) => option.name)).toEqual(["Homefolk"]);
    expect(feats.map((option) => option.name)).toEqual(["Home Training"]);
    expect(spells.map((option) => option.name)).toEqual(["Home Spark"]);
  });

  it("shows player ancestries from mixed packs but excludes companion and eidolon support documents", async () => {
    testGlobals.game.settings.get = () => "mixed-content.ancestries";
    const evilEye = ancestryEntry("evil-eye", "Evil Eye");
    evilEye.system.traits.value = ["aberration", "evil-eye"];
    const ape = ancestryEntry("ape", "Ape");
    ape.system.traits.value = ["animal"];
    ape.system.boosts = { 0: { value: [] }, 1: { value: [] }, 2: { value: [] } };
    ape.system.rules = [
      { key: "ActiveEffectLike", path: "system.abilities.str.mod", value: 3 },
      { key: "ActiveEffectLike", path: "flags.system.companionCompendia.kind", value: "animal" },
    ];
    const eidolon = ancestryEntry("aberrant-eidolon", "Aberrant Eidolon");
    eidolon.system.traits.value = ["aberration", "eidolon"];
    eidolon.system.boosts = { 0: { value: [] }, 1: { value: [] }, 2: { value: [] } };
    setPack("mixed-content.ancestries", [evilEye, ape, eidolon]);

    const step = makeStep("ancestry", { itemType: "ancestry" });
    const options = await getOptionsForStep(step);

    expect(options.map((option) => option.name)).toEqual(["Evil Eye"]);
    await expect(resolveSelection("mixed-content.ancestries:ape", step)).resolves.toBeNull();
  });

  it("applies player-root eligibility to source-authored ancestry choices", async () => {
    testGlobals.game.settings.get = () => "mixed-content.ancestries";
    const companion = ancestryEntry("companion", "Companion");
    companion.system.traits.value = ["minion"];
    setPack("mixed-content.ancestries", [ancestryEntry("evil-eye", "Evil Eye"), companion]);

    const options = await getOptionsForStep(makeStep("grant-choice", { itemType: "ancestry" }));

    expect(options.map((option) => option.name)).toEqual(["Evil Eye"]);
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

  it("infers an unlinked third-party heritage only when its package exposes one ancestry", async () => {
    testGlobals.game.settings.get = () => "single-ancestry.*";
    setPack("single-ancestry.ancestries", [ancestryEntry("dungeon", "Dungeon")]);
    setPack("single-ancestry.heritages", [heritageEntry("tower", "Tower", null)]);

    const heritageStep = makeStep("heritage", { itemType: "heritage" });
    const forDungeon = await getOptionsForStep(heritageStep, {
      ...EMPTY_CONTEXT,
      ancestrySlug: "dungeon",
      ancestryTraits: ["dungeon"],
    });
    const forOutsider = await getOptionsForStep(heritageStep, {
      ...EMPTY_CONTEXT,
      ancestrySlug: "evil-eye",
      ancestryTraits: ["evil-eye"],
    });

    expect(forDungeon.map((option) => option.name)).toEqual(["Tower"]);
    expect(forOutsider).toEqual([]);
  });

  it("hides an ambiguous unlinked heritage when its package exposes several ancestries", async () => {
    testGlobals.game.settings.get = () => "many-ancestries.*";
    setPack("many-ancestries.ancestries", [ancestryEntry("evil-eye", "Evil Eye"), ancestryEntry("angel", "Angel")]);
    setPack("many-ancestries.heritages", [heritageEntry("unclear", "Unclear Heritage", null)]);

    const query = await getOptionQueryForStep(makeStep("heritage", { itemType: "heritage" }), {
      ...EMPTY_CONTEXT,
      ancestrySlug: "evil-eye",
      ancestryTraits: ["evil-eye"],
    });

    expect(query.options).toEqual([]);
    expect(query.suppressedOptions).toEqual([
      {
        uuid: "Compendium.many-ancestries.heritages.Item.unclear",
        name: "Unclear Heritage",
        reason: "ambiguous-heritage-ownership",
      },
    ]);
  });

  it("uses the compendium label when an option has no publication title", async () => {
    testGlobals.game.settings.get = () => "homebrew.ancestries";
    const entries = [ancestryEntry("star-eye", "Star Eye")];
    delete entries[0].system.publication;
    setPack("homebrew.ancestries", entries, [], "Homebrew Ancestries");

    const options = await getOptionsForStep(makeStep("ancestry", { itemType: "ancestry" }));

    expect(options[0]?.source).toBe("Homebrew Ancestries");
  });

  it("discloses generic and manual support boundaries for third-party classes", async () => {
    testGlobals.game.settings.get = () => "homebrew.classes";
    setPack("homebrew.classes", [classEntry("star-caller", "Star Caller")]);

    const options = await getOptionsForStep(makeStep("class", { itemType: "class" }));

    expect(options[0]?.disclosure).toContain("Third-party class");
    expect(options[0]?.disclosure).toContain("prose-only restrictions");
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

  it("reuses drafted-ancestry filtering for ancestry-only campaign sections", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("cooperative-nature", "Cooperative Nature", "ancestry", ["human"], false),
      featEntry("sky-herd-guard", "Sky Herd Guard", "ancestry", ["sarangay"], false),
    ]);
    const step = createPickItemStep(
      "campaign-feat",
      1,
      "Level 1 Ancestry Paragon",
      "",
      { itemType: "feat", featTypes: ["ancestry"], maxLevel: 1 },
      {
        slotId: "campaign-feat-xdy_ancestryparagon-level-1",
        campaignFeat: {
          sectionId: "xdy_ancestryparagon",
          sectionLabel: "Ancestry Paragon",
          groupSlotId: "xdy_ancestryparagon-1",
          supported: ["ancestry"],
          filter: { categories: ["ancestry"], traits: [], omitTraits: [], conjunction: "or" },
        },
      }
    );

    const options = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      ancestrySlug: "human",
      ancestryTraits: ["human"],
      classSlug: "fighter",
    });

    expect(options.map((option) => option.name)).toEqual(["Cooperative Nature"]);
  });

  it("keeps class and unknown campaign categories generic without invented class narrowing", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("fighter-feat", "Fighter Feat", "class", ["fighter"]),
      featEntry("cleric-feat", "Cleric Feat", "class", ["cleric"]),
      featEntry("mythic-feat", "Mythic Feat", "mythic", ["mythic"]),
    ]);
    const campaignStep = (supported: string[], id: string) =>
      createPickItemStep(
        "campaign-feat",
        1,
        id,
        "",
        { itemType: "feat", featTypes: supported, maxLevel: 1 },
        {
          slotId: `campaign-feat-${id}-level-1`,
          campaignFeat: {
            sectionId: id,
            sectionLabel: id,
            groupSlotId: `${id}-1`,
            supported,
            filter: { categories: supported, traits: [], omitTraits: [], conjunction: "or" },
          },
        }
      );
    const context = { ...EMPTY_CONTEXT, classSlug: "fighter" };

    expect(
      (await getOptionsForStep(campaignStep(["class"], "dual-class"), context)).map((option) => option.name)
    ).toEqual(["Cleric Feat", "Fighter Feat"]);
    expect((await getOptionsForStep(campaignStep(["mythic"], "custom"), context)).map((option) => option.name)).toEqual(
      ["Mythic Feat"]
    );
  });

  it("applies ancestry legality per candidate in a mixed campaign section", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("cooperative-nature", "Cooperative Nature", "ancestry", ["human"], false),
      featEntry("sky-herd-guard", "Sky Herd Guard", "ancestry", ["sarangay"], false),
      featEntry("fighter-feat", "Fighter Feat", "class", ["fighter"], false),
    ]);
    const step = createPickItemStep(
      "campaign-feat",
      1,
      "Mixed Campaign",
      "",
      { itemType: "feat", featTypes: ["ancestry", "class"], maxLevel: 1 },
      {
        slotId: "campaign-feat-mixed-level-1",
        campaignFeat: {
          sectionId: "mixed",
          sectionLabel: "Mixed Campaign",
          groupSlotId: "mixed-1",
          supported: ["ancestry", "class"],
          filter: {
            categories: ["ancestry", "class"],
            traits: [],
            omitTraits: [],
            conjunction: "or",
          },
        },
      }
    );

    const options = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      ancestrySlug: "human",
      ancestryTraits: ["human"],
      classSlug: "wizard",
    });

    expect(options.map((option) => option.name)).toEqual(["Cooperative Nature", "Fighter Feat"]);
  });

  it("enforces native campaign trait inclusion, omission, and conjunction filters", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("human-fighter", "Human Fighter", "class", ["human", "fighter"], false),
      featEntry("human-only", "Human Only", "class", ["human"], false),
      featEntry("human-fighter-rare", "Human Fighter Rare", "class", ["human", "fighter", "rare"], false),
    ]);
    const step = createPickItemStep("campaign-feat", 1, "Filtered Campaign", "", {
      itemType: "feat",
      featTypes: ["class"],
      traits: ["human", "fighter"],
      omitTraits: ["rare"],
      traitConjunction: "and",
      maxLevel: 1,
    });

    expect((await getOptionsForStep(step, EMPTY_CONTEXT)).map((option) => option.name)).toEqual(["Human Fighter"]);
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

    expect(options.map((option) => option.name)).toEqual(["Advanced Maneuver", "Combat Flexibility"]);
  });

  it("mirrors PF2E's dedicated Free Archetype pool without mixing in ordinary class feats", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("combat-flexibility", "Combat Flexibility", "class", ["fighter"]),
      featEntry("acrobat-dedication", "Acrobat Dedication", "class", ["archetype", "dedication"]),
      featEntry("contortionist", "Contortionist", "class", ["archetype"]),
    ]);
    const step = makeStep("archetype-feat", {
      itemType: "feat",
      featTypes: ["class"],
      maxLevel: 4,
    });

    const initialOptions = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: false,
    });
    const followUpOptions = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true,
    });

    expect(initialOptions.map((option) => option.name)).toEqual(["Acrobat Dedication"]);
    expect(followUpOptions.map((option) => option.name)).toEqual(["Contortionist"]);
  });

  it.each<PickItemSlotKind>([
    "class-feat",
    "archetype-feat",
  ])("enforces projected dedication lockout completion in the %s lane", async (slotKind) => {
    setPack("pf2e.feats-srd", [
      featEntry("acrobat-dedication", "Acrobat Dedication", "class", ["archetype", "dedication"]),
      featEntry("contortionist", "Contortionist", "class", ["archetype"], true, {
        prerequisites: { value: [{ value: "Acrobat Dedication" }] },
      }),
      featEntry("dodge-away", "Dodge Away", "class", ["archetype"], true, {
        prerequisites: { value: [{ value: "Acrobat Dedication" }] },
      }),
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);
    const step = makeStep(slotKind, {
      itemType: "feat",
      featTypes: ["class"],
      maxLevel: 4,
    });
    const dedication = projectedArchetype("Acrobat Dedication", "acrobat", true);

    const locked = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true,
      projectedArchetypeFeats: [dedication],
    });
    const stillLocked = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true,
      projectedArchetypeFeats: [dedication, projectedArchetype("Contortionist", "acrobat")],
    });
    const completed = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true,
      projectedArchetypeFeats: [
        dedication,
        projectedArchetype("Contortionist", "acrobat"),
        projectedArchetype("Dodge Away", "acrobat"),
      ],
    });

    expect(locked.some((option) => option.name === "Wizard Dedication")).toBe(false);
    expect(stillLocked.some((option) => option.name === "Wizard Dedication")).toBe(false);
    expect(completed.some((option) => option.name === "Wizard Dedication")).toBe(true);
  });

  it.each<PickItemSlotKind>([
    "class-feat",
    "archetype-feat",
  ])("requires the matching projected dedication family in the %s lane", async (slotKind) => {
    setPack("pf2e.feats-srd", [
      featEntry("acrobat-dedication", "Acrobat Dedication", "class", ["archetype", "dedication"]),
      featEntry("archer-dedication", "Archer Dedication", "class", ["archetype", "dedication"]),
      featEntry("contortionist", "Contortionist", "class", ["archetype"], true, {
        prerequisites: { value: [{ value: "Acrobat Dedication" }] },
      }),
      featEntry("quick-shot", "Quick Shot", "class", ["archetype"], true, {
        prerequisites: { value: [{ value: "Archer Dedication" }] },
      }),
    ]);
    const step = makeStep(slotKind, {
      itemType: "feat",
      featTypes: ["class"],
      maxLevel: 4,
    });

    const withoutDedication = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      projectedArchetypeFeats: [],
    });
    const withAcrobat = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true,
      projectedArchetypeFeats: [projectedArchetype("Acrobat Dedication", "acrobat", true)],
    });

    expect(withoutDedication.map((option) => option.name)).toEqual(["Acrobat Dedication", "Archer Dedication"]);
    expect(withAcrobat.map((option) => option.name)).toEqual(["Contortionist"]);
  });

  it("derives chained archetype feat membership from PF2E compendium folder ancestry", async () => {
    const advancedConcoction = featEntry("advanced-concoction", "Advanced Concoction", "class", ["archetype"], true, {
      prerequisites: { value: [{ value: "Basic Concoction" }] },
    });
    advancedConcoction.folder = "alchemist-level-6";
    setPack(
      "pf2e.feats-srd",
      [advancedConcoction],
      [
        { id: "alchemist-level-6", name: "Level 6", folder: "alchemist-family" },
        { id: "alchemist-family", name: "Alchemist", folder: "archetype-root" },
        { id: "archetype-root", name: "Archetype", folder: null },
      ]
    );

    const options = await getOptionsForStep(
      makeStep("archetype-feat", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 6,
      }),
      {
        ...EMPTY_CONTEXT,
        hasDedicationFeat: true,
        projectedArchetypeFeats: [
          {
            ...projectedArchetype("Alchemist Dedication", "alchemist", true),
            familyIds: ["dedication:alchemist", "pf2e.feats-srd:alchemist-family"],
          },
        ],
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Advanced Concoction"]);
  });

  it.each<PickItemSlotKind>([
    "class-feat",
    "archetype-feat",
  ])("excludes the current class's official multiclass dedication shape in the %s lane", async (slotKind) => {
    setPack("pf2e.feats-srd", [
      featEntry("fighter-dedication", "Fighter Dedication", "class", ["archetype", "dedication", "multiclass"]),
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);

    const options = await getOptionsForStep(
      makeStep(slotKind, {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 2,
      }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        projectedArchetypeFeats: [],
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Wizard Dedication"]);
  });

  it.each([
    [
      "Soulforger Dedication",
      "This Strike uses the same multiple attack penalty as the missed Strike and doesn't count toward your multiple attack penalty.",
    ],
    [
      "Tattooed Historian Dedication",
      "For every two tattooed historian feats you have, you can invest one magical tattoo that does not count against the maximum number of items you can have invested at one time.",
    ],
    [
      "Pactbinder Dedication",
      "You increase your proficiency from trained to expert in Diplomacy and in one of the following: Arcana, Nature, Occultism, or Religion. Many feats from this archetype involve swearing specific pacts.",
    ],
    [
      "Pistol Phenom Dedication",
      "This otherwise serves as Pistol Twirl for the purpose of meeting prerequisites, although as normal, it doesn't count as another pistol phenom feat for the purpose of meeting Pistol Phenom Dedication's special entry and taking another archetype.",
    ],
    [
      "Wellspring Mage Dedication",
      "Special You can't select another dedication feat until you gain two other feats from the Wellspring Mage archetype.",
    ],
  ])("does not exempt %s for unrelated or standard lockout prose", (name, description) => {
    expect(projectDedicationWithDescription(name, description).unresolvedLockoutException).toBeNull();
  });

  it.each([
    ["Juggler Dedication", PF2E_84_ARCHETYPE_DESCRIPTIONS.juggler, 1, ["dedication:juggler"], []],
    [
      "Magaambyan Attendant Dedication",
      PF2E_84_ARCHETYPE_DESCRIPTIONS.magaambyanAttendant,
      2,
      ["dedication:magaambyan-attendant", "dedication:halcyon-speaker"],
      ["dedication:halcyon-speaker"],
    ],
    [
      "Spellshot Dedication",
      PF2E_84_ARCHETYPE_DESCRIPTIONS.spellshot,
      2,
      ["dedication:spellshot", "dedication:beast-gunner"],
      ["dedication:beast-gunner"],
    ],
    [
      "Razmiran Priest Dedication",
      PF2E_84_ARCHETYPE_DESCRIPTIONS.razmiranPriest,
      2,
      ["dedication:razmiran-priest"],
      ["dedication:cleric"],
    ],
  ])("resolves PF2E 8.4's structured %s lockout", (name, description, count, families, allowed) => {
    const projected = projectDedicationWithDescription(name, description);
    expect(projected.unresolvedLockoutException).toBeNull();
    expect(projected.dedicationLockout).toEqual({
      requiredFollowUpCount: count,
      countingFamilyIds: families,
      allowedDedicationFamilyIds: allowed,
    });
  });

  it.each([
    ["Cavalier Dedication", PF2E_84_ARCHETYPE_DESCRIPTIONS.cavalier, "allowed-dedication"],
    [
      "Spell Trickster Dedication",
      "The two feats you gain from taking the dedication don't count toward this total.",
      "follow-up-qualification",
    ],
  ])("keeps %s's unstructured exception review-only", (name, description, unresolvedKind) => {
    const projected = projectDedicationWithDescription(name, description);
    expect(projected.unresolvedLockoutException).toBe(unresolvedKind);
    expect(projected.dedicationLockout).toMatchObject({
      requiredFollowUpCount: 2,
      allowedDedicationFamilyIds: [],
    });
  });

  it("keeps unresolved follow-up exclusions locked even when projected family feats reach the ordinary count", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);
    const spellTrickster = projectDedicationWithDescription(
      "Spell Trickster Dedication",
      "The two feats you gain from taking the dedication don't count toward this total."
    );

    const query = await getOptionQueryForStep(
      makeStep("archetype-feat", { itemType: "feat", featTypes: ["class"], maxLevel: 4 }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        hasDedicationFeat: true,
        projectedArchetypeFeats: [
          spellTrickster,
          projectedArchetype("Granted Trick One", "spell-trickster"),
          projectedArchetype("Granted Trick Two", "spell-trickster"),
        ],
      }
    );

    expect(query.options).toEqual([]);
    expect(query.suppressedOptions.map((option) => option.name)).toEqual(["Wizard Dedication"]);
  });

  it("keeps a definite dedication lockout distinct from an unresolved follow-up exception", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);
    const spellTrickster = projectDedicationWithDescription(
      "Spell Trickster Dedication",
      "The two feats you gain from taking the dedication don't count toward this total."
    );

    const query = await getOptionQueryForStep(
      makeStep("archetype-feat", { itemType: "feat", featTypes: ["class"], maxLevel: 4 }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        hasDedicationFeat: true,
        projectedArchetypeFeats: [spellTrickster],
      }
    );

    expect(query.options).toEqual([]);
    expect(query.suppressedOptions).toEqual([]);
  });

  it("reports Cavalier's unresolved GM-adjudicated exception as fail-closed suppression", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);

    const query = await getOptionQueryForStep(
      makeStep("archetype-feat", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 4,
      }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        hasDedicationFeat: true,
        projectedArchetypeFeats: [
          projectArchetypeFeat(
            {
              name: "Cavalier Dedication",
              system: {
                description: { value: PF2E_84_ARCHETYPE_DESCRIPTIONS.cavalier },
                traits: { value: ["archetype", "dedication"] },
              },
            },
            null
          ),
        ],
      }
    );

    expect(query.options).toEqual([]);
    expect(query.suppressedOptions.map((option) => option.name)).toEqual(["Wizard Dedication"]);
  });

  it("allows later dedications once Cavalier's ordinary follow-up count is met", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);
    const cavalier = projectDedicationWithDescription("Cavalier Dedication", PF2E_84_ARCHETYPE_DESCRIPTIONS.cavalier);

    const query = await getOptionQueryForStep(
      makeStep("archetype-feat", { itemType: "feat", featTypes: ["class"], maxLevel: 4 }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        hasDedicationFeat: true,
        projectedArchetypeFeats: [
          cavalier,
          projectedArchetype("Cavalier's Charge", "cavalier"),
          projectedArchetype("Impressive Mount", "cavalier"),
        ],
      }
    );

    expect(query.options.map((option) => option.name)).toEqual(["Wizard Dedication"]);
    expect(query.suppressedOptions).toEqual([]);
  });

  it.each([
    "policy-first",
    "ordinary-first",
  ] as const)("prefers a definite dedication lockout when projected blockers are %s", async (order) => {
    setPack("pf2e.feats-srd", [
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);
    const policyBlocker = projectDedicationWithDescription(
      "Cavalier Dedication",
      PF2E_84_ARCHETYPE_DESCRIPTIONS.cavalier
    );
    const ordinaryBlocker = projectedArchetype("Acrobat Dedication", "acrobat", true);
    const projectedArchetypeFeats =
      order === "policy-first" ? [policyBlocker, ordinaryBlocker] : [ordinaryBlocker, policyBlocker];

    const query = await getOptionQueryForStep(
      makeStep("archetype-feat", { itemType: "feat", featTypes: ["class"], maxLevel: 4 }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        hasDedicationFeat: true,
        projectedArchetypeFeats,
      }
    );

    expect(query.options).toEqual([]);
    expect(query.suppressedOptions).toEqual([]);
  });

  it.each([
    [
      "Magaambyan Attendant Dedication",
      PF2E_84_ARCHETYPE_DESCRIPTIONS.magaambyanAttendant,
      "halcyon-speaker-dedication",
      "Halcyon Speaker Dedication",
    ],
    [
      "Spellshot Dedication",
      PF2E_84_ARCHETYPE_DESCRIPTIONS.spellshot,
      "beast-gunner-dedication",
      "Beast Gunner Dedication",
    ],
    [
      "Razmiran Priest Dedication",
      PF2E_84_ARCHETYPE_DESCRIPTIONS.razmiranPriest,
      "cleric-dedication",
      "Cleric Dedication",
    ],
  ])("allows only %s's named early dedication", async (activeName, description, allowedSlug, allowedName) => {
    setPack("pf2e.feats-srd", [
      featEntry(allowedSlug, allowedName, "class", ["archetype", "dedication"]),
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);

    const options = await getOptionsForStep(
      makeStep("archetype-feat", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 4,
      }),
      {
        ...EMPTY_CONTEXT,
        classSlug: "fighter",
        hasDedicationFeat: true,
        projectedArchetypeFeats: [projectDedicationWithDescription(activeName, description)],
      }
    );

    expect(options.map((option) => option.name)).toEqual([allowedName]);
  });

  it("uses the Juggler one-feat count without unlocking unrelated dedications early", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);
    const step = makeStep("archetype-feat", {
      itemType: "feat",
      featTypes: ["class"],
      maxLevel: 4,
    });
    const juggler = projectDedicationWithDescription("Juggler Dedication", PF2E_84_ARCHETYPE_DESCRIPTIONS.juggler);
    const locked = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true,
      projectedArchetypeFeats: [juggler],
    });
    const complete = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true,
      projectedArchetypeFeats: [juggler, projectedArchetype("Focused Juggler", "juggler")],
    });

    expect(locked).toEqual([]);
    expect(complete.map((option) => option.name)).toEqual(["Wizard Dedication"]);
  });

  it("keeps Beast Gunner's own lockout after Spellshot permits taking it early", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);

    const beastGunner = projectedArchetype("Beast Gunner Dedication", "beast-gunner", true);
    beastGunner.familyIds.push("pf2e.feats-srd:beast-gunner-family");
    const firstBeastGunnerFollowUp = projectedArchetype("Black Powder Embodiment", "beast-gunner");
    firstBeastGunnerFollowUp.familyIds = ["pf2e.feats-srd:beast-gunner-family"];
    const secondBeastGunnerFollowUp = projectedArchetype("Call Gun", "beast-gunner");
    secondBeastGunnerFollowUp.familyIds = ["pf2e.feats-srd:beast-gunner-family"];
    const step = makeStep("archetype-feat", {
      itemType: "feat",
      featTypes: ["class"],
      maxLevel: 4,
    });
    const baseContext: OptionContext = {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true,
      projectedArchetypeFeats: [
        projectDedicationWithDescription("Spellshot Dedication", PF2E_84_ARCHETYPE_DESCRIPTIONS.spellshot),
        beastGunner,
      ],
    };
    const locked = await getOptionsForStep(step, {
      ...baseContext,
      projectedArchetypeFeats: [
        ...(baseContext.projectedArchetypeFeats ?? []),
        projectedArchetype("Fulminating Shot", "spellshot"),
        firstBeastGunnerFollowUp,
      ],
    });
    const complete = await getOptionsForStep(step, {
      ...baseContext,
      projectedArchetypeFeats: [
        ...(baseContext.projectedArchetypeFeats ?? []),
        firstBeastGunnerFollowUp,
        secondBeastGunnerFollowUp,
      ],
    });

    expect(locked).toEqual([]);
    expect(complete.map((option) => option.name)).toEqual(["Wizard Dedication"]);
  });

  it("blocks a duplicate dedication after its family lockout is complete", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("acrobat-dedication", "Acrobat Dedication", "class", ["archetype", "dedication"]),
      featEntry("wizard-dedication", "Wizard Dedication", "class", ["archetype", "dedication", "multiclass"]),
    ]);
    const context: OptionContext = {
      ...EMPTY_CONTEXT,
      classSlug: "fighter",
      hasDedicationFeat: true,
      projectedArchetypeFeats: [
        projectedArchetype("Acrobat Dedication", "acrobat", true),
        projectedArchetype("Contortionist", "acrobat"),
        projectedArchetype("Dodge Away", "acrobat"),
      ],
    };

    const options = await getOptionsForStep(
      makeStep("archetype-feat", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 4,
      }),
      context
    );

    expect(options.map((option) => option.name)).toEqual(["Wizard Dedication"]);
  });

  it("permits a distinct dedication in the same compendium family after the lockout is complete", async () => {
    const alternateDedication = featEntry("alternate-acrobat-dedication", "Alternate Acrobat Dedication", "class", [
      "archetype",
      "dedication",
    ]);
    alternateDedication.folder = "acrobat-level-2";
    setPack(
      "pf2e.feats-srd",
      [alternateDedication],
      [
        { id: "acrobat-level-2", name: "Level 2", folder: "acrobat-family" },
        { id: "acrobat-family", name: "Acrobat", folder: "archetype-root" },
        { id: "archetype-root", name: "Archetype", folder: null },
      ]
    );

    const options = await getOptionsForStep(
      makeStep("archetype-feat", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 4,
      }),
      {
        ...EMPTY_CONTEXT,
        hasDedicationFeat: true,
        projectedArchetypeFeats: [
          {
            ...projectedArchetype("Acrobat Dedication", "acrobat", true),
            familyIds: ["dedication:acrobat", "pf2e.feats-srd:acrobat-family"],
          },
          {
            ...projectedArchetype("Contortionist", "acrobat"),
            familyIds: ["dedication:acrobat", "pf2e.feats-srd:acrobat-family"],
          },
          {
            ...projectedArchetype("Dodge Away", "acrobat"),
            familyIds: ["dedication:acrobat", "pf2e.feats-srd:acrobat-family"],
          },
        ],
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Alternate Acrobat Dedication"]);
  });

  it("keeps a follow-up visible when its folder ancestry is not under PF2E's Archetype root", async () => {
    const advancedConcoction = featEntry("advanced-concoction", "Advanced Concoction", "class", ["archetype"], true, {
      prerequisites: { value: [{ value: "Basic Concoction" }] },
    });
    advancedConcoction.folder = "alchemist-level-6";
    setPack(
      "pf2e.feats-srd",
      [advancedConcoction],
      [
        { id: "alchemist-level-6", name: "Level 6", folder: "alchemist-family" },
        { id: "alchemist-family", name: "Alchemist", folder: "feat-root" },
        { id: "feat-root", name: "Feats", folder: null },
      ]
    );

    const options = await getOptionsForStep(
      makeStep("archetype-feat", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 6,
      }),
      {
        ...EMPTY_CONTEXT,
        hasDedicationFeat: true,
        projectedArchetypeFeats: [projectedArchetype("Acrobat Dedication", "acrobat", true)],
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Advanced Concoction"]);
  });

  it("matches an add-on follow-up to an official dedication through its explicit family alias", async () => {
    testGlobals.game.settings.get = () => "addon.*";
    const aerialist = featEntry("aerialist", "Aerialist", "class", ["archetype"], true, {
      prerequisites: { value: [{ value: "Acrobat Dedication" }] },
    });
    aerialist.folder = "addon-acrobat-level-4";
    setPack(
      "addon.feats",
      [aerialist],
      [
        { id: "addon-acrobat-level-4", name: "Level 4", folder: "addon-acrobat-family" },
        { id: "addon-acrobat-family", name: "Acrobat", folder: "addon-archetype-root" },
        { id: "addon-archetype-root", name: "Archetype", folder: null },
      ]
    );

    const options = await getOptionsForStep(
      makeStep("archetype-feat", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 4,
      }),
      {
        ...EMPTY_CONTEXT,
        hasDedicationFeat: true,
        projectedArchetypeFeats: [
          {
            ...projectedArchetype("Acrobat Dedication", "acrobat", true),
            familyIds: ["dedication:acrobat", "pf2e.feats-srd:acrobat-family"],
          },
        ],
      }
    );

    expect(options.map((option) => option.name)).toEqual(["Aerialist"]);
  });

  it("hides Free Archetype feats whose embedded choices have no guided follow-up", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("archer-dedication", "Archer Dedication", "class", ["archetype", "dedication"]),
      featEntry("dandy-dedication", "Dandy Dedication", "class", ["archetype", "dedication"], true, {
        rules: [{ key: "ChoiceSet", flag: "unsupported" }],
      }),
    ]);

    const options = await getOptionsForStep(
      makeStep("archetype-feat", {
        itemType: "feat",
        featTypes: ["class"],
        maxLevel: 2,
      }),
      EMPTY_CONTEXT
    );

    expect(options.map((option) => option.name)).toEqual(["Archer Dedication"]);
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

  it("feeds level-bounded draft skill increases into the production general-feat picker", async () => {
    const draft = createEmptyDraft(5);
    draft.skillIncreases["skill-increase-level-5"] = "medicine";
    const rankOneContext = await buildOptionContext({
      draft,
      maximumFeatLevel: 3,
      skillRanks: {
        medicine: 1,
      },
      resolveDocument: async () => null,
      listActorItems: () => [],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: () => null,
    });
    setPack("pf2e.feats-srd", [
      featEntry("ward-medic", "Ward Medic", "skill", ["general", "skill"], true, {
        level: { value: 2 },
        prerequisites: { value: [{ value: "expert in Medicine" }] },
      }),
    ]);
    const generalFeatStep = productionFeatStep("general-feat-level-3");

    expect(rankOneContext.skillRanks?.medicine).toBe(1);
    await expect(getOptionsForStep(generalFeatStep, rankOneContext)).resolves.toEqual([]);

    draft.skillIncreases["skill-increase-level-3"] = "medicine";
    const rankTwoContext = await buildOptionContext({
      draft,
      maximumFeatLevel: 3,
      skillRanks: {
        medicine: 1,
      },
      resolveDocument: async () => null,
      listActorItems: () => [],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: () => null,
    });
    const options = await getOptionsForStep(generalFeatStep, rankTwoContext);

    expect(rankTwoContext.skillRanks?.medicine).toBe(2);
    expect(options.map((option) => option.name)).toEqual(["Ward Medic"]);
  });

  it("filters an archetype feat against skill ranks projected from the draft", async () => {
    const draft = createEmptyDraft(4);
    draft.selections["class-feat-level-2"] = selectionRef(
      "class-feat-level-2",
      "feat",
      "acrobat-dedication",
      "Acrobat Dedication"
    );
    const buildContext = () =>
      buildOptionContext({
        draft,
        excludedFeatSlotId: "archetype-feat-level-4",
        maximumFeatLevel: 4,
        skillRanks: { acrobatics: 1 },
        resolveDocument: async () => null,
        listActorItems: () => [],
        fetchSelectionDocument: async (selection) =>
          selection.documentId === "acrobat-dedication"
            ? featEntry("acrobat-dedication", "Acrobat Dedication", "class", ["archetype", "dedication"])
            : null,
        extractDocumentSlug: () => null,
      });
    setPack("pf2e.feats-srd", [
      featEntry("expert-tumbler", "Expert Tumbler", "class", ["archetype"], true, {
        level: { value: 4 },
        prerequisites: {
          value: [{ value: "Acrobat Dedication" }, { value: "expert in Acrobatics" }],
        },
      }),
    ]);
    const step = makeStep("archetype-feat", {
      itemType: "feat",
      featTypes: ["class"],
      maxLevel: 4,
    });

    await expect(getOptionsForStep(step, await buildContext())).resolves.toEqual([]);

    draft.skillIncreases["skill-increase-level-3"] = "acrobatics";
    const options = await getOptionsForStep(step, await buildContext());

    expect(options.map((option) => option.name)).toEqual(["Expert Tumbler"]);
  });

  it("enforces expert prerequisites in the production skill-feat picker", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("ward-medic", "Ward Medic", "skill", ["general", "skill"], true, {
        level: { value: 2 },
        prerequisites: { value: [{ value: "expert in Medicine" }] },
      }),
    ]);
    const skillFeatStep = productionFeatStep("skill-feat-level-2");

    await expect(
      getOptionsForStep(skillFeatStep, {
        ...EMPTY_CONTEXT,
        skillRanks: { medicine: 1 },
      })
    ).resolves.toEqual([]);
    await expect(
      getOptionsForStep(skillFeatStep, {
        ...EMPTY_CONTEXT,
        skillRanks: { medicine: 2 },
      })
    ).resolves.toMatchObject([{ name: "Ward Medic" }]);
  });

  it("maps named skill prerequisites to trained through legendary ranks", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("trained-crafting", "Trained Crafting", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "trained in Crafting" }] },
      }),
      featEntry("expert-medicine", "Expert Medicine", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "expert in Medicine" }] },
      }),
      featEntry("master-athletics", "Master Athletics", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "master in Athletics" }] },
      }),
      featEntry("legendary-arcana", "Legendary Arcana", "skill", ["general", "skill"], true, {
        prerequisites: { value: [{ value: "legendary in Arcana" }] },
      }),
    ]);
    const skillFeatStep = productionFeatStep("skill-feat-level-2");

    await expect(
      getOptionsForStep(skillFeatStep, {
        ...EMPTY_CONTEXT,
        skillRanks: {
          arcana: 3,
          athletics: 2,
          crafting: 0,
          medicine: 1,
        },
      })
    ).resolves.toEqual([]);
    const options = await getOptionsForStep(skillFeatStep, {
      ...EMPTY_CONTEXT,
      skillRanks: {
        arcana: 4,
        athletics: 3,
        crafting: 1,
        medicine: 2,
      },
    });

    expect(options.map((option) => option.name)).toEqual([
      "Expert Medicine",
      "Legendary Arcana",
      "Master Athletics",
      "Trained Crafting",
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

  it("keeps an actor-owned deity available for its unresolved selector grant", async () => {
    setPack("pf2e.deities", [
      {
        _id: "GuUn4gElGNAT3Rbc",
        name: "Wulgren",
        img: "wulgren.webp",
        type: "deity",
        system: {
          category: "deity",
          publication: { title: "Pathfinder Lost Omens Divine Mysteries" },
          rules: [],
          traits: {},
        },
      },
    ]);

    const step = makeStep("deity", { itemType: "deity" });
    if (step.kind !== "pick-item") {
      throw new Error("Expected a deity pick-item step.");
    }
    step.grantSelection = {
      slotId: step.slotId,
      sourceItemType: "classfeature",
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: "deity-cleric",
      selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
      selectorName: "Deity",
      selectorRuleIndex: 0,
      grantRuleIndex: 1,
      flag: "deity",
      itemType: "deity",
      classSlug: "cleric",
      dependsOn: "class",
      filters: { itemType: "deity" },
    };

    const options = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "cleric",
      actorSourceIds: ["Compendium.pf2e.deities.Item.GuUn4gElGNAT3Rbc"],
    });

    expect(options.map((option) => option.name)).toEqual(["Wulgren"]);
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

    const directQuery = await getOptionQueryForStep(
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

    expect(directQuery.options.map((option) => option.name)).toEqual(["Assured Training", "Cat Fall"]);
    expect(directQuery.suppressedOptions).toEqual([
      {
        uuid: "Compendium.pf2e.feats-srd.Item.additional-lore",
        name: "Additional Lore",
        reason: "unvalidated-granted-choice",
      },
    ]);
    expect(grantOptions.map((option) => option.name)).toEqual(["Additional Lore", "Assured Training", "Cat Fall"]);
  });

  it("distinguishes unknown predicate suppression from ordinary predicate illegality", async () => {
    setPack("pf2e.feats-srd", [
      featEntry("cat-fall", "Cat Fall", "skill", ["skill"]),
      featEntry("battle-medicine", "Battle Medicine", "skill", ["skill"]),
      featEntry("assurance", "Assurance", "skill", ["skill"]),
    ]);

    const query = await getOptionQueryForStep(
      makeStep("skill-feat", {
        itemType: "feat",
        featTypes: ["skill"],
        maxLevel: 1,
        uuidPredicates: {
          "Compendium.pf2e.feats-srd.Item.cat-fall": ["item:trait:{actor|flags.system.unknown}"],
          "Compendium.pf2e.feats-srd.Item.battle-medicine": ["item:trait:holy"],
        },
      }),
      EMPTY_CONTEXT
    );

    expect(query.options.map((option) => option.name)).toEqual(["Assurance"]);
    expect(query.suppressedOptions).toEqual([
      {
        uuid: "Compendium.pf2e.feats-srd.Item.cat-fall",
        name: "Cat Fall",
        reason: "unvalidated-eligibility",
      },
    ]);
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

  it("guides PF2E 8.4.1 Dragon and Angel Eidolons and surfaces an unresolved predicate-backed branch", async () => {
    const driftedDragon = pf2e841DragonEidolonEntry() as any;
    driftedDragon._id = "drifted-dragon";
    driftedDragon.name = "Drifted Dragon Eidolon";
    driftedDragon.system.slug = "drifted-dragon-eidolon";
    driftedDragon.system.rules = structuredClone(PF2E_841_DRAGON_EIDOLON_RULES);
    driftedDragon.system.rules[2].path = "system.skills.{item|flags.system.rulesSelections.other.skill}.rank";
    setPack("pf2e.classfeatures", [pf2e841DragonEidolonEntry(), pf2e841AngelEidolonEntry(), driftedDragon]);
    const step: PendingStep = {
      id: "class-branch-eidolon-level-1",
      level: 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: "Eidolon",
      description: "Choose an eidolon.",
      required: true,
      slotId: "class-branch-eidolon-level-1",
      filters: {
        itemType: "feat",
        featTypes: ["classfeature"],
        predicate: ["item:tag:summoner-eidolon"],
      },
      branch: {
        slotId: "class-branch-eidolon-level-1",
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: "qOEpe596B0UjhcG0",
        selectorUuid: "Compendium.pf2e.classfeatures.Item.qOEpe596B0UjhcG0",
        selectorName: "Eidolon",
        selectorRuleIndex: 0,
        flag: "eidolon",
        optionTag: "summoner-eidolon",
        classSlug: "summoner",
        dependsOn: "class",
      },
    };

    const query = await getOptionQueryForStep(step, { ...EMPTY_CONTEXT, classSlug: "summoner" });

    expect(query.options.map((option) => option.name)).toEqual(["Angel Eidolon", "Dragon Eidolon"]);
    expect(query.suppressedOptions).toEqual([
      {
        uuid: "Compendium.pf2e.classfeatures.Item.drifted-dragon",
        name: "Drifted Dragon Eidolon",
        reason: "unvalidated-granted-choice",
      },
    ]);
  });

  it("keeps PF2E 8.4.1 Psychic minds visible when dedication-only prompts are inactive", async () => {
    const dedicationChoice = {
      adjustName: false,
      choices: "flags.system.psychic.dedication.psiCantrips",
      flag: "dedicationCantrip",
      key: "ChoiceSet",
      predicate: ["feat:psychic-dedication"],
      prompt: "PF2E.SpecificRule.Prompt.PsiCantrip",
      rollOption: "selected-psi-cantrip",
    };
    setPack("pf2e.classfeatures", [
      classFeatureEntry("the-distant-grasp", "The Distant Grasp", ["psychic"], ["psychic-conscious-mind"], {
        rules: [structuredClone(dedicationChoice)],
      }),
      classFeatureEntry("the-infinite-eye", "The Infinite Eye", ["psychic"], ["psychic-conscious-mind"], {
        rules: [structuredClone(dedicationChoice)],
      }),
    ]);
    const step: PendingStep = {
      id: "class-branch-conscious-mind-level-1",
      level: 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: "Conscious Mind",
      description: "Choose a conscious mind.",
      required: true,
      slotId: "class-branch-conscious-mind-level-1",
      filters: {
        itemType: "feat",
        featTypes: ["classfeature"],
        predicate: ["item:tag:psychic-conscious-mind"],
      },
      branch: {
        slotId: "class-branch-conscious-mind-level-1",
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: "conscious-mind",
        selectorUuid: "Compendium.pf2e.classfeatures.Item.conscious-mind",
        selectorName: "Conscious Mind",
        selectorRuleIndex: 0,
        flag: "consciousMind",
        optionTag: "psychic-conscious-mind",
        classSlug: "psychic",
        dependsOn: "class",
      },
    };

    const query = await getOptionQueryForStep(step, { ...EMPTY_CONTEXT, classSlug: "psychic" });

    expect(query.options.map((option) => option.name)).toEqual(["The Distant Grasp", "The Infinite Eye"]);
    expect(query.suppressedOptions).toEqual([]);
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

    const tacticalExcellenceStep: PendingStep = {
      id: "grant-choice-none-feat-tactical-excellence-firstTactic-level-4",
      level: 4,
      kind: "pick-item",
      slotKind: "grant-choice",
      title: "Tactical Excellence",
      description: "Choose a tactic.",
      required: true,
      slotId: "grant-choice-none-feat-tactical-excellence-firstTactic-level-4",
      filters: {
        itemType: "action",
        packIds: ["pf2e.actionspf2e"],
        predicate: [
          "item:trait:tactic",
          {
            or: [
              "item:tag:commander-mobility-tactic",
              "item:tag:commander-offensive-tactic",
              {
                and: ["item:tag:commander-expert-tactic", "tactical-excellence:2"],
              },
            ],
          },
        ],
      },
    };
    const firstSelectionOptions = await getOptionsForStep(tacticalExcellenceStep, EMPTY_CONTEXT);
    const secondSelectionOptions = await getOptionsForStep(tacticalExcellenceStep, {
      ...EMPTY_CONTEXT,
      rollOptions: ["tactical-excellence:2"],
    });

    expect(firstSelectionOptions.map((option) => option.name)).toEqual(["Coordinating Maneuvers", "Strike Hard"]);
    expect(secondSelectionOptions.map((option) => option.name)).toEqual([
      "Coordinating Maneuvers",
      "Strike Hard",
      "Take the High Ground",
    ]);
  });

  it("filters champion causes by the effective sanctification state", async () => {
    setPack("pf2e.classfeatures", [
      classFeatureEntry("justice", "Justice", ["champion"], ["champion-cause"]),
      classFeatureEntry("liberation", "Liberation", ["champion"], ["champion-cause"]),
      classFeatureEntry("obedience", "Obedience", ["champion"], ["champion-cause"]),
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

    const unresolvedQuery = await getOptionQueryForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "champion",
      deitySelected: true,
      sanctification: null,
    });
    const unresolvedOptions = unresolvedQuery.options;
    const holyQuery = await getOptionQueryForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "champion",
      deitySelected: true,
      sanctification: "holy",
    });
    const holyOptions = holyQuery.options;
    const unholyOptions = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "champion",
      deitySelected: true,
      sanctification: "unholy",
    });
    const nonSanctifyingOptions = await getOptionsForStep(step, {
      ...EMPTY_CONTEXT,
      classSlug: "champion",
      deitySelected: true,
      sanctification: "none",
    });

    expect(unresolvedOptions.map((option) => option.name)).toEqual([
      "Desecration",
      "Grandeur",
      "Iniquity",
      "Justice",
      "Liberation",
      "Obedience",
      "Redemption",
    ]);
    expect(unresolvedQuery.suppressedOptions).toEqual([]);
    expect(holyOptions.map((option) => option.name)).toEqual([
      "Grandeur",
      "Justice",
      "Liberation",
      "Obedience",
      "Redemption",
    ]);
    expect(holyQuery.suppressedOptions).toEqual([]);
    expect(unholyOptions.map((option) => option.name)).toEqual([
      "Desecration",
      "Iniquity",
      "Justice",
      "Liberation",
      "Obedience",
    ]);
    expect(nonSanctifyingOptions.map((option) => option.name)).toEqual(["Justice", "Liberation", "Obedience"]);
  });

  it("keeps sanctified Champion Dedication causes visible until sanctification resolves", async () => {
    setPack("pf2e.classfeatures", [
      classFeatureEntry("justice", "Justice", ["champion"], ["champion-cause"]),
      classFeatureEntry("liberation", "Liberation", ["champion"], ["champion-cause"]),
      classFeatureEntry("obedience", "Obedience", ["champion"], ["champion-cause"]),
      classFeatureEntry("redemption", "Redemption", ["champion"], ["champion-cause", "holy"]),
      classFeatureEntry("grandeur", "Grandeur", ["champion"], ["champion-cause", "holy"]),
      classFeatureEntry("desecration", "Desecration", ["champion"], ["champion-cause", "unholy"]),
      classFeatureEntry("iniquity", "Iniquity", ["champion"], ["champion-cause", "unholy"]),
      classFeatureEntry("holy-boon", "Holy Boon", ["champion"], ["holy"]),
    ]);
    const predicate = [
      "item:tag:champion-cause",
      {
        or: [
          { and: ["item:tag:holy", "sanctification:holy"] },
          { and: ["item:tag:unholy", "sanctification:unholy"] },
          { nor: ["item:tag:holy", "item:tag:unholy"] },
        ],
      },
      { not: "item:tag:class-archetype" },
    ];
    const step = makeStep("grant-choice", {
      itemType: "feat",
      featTypes: ["classfeature"],
      packIds: ["pf2e.classfeatures"],
      predicate,
    });

    const namesFor = async (sanctification: "holy" | "unholy" | "none" | null) =>
      (await getOptionsForStep(step, { ...EMPTY_CONTEXT, sanctification })).map((option) => option.name);

    await expect(namesFor(null)).resolves.toEqual([
      "Desecration",
      "Grandeur",
      "Iniquity",
      "Justice",
      "Liberation",
      "Obedience",
      "Redemption",
    ]);
    await expect(namesFor("holy")).resolves.toEqual(["Grandeur", "Justice", "Liberation", "Obedience", "Redemption"]);
    await expect(namesFor("unholy")).resolves.toEqual([
      "Desecration",
      "Iniquity",
      "Justice",
      "Liberation",
      "Obedience",
    ]);
    await expect(namesFor("none")).resolves.toEqual(["Justice", "Liberation", "Obedience"]);

    const genericSanctificationStep = makeStep("grant-choice", {
      itemType: "feat",
      featTypes: ["classfeature"],
      packIds: ["pf2e.classfeatures"],
      predicate: ["item:tag:holy", "sanctification:holy"],
    });
    await expect(
      getOptionsForStep(genericSanctificationStep, { ...EMPTY_CONTEXT, sanctification: null }).then((options) =>
        options.map((option) => option.name)
      )
    ).resolves.toEqual(["Grandeur", "Redemption"]);
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

  it("includes approved restricted rarities without relaxing spell list or rank policy", async () => {
    setPack("pf2e.spells-srd", [
      spellEntry("common-occult", "Common Occult", 1, ["occult"], ["cantrip"]),
      spellEntry("uncommon-occult", "Uncommon Occult", 1, ["occult"], ["cantrip"], "uncommon"),
      spellEntry("rare-divine", "Rare Divine", 1, ["divine"], ["cantrip"], "rare"),
      spellEntry("rare-ranked", "Rare Ranked", 1, ["occult"], [], "rare"),
    ]);
    const step = spellChoiceStep("spell-choice-witch-cantrips-level-1", "witch-occult-prepared", "occult");

    const restricted = await getOptionsForStep(step, EMPTY_CONTEXT);
    const granted = await getOptionsForStep(withRestrictedSpellRarityAccess(step, "common", true), EMPTY_CONTEXT);

    expect(restricted.map((option) => option.name)).toEqual(["Common Occult"]);
    expect(granted.map((option) => option.name)).toEqual(["Common Occult", "Uncommon Occult"]);
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

function projectedArchetype(name: string, family: string, dedication = false) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const familyIds = [`dedication:${family}`];
  return {
    uuid: `Compendium.pf2e.feats-srd.Item.${slug}`,
    name,
    slug,
    traits: dedication ? ["archetype", "dedication"] : ["archetype"],
    familyIds,
    dedicationLockout: dedication
      ? {
          requiredFollowUpCount: 2,
          countingFamilyIds: familyIds,
          allowedDedicationFamilyIds: [],
        }
      : null,
    unresolvedLockoutException: null,
  };
}

function projectDedicationWithDescription(name: string, description: string) {
  return projectArchetypeFeat(
    {
      name,
      system: {
        description: { value: description },
        traits: { value: ["archetype", "dedication"] },
      },
    },
    null
  );
}

const PF2E_84_ARCHETYPE_DESCRIPTIONS = {
  cavalier:
    "<p><strong>Special</strong> If you have pledged yourself to a cause, you can take a second dedication feat closely tied to that cause even if you haven't taken two additional Cavalier feats. The GM determines what archetypes, if any, are valid choices.</p>",
  juggler:
    "<p><strong>Special</strong> You cannot select another dedication feat until you have gained one other feat from the Juggler archetype.</p>",
  magaambyanAttendant:
    "<div><strong>Special</strong> You cannot select another dedication feat other than @UUID[Compendium.pf2e.feats-srd.Item.Halcyon Speaker Dedication] until you have gained two other feats from the @UUID[Compendium.pf2e.journals.JournalEntry.magaambyan]{Magaambyan Attendant} or @UUID[Compendium.pf2e.journals.JournalEntry.halcyon]{Halcyon Speaker} archetype.</div>",
  razmiranPriest:
    "<p>You can take the @UUID[Compendium.pf2e.feats-srd.Item.Cleric Dedication] feat without needing to meet its prerequisites and before you take two other feats from the Razmiran priest archetype, but you must choose Razmir as your deity.</p>",
  spellshot:
    "<p><strong>Special</strong> You can't select another dedication feat other than @UUID[Compendium.pf2e.feats-srd.Item.Beast Gunner Dedication] until you've gained two other feats from the @UUID[Compendium.pf2e.journals.JournalEntry.spellshot]{Spellshot} or @UUID[Compendium.pf2e.journals.JournalEntry.beast-gunner]{Beast Gunner} archetypes.</p>",
} as const;

function selectionRef(slotId: string, itemType: string, documentId: string, name: string): SelectionRef {
  return {
    slotId,
    packId: "pf2e.feats-srd",
    documentId,
    uuid: `Compendium.pf2e.feats-srd.Item.${documentId}`,
    itemType,
    featType: itemType === "feat" ? "class" : null,
    name,
    level: 2,
    slug: documentId,
  };
}

function productionFeatStep(slotId: string): PendingStep {
  const snapshot: ActorSnapshot = {
    actorId: "actor-1",
    level: 1,
    isBlank: false,
    freeArchetypeEnabled: false,
    campaignFeatSections: [],
    gradualBoostsEnabled: false,
    singletonSlots: {
      ancestry: true,
      heritage: true,
      background: true,
      class: true,
      deity: false,
    },
    featCounts: {
      ancestry: 0,
      class: 0,
      archetype: 0,
      skill: 0,
      general: 0,
    },
    fulfilledStepIds: [],
    sourceIds: [],
    namesByType: {},
    skillRanks: {},
  };
  const step = buildSteps(snapshot, 1, 3).find((entry) => entry.slotId === slotId);
  if (!step) {
    throw new Error(`Expected production progression step ${slotId}`);
  }
  return step;
}

function setPack(id: string, entries: any[], folders: any[] = [], label?: string): void {
  testGlobals.game.packs.set(id, {
    metadata: { id, label },
    folders: new Map(folders.map((folder) => [folder.id, folder])),
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
      boosts: {
        0: { value: ["str", "dex", "con", "int", "wis", "cha"] },
        1: { value: [] },
        2: { value: ["str", "dex", "con", "int", "wis", "cha"] },
      },
      languages: { value: ["common"], custom: "" },
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
      ancestryFeatLevels: { value: [1, 5, 9, 13, 17] },
      classFeatLevels: { value: [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
      generalFeatLevels: { value: [3, 7, 11, 15, 19] },
      skillFeatLevels: { value: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
      skillIncreaseLevels: { value: [3, 5, 7, 9, 11, 13, 15, 17, 19] },
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

function spellEntry(
  slug: string,
  name: string,
  level: number,
  traditions: string[],
  traits: string[],
  rarity = "common"
): any {
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
        rarity,
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
