import { beforeEach, describe, expect, it } from "vitest";
import { inspectActor } from "../src/actor-inspector";
import { applyDraftToActor } from "../src/actor-updater";
import { getEffectiveSingletonDocument } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import { fetchSelectionDocument } from "../src/pack/access";
import type { DraftState, PendingStep, SelectionRef } from "../src/types";
import { buildWayfinderAppPlan } from "../src/wayfinder/application/wayfinder-plan-builder-service";
import { buildActorHarness, selection, setGamePacks } from "./support/actor-updater-fixtures";

const ALL_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const testGlobals = globalThis as typeof globalThis & { CONFIG?: any };

describe("wayfinder golden path integration", () => {
  beforeEach(() => {
    setGamePacks({});
  });

  it("covers a martial baseline with post-boost class training and background lore", async () => {
    setGamePacks(buildGoldenPathPacks());

    const { actor } = buildActorHarness();
    primeActorSystem(actor);

    const draft = createEmptyDraft(1);
    draft.selections["ancestry-level-1"] = selection(
      "ancestry-level-1",
      "pf2e.ancestries",
      "human",
      "ancestry",
      "Human"
    );
    draft.selections["background-level-1"] = selection(
      "background-level-1",
      "pf2e.backgrounds",
      "acolyte",
      "background",
      "Acolyte"
    );
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "fighter", "class", "Fighter");
    draft.boosts.ancestry.selectedBoosts = {
      free1: "int",
      free2: "dex",
    };
    draft.boosts.background.selectedBoosts = {
      fixed: "wis",
      free: "cha",
    };
    draft.boosts.class.keyAbility = "str";
    draft.boosts.levels["1"] = ["str", "dex", "con", "wis"];

    const plan = await buildPlan(actor, draft);
    const trainingStep = expectSkillTrainingStep(plan, "fighter");

    expect(indexOfStep(plan, "ability-boosts-level-1")).toBeLessThan(indexOfStep(plan, trainingStep.slotId));
    expect(trainingStep.training).toMatchObject({
      classSlug: "fighter",
      additionalCount: 4,
      fixedSkills: ["religion"],
      fixedLores: ["Scribing Lore"],
      choiceRules: [
        {
          key: "class:fighterskill",
          flag: "fighterSkill",
        },
      ],
    });
    expect(plan.steps.some((step) => step.kind === "spell-choice")).toBe(false);

    draft.skillTrainings[trainingStep.slotId] = {
      ruleChoices: {
        "class:fighterskill": "athletics",
      },
      additional: ["crafting", "medicine", "society", "stealth"],
      loreChoices: {},
    };

    await applyDraftToActor(actor as never, draft, plan.steps);

    expect(readSkillRank(actor, "athletics")).toBe(1);
    expect(readSkillRank(actor, "crafting")).toBe(1);
    expect(readSkillRank(actor, "medicine")).toBe(1);
    expect(readSkillRank(actor, "society")).toBe(1);
    expect(readSkillRank(actor, "stealth")).toBe(1);
    expect(actor.items.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "lore", name: "Scribing Lore" }),
        expect.objectContaining({ type: "class", name: "Fighter" }),
      ])
    );
  });

  it("prompts for Human open language slots from the PF2E language config", async () => {
    const originalConfig = testGlobals.CONFIG;
    testGlobals.CONFIG = {
      PF2E: {
        languages: {
          common: "",
          draconic: "",
          dwarven: "",
          gnomish: "",
        },
      },
    };

    try {
      const packs = buildGoldenPathPacks();
      packs["pf2e.ancestries"].human.system.additionalLanguages = {
        count: 1,
        value: [],
      };
      setGamePacks(packs);

      const { actor } = buildActorHarness();
      primeActorSystem(actor);

      const draft = createEmptyDraft(1);
      draft.selections["ancestry-level-1"] = selection(
        "ancestry-level-1",
        "pf2e.ancestries",
        "human",
        "ancestry",
        "Human"
      );
      draft.selections["background-level-1"] = selection(
        "background-level-1",
        "pf2e.backgrounds",
        "acolyte",
        "background",
        "Acolyte"
      );
      draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "fighter", "class", "Fighter");
      draft.boosts.ancestry.selectedBoosts = {
        free1: "str",
        free2: "dex",
      };
      draft.boosts.background.selectedBoosts = {
        fixed: "int",
        free: "wis",
      };
      draft.boosts.class.keyAbility = "str";
      draft.boosts.levels["1"] = ["str", "dex", "con", "wis"];

      const plan = await buildPlan(actor, draft);
      const languageStep = expectLanguageStep(plan);

      expect(languageStep.languageChoice).toMatchObject({
        sourceName: "Human",
        grantedLanguages: ["common"],
        count: 2,
        options: [{ value: "draconic" }, { value: "dwarven" }, { value: "gnomish" }],
      });
    } finally {
      testGlobals.CONFIG = originalConfig;
    }
  });

  it("covers the elf elven-lore wizard path through training, languages, and spellbook import", async () => {
    setGamePacks(buildGoldenPathPacks());

    const { actor } = buildActorHarness();
    primeActorSystem(actor);

    const draft = createEmptyDraft(1);
    draft.selections["ancestry-level-1"] = selection("ancestry-level-1", "pf2e.ancestries", "elf", "ancestry", "Elf");
    draft.selections["heritage-level-1"] = selection(
      "heritage-level-1",
      "pf2e.heritages",
      "arctic-elf",
      "heritage",
      "Arctic Elf"
    );
    draft.selections["ancestry-feat-level-1"] = selection(
      "ancestry-feat-level-1",
      "pf2e.feats-srd",
      "elven-lore",
      "feat",
      "Elven Lore",
      "ancestry"
    );
    draft.selections["background-level-1"] = selection(
      "background-level-1",
      "pf2e.backgrounds",
      "acolyte",
      "background",
      "Acolyte"
    );
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");
    draft.branchSelections["class-branch-arcane-school-level-1"] = selection(
      "class-branch-arcane-school-level-1",
      "pf2e.classfeatures",
      "school-of-mentalism",
      "feat",
      "School of Mentalism",
      "classfeature"
    );
    draft.branchSelections["class-branch-arcane-thesis-level-1"] = selection(
      "class-branch-arcane-thesis-level-1",
      "pf2e.classfeatures",
      "staff-nexus",
      "feat",
      "Staff Nexus",
      "classfeature"
    );
    draft.boosts.ancestry.selectedBoosts = {
      fixed: "int",
      free: "dex",
    };
    draft.boosts.background.selectedBoosts = {
      fixed: "wis",
      free: "int",
    };
    draft.boosts.class.keyAbility = "int";
    draft.boosts.levels["1"] = ["int", "dex", "con", "wis"];

    const plan = await buildPlan(actor, draft);
    const trainingStep = expectSkillTrainingStep(plan, "wizard");
    const languageStep = expectLanguageStep(plan);
    const spellSteps = plan.steps.filter((step) => step.kind === "spell-choice");

    expect(indexOfStep(plan, "ability-boosts-level-1")).toBeLessThan(indexOfStep(plan, trainingStep.slotId));
    expect(indexOfStep(plan, trainingStep.slotId)).toBeLessThan(indexOfStep(plan, languageStep.slotId));
    expect(indexOfStep(plan, languageStep.slotId)).toBeLessThan(
      indexOfStep(plan, "spell-choice-wizard-spellbook-cantrips-level-1")
    );
    expect(trainingStep.training.fixedLores).toEqual(expect.arrayContaining(["Elf Lore", "Scribing Lore"]));
    expect(languageStep.languageChoice.count).toBe(4);
    expect(languageStep.languageChoice.options.map((option) => option.value)).toEqual(
      expect.arrayContaining(["draconic", "dwarven", "gnomish", "orcish"])
    );
    expect(spellSteps.map((step) => step.slotId)).toEqual(
      expect.arrayContaining([
        "spell-choice-wizard-spellbook-cantrips-level-1",
        "spell-choice-wizard-spellbook-rank-1-level-1",
        "spell-choice-wizard-curriculum-rank-1-level-1",
      ])
    );
    expect(spellSteps).toHaveLength(3);

    draft.skillTrainings[trainingStep.slotId] = {
      ruleChoices: {},
      additional: ["acrobatics", "athletics", "crafting", "medicine", "occultism", "society"],
      loreChoices: {},
    };
    draft.languageChoices[languageStep.slotId] = ["draconic", "dwarven", "gnomish", "orcish"];
    draft.spellChoices["spell-choice-wizard-spellbook-cantrips-level-1"] = [
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "detect-magic", "Detect Magic", 0),
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "electric-arc", "Electric Arc", 0),
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "guidance", "Guidance", 0),
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "light", "Light", 0),
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "mage-hand", "Mage Hand", 0),
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "message", "Message", 0),
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "prestidigitation", "Prestidigitation", 0),
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "ray-of-frost", "Ray of Frost", 0),
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "read-aura", "Read Aura", 0),
      spellSelection("spell-choice-wizard-spellbook-cantrips-level-1", "shield", "Shield", 0),
    ];
    draft.spellChoices["spell-choice-wizard-spellbook-rank-1-level-1"] = [
      spellSelection("spell-choice-wizard-spellbook-rank-1-level-1", "charm", "Charm", 1),
      spellSelection("spell-choice-wizard-spellbook-rank-1-level-1", "force-barrage", "Force Barrage", 1),
      spellSelection("spell-choice-wizard-spellbook-rank-1-level-1", "grease", "Grease", 1),
      spellSelection("spell-choice-wizard-spellbook-rank-1-level-1", "magic-weapon", "Magic Weapon", 1),
      spellSelection("spell-choice-wizard-spellbook-rank-1-level-1", "sleep", "Sleep", 1),
    ];
    draft.spellChoices["spell-choice-wizard-curriculum-rank-1-level-1"] = [
      spellSelection("spell-choice-wizard-curriculum-rank-1-level-1", "phantom-pain", "Phantom Pain", 1),
      spellSelection("spell-choice-wizard-curriculum-rank-1-level-1", "sure-strike", "Sure Strike", 1),
    ];

    await applyDraftToActor(actor as never, draft, plan.steps);

    const spellbookEntry = actor.items.contents.find(
      (item) => item.type === "spellcastingEntry" && item.name === "Arcane Prepared Spells"
    );
    const selectedSpellIds = new Set(
      actor.items.contents
        .filter((item) => item.type === "spell" && spellLocationValue(item) === spellbookEntry?.id)
        .map((item) => item.sourceId)
    );

    expect(readActorLanguages(actor)).toEqual(["draconic", "dwarven", "gnomish", "orcish"]);
    expect(actor.items.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "lore", name: "Elf Lore" }),
        expect.objectContaining({ type: "lore", name: "Scribing Lore" }),
        expect.objectContaining({ type: "feat", name: "Elven Lore" }),
        expect.objectContaining({ type: "spellcastingEntry", name: "Arcane Prepared Spells" }),
        expect.objectContaining({ type: "feat", name: "School of Mentalism" }),
        expect.objectContaining({ type: "feat", name: "Staff Nexus" }),
      ])
    );
    expect(selectedSpellIds.size).toBe(17);
    expect(Array.from(selectedSpellIds)).toEqual(
      expect.arrayContaining([
        "Compendium.pf2e.spells-srd.Item.detect-magic",
        "Compendium.pf2e.spells-srd.Item.charm",
        "Compendium.pf2e.spells-srd.Item.phantom-pain",
      ])
    );
  });

  it("covers a cleric deity path through class choices and prepared spell application", async () => {
    setGamePacks(buildGoldenPathPacks());

    const { actor } = buildActorHarness();
    primeActorSystem(actor);

    const draft = createEmptyDraft(1);
    draft.selections["ancestry-level-1"] = selection(
      "ancestry-level-1",
      "pf2e.ancestries",
      "human",
      "ancestry",
      "Human"
    );
    draft.selections["background-level-1"] = selection(
      "background-level-1",
      "pf2e.backgrounds",
      "acolyte",
      "background",
      "Acolyte"
    );
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "cleric", "class", "Cleric");
    draft.selections["deity-level-1"] = selection("deity-level-1", "pf2e.deities", "gorum", "deity", "Gorum");
    draft.boosts.ancestry.selectedBoosts = {
      free1: "str",
      free2: "wis",
    };
    draft.boosts.background.selectedBoosts = {
      fixed: "wis",
      free: "cha",
    };
    draft.boosts.class.keyAbility = "wis";
    draft.boosts.levels["1"] = ["str", "con", "dex", "wis"];

    const plan = await buildPlan(actor, draft);
    const sanctificationStep = expectClassChoiceStep(plan, "class-choice-deity-cleric-sanctification-level-1");
    const divineFontStep = expectClassChoiceStep(plan, "class-choice-divine-font-divineFont-level-1");
    const clericSpellStep = expectSpellStep(plan, "spell-choice-cleric-rank-1-level-1");

    expect(indexOfStep(plan, sanctificationStep.slotId)).toBeLessThan(indexOfStep(plan, clericSpellStep.slotId));
    expect(indexOfStep(plan, divineFontStep.slotId)).toBeLessThan(indexOfStep(plan, clericSpellStep.slotId));
    expect(divineFontStep.classChoice.options.map((option) => option.value)).toEqual(["heal", "harm"]);
    expect(clericSpellStep.spellChoice.additionalAllowedSpellNames).toContain("Burning Hands");

    draft.classChoices[sanctificationStep.slotId] = "holy";
    draft.classChoices[divineFontStep.slotId] = "harm";
    draft.spellChoices["spell-choice-cleric-cantrips-level-1"] = [
      spellSelection("spell-choice-cleric-cantrips-level-1", "divine-lance", "Divine Lance", 0),
      spellSelection("spell-choice-cleric-cantrips-level-1", "guidance", "Guidance", 0),
      spellSelection("spell-choice-cleric-cantrips-level-1", "light", "Light", 0),
      spellSelection("spell-choice-cleric-cantrips-level-1", "read-aura", "Read Aura", 0),
      spellSelection("spell-choice-cleric-cantrips-level-1", "stabilize", "Stabilize", 0),
    ];
    draft.spellChoices["spell-choice-cleric-rank-1-level-1"] = [
      spellSelection("spell-choice-cleric-rank-1-level-1", "burning-hands", "Burning Hands", 1),
      spellSelection("spell-choice-cleric-rank-1-level-1", "bless", "Bless", 1),
    ];

    await applyDraftToActor(actor as never, draft, plan.steps);

    const preparedEntry = actor.items.contents.find(
      (item) => item.type === "spellcastingEntry" && item.name === "Divine Prepared Spells"
    );
    const fontEntry = actor.items.contents.find(
      (item) => item.type === "spellcastingEntry" && item.name === "Divine Font (Harmful)"
    );
    const deityFeature = actor.items.contents.find(
      (item) => item.sourceId === "Compendium.pf2e.classfeatures.Item.deity-cleric"
    );
    const divineFontFeature = actor.items.contents.find(
      (item) => item.sourceId === "Compendium.pf2e.classfeatures.Item.divine-font"
    );

    expect(preparedEntry).toBeTruthy();
    expect(fontEntry).toBeTruthy();
    expect(deityFeature?.flags?.pf2e?.rulesSelections).toMatchObject({
      deity: "Compendium.pf2e.deities.Item.gorum",
      sanctification: "holy",
    });
    expect(divineFontFeature?.flags?.pf2e?.rulesSelections).toMatchObject({
      divineFont: "harm",
    });
    expect(readPreparedIds(preparedEntry, "slot0").slice(0, 5)).toEqual(
      spellIdsFor(actor, [
        "Compendium.pf2e.spells-srd.Item.divine-lance",
        "Compendium.pf2e.spells-srd.Item.guidance",
        "Compendium.pf2e.spells-srd.Item.light",
        "Compendium.pf2e.spells-srd.Item.read-aura",
        "Compendium.pf2e.spells-srd.Item.stabilize",
      ])
    );
    expect(readPreparedIds(preparedEntry, "slot1").slice(0, 2)).toEqual(
      spellIdsFor(actor, ["Compendium.pf2e.spells-srd.Item.burning-hands", "Compendium.pf2e.spells-srd.Item.bless"])
    );
    expect(actor.items.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "spell",
          sourceId: "Compendium.pf2e.spells-srd.Item.wdA52JJnsuQWeyqz",
        }),
      ])
    );
  });
});

async function buildPlan(actor: ReturnType<typeof buildActorHarness>["actor"], draft: DraftState) {
  return buildWayfinderAppPlan({
    actor,
    snapshot: inspectActor(actor),
    draft,
    resolveDocument: (itemType) => getEffectiveSingletonDocument(actor, draft, itemType),
    resolveArcaneSchoolDocument: async () => {
      const schoolSelection = draft.branchSelections["class-branch-arcane-school-level-1"];
      return schoolSelection ? fetchSelectionDocument(schoolSelection) : null;
    },
    localize: localizeValue,
  });
}

function localizeValue(value: string): string {
  return value
    .replace(/^PF2E\.Skill\./, "")
    .replace(/^PF2E\.SpecificRule\.Prompt\./, "")
    .replace(/^PF2E\./, "");
}

function expectSkillTrainingStep(plan: { steps: PendingStep[] }, classSlug: string) {
  const step = plan.steps.find((entry) => entry.kind === "skill-training" && entry.training.classSlug === classSlug);
  expect(step).toBeTruthy();
  return step as Extract<PendingStep, { kind: "skill-training" }>;
}

function expectLanguageStep(plan: { steps: PendingStep[] }) {
  const step = plan.steps.find((entry) => entry.kind === "language-choice");
  expect(step).toBeTruthy();
  return step as Extract<PendingStep, { kind: "language-choice" }>;
}

function expectClassChoiceStep(plan: { steps: PendingStep[] }, slotId: string) {
  const step = plan.steps.find((entry) => entry.kind === "class-choice" && entry.slotId === slotId);
  expect(step).toBeTruthy();
  return step as Extract<PendingStep, { kind: "class-choice" }>;
}

function expectSpellStep(plan: { steps: PendingStep[] }, slotId: string) {
  const step = plan.steps.find((entry) => entry.kind === "spell-choice" && entry.slotId === slotId);
  expect(step).toBeTruthy();
  return step as Extract<PendingStep, { kind: "spell-choice" }>;
}

function indexOfStep(plan: { steps: PendingStep[] }, slotId: string): number {
  const index = plan.steps.findIndex((step) => step.slotId === slotId);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function readSkillRank(actor: ReturnType<typeof buildActorHarness>["actor"], slug: string): number {
  return Number(actor.system?.skills?.[slug]?.rank ?? 0);
}

function readActorLanguages(actor: ReturnType<typeof buildActorHarness>["actor"]): string[] {
  const details = actor.system?.details as { languages?: { value?: unknown } } | undefined;
  return Array.isArray(details?.languages?.value)
    ? details.languages.value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function spellSelection(slotId: string, documentId: string, name: string, level: number): SelectionRef {
  return {
    slotId,
    packId: "pf2e.spells-srd",
    documentId,
    uuid: `Compendium.pf2e.spells-srd.Item.${documentId}`,
    itemType: "spell",
    featType: null,
    name,
    level,
  };
}

function spellLocationValue(item: { system?: { location?: { value?: unknown } | unknown } }): string | null {
  const location = item.system?.location;
  if (typeof location === "string" && location.length > 0) {
    return location;
  }

  if (location && typeof location === "object") {
    const locationRecord = location as { value?: unknown };
    if (typeof locationRecord.value === "string") {
      return locationRecord.value;
    }
  }

  return null;
}

function primeActorSystem(actor: ReturnType<typeof buildActorHarness>["actor"]): void {
  const system = (actor.system ??= {}) as Record<string, unknown>;
  const details = (system.details ??= {}) as Record<string, unknown>;
  details.languages = { value: [] };
  system.skills = {};
}

function readPreparedIds(
  item: { system?: { slots?: Record<string, { prepared?: Array<{ id?: string | null }> }> } } | undefined,
  slotKey: string
) {
  return (item?.system?.slots?.[slotKey]?.prepared ?? []).map((slot) => slot?.id ?? null);
}

function spellIdsFor(actor: ReturnType<typeof buildActorHarness>["actor"], sourceIds: string[]): Array<string | null> {
  return sourceIds.map((sourceId) => actor.items.contents.find((item) => item.sourceId === sourceId)?.id ?? null);
}

function buildGoldenPathPacks() {
  return {
    "pf2e.ancestries": {
      human: ancestryDocument("Human", {
        free1: {
          value: ALL_ABILITIES,
          selected: null,
        },
        free2: {
          value: ALL_ABILITIES,
          selected: null,
        },
      }),
      elf: ancestryDocument(
        "Elf",
        {
          fixed: {
            value: ["int"],
            selected: "int",
          },
          free: {
            value: ALL_ABILITIES,
            selected: null,
          },
        },
        ["common", "elven"],
        ["draconic", "dwarven", "gnomish", "orcish"]
      ),
    },
    "pf2e.heritages": {
      "arctic-elf": {
        name: "Arctic Elf",
        type: "heritage",
        system: {
          slug: "arctic-elf",
        },
      },
    },
    "pf2e.backgrounds": {
      acolyte: {
        name: "Acolyte",
        type: "background",
        system: {
          slug: "acolyte",
          boosts: {
            fixed: {
              value: ["wis"],
              selected: "wis",
            },
            free: {
              value: ALL_ABILITIES,
              selected: null,
            },
          },
          trainedSkills: {
            value: ["religion"],
            lore: ["Scribing Lore"],
          },
        },
      },
    },
    "pf2e.classes": {
      fighter: {
        name: "Fighter",
        type: "class",
        system: {
          slug: "fighter",
          keyAbility: {
            value: ["str", "dex"],
            selected: null,
          },
          trainedSkills: {
            additional: 3,
            value: [],
          },
          rules: [
            {
              key: "ChoiceSet",
              flag: "fighterSkill",
              prompt: "Choose your initial fighter skill",
              choices: [
                { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
                { value: "athletics", label: "PF2E.Skill.Athletics" },
              ],
            },
            {
              key: "ActiveEffectLike",
              path: "system.skills.{item|flags.system.rulesSelections.fighterSkill}.rank",
              value: 1,
            },
          ],
          items: {},
        },
      },
      wizard: {
        name: "Wizard",
        type: "class",
        system: {
          slug: "wizard",
          keyAbility: {
            value: ["int"],
            selected: null,
          },
          trainedSkills: {
            additional: 2,
            value: ["arcana"],
          },
          rules: [],
          items: {
            school: {
              level: 1,
              uuid: "Compendium.pf2e.classfeatures.Item.arcane-school-selector",
              name: "Arcane School",
            },
            thesis: {
              level: 1,
              uuid: "Compendium.pf2e.classfeatures.Item.arcane-thesis-selector",
              name: "Arcane Thesis",
            },
            spellcasting: {
              level: 1,
              uuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
              name: "Wizard Spellcasting",
            },
          },
        },
      },
      cleric: {
        name: "Cleric",
        type: "class",
        system: {
          slug: "cleric",
          keyAbility: {
            value: ["wis"],
            selected: null,
          },
          trainedSkills: {
            additional: 2,
            value: ["religion"],
          },
          rules: [],
          items: {
            deity: {
              level: 1,
              uuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
              name: "Deity",
            },
            font: {
              level: 1,
              uuid: "Compendium.pf2e.classfeatures.Item.divine-font",
              name: "Divine Font",
            },
            spellcasting: {
              level: 1,
              uuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
              name: "Cleric Spellcasting",
            },
          },
        },
      },
    },
    "pf2e.feats-srd": {
      "elven-lore": {
        name: "Elven Lore",
        type: "feat",
        system: {
          slug: "elven-lore",
          featType: {
            value: "ancestry",
          },
          description: {
            value:
              "<p>You gain the trained proficiency rank in Arcana and Nature.</p><p>You also gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore]{Additional Lore} general feat for Elf Lore.</p>",
          },
          rules: [
            {
              key: "ActiveEffectLike",
              mode: "upgrade",
              path: "system.skills.arcana.rank",
              value: 1,
            },
            {
              key: "ActiveEffectLike",
              mode: "upgrade",
              path: "system.skills.nature.rank",
              value: 1,
            },
            {
              key: "GrantItem",
              uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
            },
          ],
        },
      },
    },
    "pf2e.classfeatures": {
      "arcane-school-selector": {
        name: "Arcane School",
        type: "feat",
        system: {
          slug: "arcane-school",
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "arcaneSchool",
              choices: {
                filter: ["item:tag:wizard-arcane-school"],
              },
            },
            {
              key: "GrantItem",
              uuid: "{item|flags.system.rulesSelections.arcaneSchool}",
            },
          ],
        },
      },
      "arcane-thesis-selector": {
        name: "Arcane Thesis",
        type: "feat",
        system: {
          slug: "arcane-thesis",
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "arcaneThesis",
              choices: {
                filter: ["item:tag:wizard-arcane-thesis"],
              },
            },
            {
              key: "GrantItem",
              uuid: "{item|flags.system.rulesSelections.arcaneThesis}",
            },
          ],
        },
      },
      "school-of-mentalism": {
        name: "School of Mentalism",
        type: "feat",
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.school-of-mentalism",
          },
        },
        system: {
          slug: "school-of-mentalism",
          category: "classfeature",
          level: { value: 1 },
          description: {
            value:
              "<ul><li><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.phantom-pain], @UUID[Compendium.pf2e.spells-srd.Item.sure-strike]</li></ul>",
          },
        },
      },
      "staff-nexus": {
        name: "Staff Nexus",
        type: "feat",
        flags: {
          core: {
            sourceId: "Compendium.pf2e.classfeatures.Item.staff-nexus",
          },
        },
        system: {
          slug: "staff-nexus",
          category: "classfeature",
          level: { value: 1 },
        },
      },
      "wizard-spellcasting": {
        name: "Wizard Spellcasting",
        type: "feat",
        system: {
          slug: "wizard-spellcasting",
          category: "classfeature",
        },
      },
      "deity-cleric": {
        name: "Deity",
        type: "feat",
        system: {
          slug: "deity-cleric",
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "deity",
              choices: {
                itemType: "deity",
              },
            },
            {
              key: "GrantItem",
              uuid: "{item|flags.system.rulesSelections.deity}",
            },
            {
              key: "ChoiceSet",
              slug: "sanctification",
              choices: [
                {
                  value: "holy",
                  label: "Holy",
                  predicate: [
                    { or: ["deity:primary:sanctification:can:holy", "deity:primary:sanctification:must:holy"] },
                  ],
                },
                {
                  value: "unholy",
                  label: "Unholy",
                  predicate: [
                    {
                      or: ["deity:primary:sanctification:can:unholy", "deity:primary:sanctification:must:unholy"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      "divine-font": {
        name: "Divine Font",
        type: "feat",
        system: {
          slug: "divine-font",
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "divineFont",
              choices: [
                {
                  value: "heal",
                  label: "Heal",
                  predicate: "deity:primary:font:heal",
                },
                {
                  value: "harm",
                  label: "Harm",
                  predicate: "deity:primary:font:harm",
                },
              ],
            },
          ],
        },
      },
      "cleric-spellcasting": {
        name: "Cleric Spellcasting",
        type: "feat",
        system: {
          slug: "cleric-spellcasting",
          category: "classfeature",
        },
      },
    },
    "pf2e.deities": {
      gorum: {
        name: "Gorum",
        type: "deity",
        system: {
          sanctification: {
            modal: "can",
            what: ["holy", "unholy"],
          },
          font: ["heal", "harm"],
          spells: {
            1: "Compendium.pf2e.spells-srd.Item.burning-hands",
          },
        },
      },
    },
    "pf2e.spells-srd": {
      "detect-magic": spellDocument("Detect Magic", 0, "arcane"),
      "electric-arc": spellDocument("Electric Arc", 0, "arcane"),
      guidance: spellDocument("Guidance", 0, "arcane", "divine"),
      light: spellDocument("Light", 0, "arcane", "divine"),
      "mage-hand": spellDocument("Mage Hand", 0, "arcane"),
      message: spellDocument("Message", 0, "arcane"),
      prestidigitation: spellDocument("Prestidigitation", 0, "arcane"),
      "ray-of-frost": spellDocument("Ray of Frost", 0, "arcane"),
      "read-aura": spellDocument("Read Aura", 0, "arcane", "divine"),
      shield: spellDocument("Shield", 0, "arcane"),
      charm: spellDocument("Charm", 1, "arcane"),
      "force-barrage": spellDocument("Force Barrage", 1, "arcane"),
      grease: spellDocument("Grease", 1, "arcane"),
      "magic-weapon": spellDocument("Magic Weapon", 1, "arcane"),
      sleep: spellDocument("Sleep", 1, "arcane"),
      "phantom-pain": spellDocument("Phantom Pain", 1, "arcane"),
      "sure-strike": spellDocument("Sure Strike", 1, "arcane"),
      "divine-lance": spellDocument("Divine Lance", 0, "divine"),
      stabilize: spellDocument("Stabilize", 0, "divine"),
      "burning-hands": spellDocument("Burning Hands", 1, "arcane", "divine"),
      bless: spellDocument("Bless", 1, "divine"),
      rfZpqmj0AIIdkVIs: spellDocument("Heal", 1, "divine"),
      wdA52JJnsuQWeyqz: spellDocument("Harm", 1, "divine"),
    },
  };
}

function ancestryDocument(
  name: string,
  boosts: Record<string, { value: string[]; selected: string | null }>,
  grantedLanguages: string[] = ["common"],
  selectableLanguages: string[] = []
) {
  return {
    name,
    type: "ancestry",
    system: {
      boosts,
      languages: {
        value: grantedLanguages,
      },
      additionalLanguages: {
        count: 0,
        value: selectableLanguages,
      },
    },
  };
}

function spellDocument(name: string, rank: number, ...traditions: string[]) {
  return {
    name,
    type: "spell",
    system: {
      level: {
        value: rank,
      },
      traits: {
        traditions,
        value: [],
        rarity: "common",
      },
    },
  };
}
