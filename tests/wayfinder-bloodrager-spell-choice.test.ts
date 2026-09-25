import { describe, expect, it } from "vitest";
import { prepareDraftApplication } from "../src/actor-updater/prepared-draft-application";
import { applySpellChoiceDraft } from "../src/actor-updater/spell-choice-application";
import { createSpellcastingEntrySource } from "../src/actor-updater/spellcasting-entry-support";
import { createEmptyDraft } from "../src/draft-service";
import { matchesFilters } from "../src/pack/filter-policy";
import { getPickerBlockedState } from "../src/pack/picker-state";
import type { ActorItemLike } from "../src/shared/actor-model";
import { RISING_BLOOD_MAGIC_UUID } from "../src/shared/bloodrager-spellcasting";
import type { DraftState, OptionContext, SpellChoiceStep } from "../src/types";
import { buildBloodragerSpellChoiceSteps } from "../src/wayfinder/spell-choice/bloodrager-step-builder";
import { buildSpellChoiceSteps, readExistingSpellChoiceSelections } from "../src/wayfinder/spell-choice-service";
import { buildActorHarness, selection, setGamePacks } from "./support/actor-updater-fixtures";

const TRADITION_SLOT = "class-choice-bloodrager-dedication-skill-level-2";
const BLOODRAGER = { name: "Bloodrager", system: { slug: "bloodrager" } };
const RISING_BLOOD_MAGIC = {
  name: "Rising Blood Magic",
  type: "feat",
  sourceId: RISING_BLOOD_MAGIC_UUID,
  system: { slug: "rising-blood-magic", level: { value: 4 } },
};
const CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: "barbarian",
  classHasSpellcasting: true,
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: true,
};

describe("Bloodrager cantrip repertoire", () => {
  it.each(["arcana", "religion"])("offers two %s cantrips from level 2 through 5, requiring one attack", (skill) => {
    for (let level = 1; level <= 5; level += 1) {
      const draft = createEmptyDraft(level);
      draft.classChoices[TRADITION_SLOT] = skill;
      const steps = bloodragerSteps(draft);
      if (level === 1) {
        expect(steps).toEqual([]);
        continue;
      }
      expect(steps).toHaveLength(2);
      expect(steps[0].spellChoice.requiredTraits).toEqual(["attack"]);
      expect(steps[0].filters).toMatchObject({ traits: ["attack"], traitConjunction: "and" });
      expect(steps[1].spellChoice.requiredTraits).toBeUndefined();
      for (const step of steps) {
        expect(step).toMatchObject({
          level: 2,
          spellChoice: {
            count: 1,
            minRank: 0,
            maxRank: 0,
            cantrip: true,
            restrictToCommon: true,
            destination: {
              key: `bloodrager-${skill === "arcana" ? "arcane" : "divine"}-repertoire`,
              type: "spontaneous",
              ability: "cha",
              entryReuse: "key-only",
            },
          },
        });
      }
    }
  });

  it("registers the Barbarian contributor without adding spells to ordinary Barbarians", async () => {
    const draft = createEmptyDraft(5);
    draft.classChoices[TRADITION_SLOT] = "arcana";
    const params = {
      draft,
      currentLevel: 1,
      targetLevel: 5,
      effectiveClassDocument: { system: { slug: "barbarian" } },
      effectiveSchoolDocument: null,
      effectiveDeityDocument: null,
      extractSlug: () => "barbarian",
      readExistingSpellChoiceSelections: () => [],
    };
    await expect(buildSpellChoiceSteps(params)).resolves.toEqual([]);
    await expect(
      buildSpellChoiceSteps({ ...params, effectiveClassFeatureDocuments: [BLOODRAGER] })
    ).resolves.toHaveLength(2);
  });

  it.each([
    "system",
    "pf2e",
  ])("reads retained dedication tradition from %s flags but prefers the draft", (namespace) => {
    const draft = createEmptyDraft(5);
    const dedication = {
      system: { slug: "bloodrager-dedication" },
      flags: { [namespace]: { rulesSelections: { skill: "religion" } } },
    };
    const build = () =>
      buildBloodragerSpellChoiceSteps({
        draft,
        targetLevel: 5,
        effectiveClassFeatureDocuments: [BLOODRAGER, { system: { slug: "bloodrager-dedication" } }, dedication],
        readExistingSpellChoiceSelections: () => [],
      });
    expect(build()[0].spellChoice?.destination.tradition).toBe("divine");
    draft.classChoices[TRADITION_SLOT] = "arcana";
    expect(build()[0].spellChoice?.destination.tradition).toBe("arcane");
    draft.classChoices[TRADITION_SLOT] = "nature";
    expect(build()).toEqual([]);
  });

  it("waits for tradition selection instead of inventing one", () => {
    expect(bloodragerSteps(createEmptyDraft(5))).toEqual([]);
  });

  it.each([
    "arcana",
    "religion",
  ])("opens all %s repertoire pickers without requiring a Wizard arcane school", (skill) => {
    const draft = createEmptyDraft(5);
    draft.classChoices[TRADITION_SLOT] = skill;
    const steps = buildBloodragerSpellChoiceSteps({
      draft,
      targetLevel: 5,
      effectiveClassFeatureDocuments: [BLOODRAGER, RISING_BLOOD_MAGIC],
      readExistingSpellChoiceSelections: () => [],
    });
    expect(steps).toHaveLength(3);
    for (const step of steps) {
      expect(getPickerBlockedState(step, CONTEXT)).toBeNull();
    }
  });

  it.each([
    "arcana",
    "religion",
  ])("adds a rank-one %s spell only with the real selected Rising Blood Magic source at levels 4 and 5", (skill) => {
    const draft = createEmptyDraft(3);
    draft.classChoices[TRADITION_SLOT] = skill;
    const build = (features = [RISING_BLOOD_MAGIC]) =>
      buildBloodragerSpellChoiceSteps({
        draft,
        targetLevel: draft.targetLevel,
        effectiveClassFeatureDocuments: [BLOODRAGER, ...features],
        readExistingSpellChoiceSelections: () => [],
      });
    expect(build()).toHaveLength(2);
    for (const level of [4, 5]) {
      draft.targetLevel = level;
      const steps = build();
      expect(steps).toHaveLength(3);
      expect(steps[2]).toMatchObject({
        slotId: `spell-choice-bloodrager-${skill === "arcana" ? "arcane" : "divine"}-rank-1-level-4`,
        level: 4,
        spellChoice: { minRank: 1, maxRank: 1, count: 1, cantrip: false, sourceUuid: RISING_BLOOD_MAGIC_UUID },
      });
      expect(build([])).toHaveLength(2);
      expect(build([{ ...RISING_BLOOD_MAGIC, sourceId: "Compendium.thirdparty.feats.Item.impostor" }])).toHaveLength(2);
    }
  });

  it("requires a genuinely drafted or owned Rising Blood Magic feat before adding its one ranked slot", () => {
    const draft = divineDraft();
    const [step] = bloodragerSteps(draft);
    const slots = (actor = {}) => createSpellcastingEntrySource(step.spellChoice, actor, draft).system?.slots;
    expect(slots()).toHaveProperty("slot0.max", 2);
    expect(slots()).not.toHaveProperty("slot1");
    draft.selections["class-feat-level-4"] = selection(
      "class-feat-level-4",
      "pf2e.feats-srd",
      "QRqs9NIWeh0ONRSP",
      "feat",
      "Rising Blood Magic"
    );
    expect(slots()).toHaveProperty("slot1.max", 1);
    delete draft.selections["class-feat-level-4"];
    const { actor } = buildActorHarness({ items: [RISING_BLOOD_MAGIC] });
    expect(slots(actor)).toHaveProperty("slot1.max", 1);
    draft.targetLevel = 3;
    expect(slots(actor)).not.toHaveProperty("slot1");
  });

  it("adds the Rising Blood Magic spell incrementally to the same repertoire and preserves it on reopening", async () => {
    const { actor } = buildActorHarness({ level: 2 });
    const draft = divineDraft();
    draft.targetLevel = 2;
    const cantripSteps = bloodragerSteps(draft);
    setGamePacks({
      "pf2e.spells-srd": {
        needle: spellDocument("Needle Darts", ["cantrip", "attack"]),
        guidance: spellDocument("Guidance", ["cantrip"]),
        heal: {
          ...spellDocument("Heal", ["healing"]),
          system: { ...spellDocument("Heal", ["healing"]).system, level: { value: 1 } },
        },
      },
    });
    draft.spellChoices[cantripSteps[0].slotId] = [spellSelection(cantripSteps[0].slotId, "needle")];
    draft.spellChoices[cantripSteps[1].slotId] = [spellSelection(cantripSteps[1].slotId, "guidance")];
    await applySpellChoiceDraft(actor, draft, cantripSteps);
    const levelFourDraft = divineDraft();
    levelFourDraft.targetLevel = 4;
    levelFourDraft.selections["class-feat-level-4"] = selection(
      "class-feat-level-4",
      "pf2e.feats-srd",
      "QRqs9NIWeh0ONRSP",
      "feat",
      "Rising Blood Magic"
    );
    const stepsFor = (nextDraft: DraftState) =>
      buildBloodragerSpellChoiceSteps({
        draft: nextDraft,
        targetLevel: nextDraft.targetLevel,
        effectiveClassFeatureDocuments: [BLOODRAGER, RISING_BLOOD_MAGIC],
        readExistingSpellChoiceSelections: (choice) => readExistingSpellChoiceSelections(actor, choice),
      });
    const [rankedStep] = stepsFor(levelFourDraft);
    expect(stepsFor(levelFourDraft)).toHaveLength(1);
    expect(rankedStep.level).toBe(4);
    levelFourDraft.spellChoices[rankedStep.slotId] = [spellSelection(rankedStep.slotId, "heal")];
    await applySpellChoiceDraft(actor, levelFourDraft, [rankedStep]);
    actor.items.contents.push(RISING_BLOOD_MAGIC);
    await applySpellChoiceDraft(actor, levelFourDraft, [rankedStep]);
    expect(actor.items.contents.filter((item) => item.type === "spell")).toHaveLength(3);
    const entries = actor.items.contents.filter((item) => item.type === "spellcastingEntry");
    expect(entries).toHaveLength(1);
    expect(entries[0].system?.slots).toMatchObject({ slot0: { max: 2 }, slot1: { max: 1 } });
    expect(stepsFor(divineDraft())).toEqual([]);
  });

  it("does not let a single unstamped attack cantrip satisfy both choices", () => {
    const draft = divineDraft();
    const [attack, second] = bloodragerSteps(draft);
    const entry = { ...createSpellcastingEntrySource(attack.spellChoice, {}, draft), id: "entry" };
    const ownedAttack = {
      ...spellDocument("Needle Darts", ["cantrip", "attack"]),
      id: "attack",
      flags: { core: { sourceId: "Compendium.pf2e.spells-srd.Item.needle" } },
      system: { ...spellDocument("Needle Darts", ["cantrip", "attack"]).system, location: { value: "entry" } },
    };
    const { actor } = buildActorHarness({ level: 5, items: [entry, ownedAttack] });
    expect(bloodragerSteps(draft, actor).map((step) => step.slotId)).toEqual([second.slotId]);
    actor.items.contents.push({
      ...spellDocument("Guidance", ["cantrip"]),
      id: "second",
      flags: { core: { sourceId: "Compendium.pf2e.spells-srd.Item.guidance" } },
      system: { ...spellDocument("Guidance", ["cantrip"]).system, location: { value: "entry" } },
    });
    expect(bloodragerSteps(draft, actor)).toEqual([]);
  });

  it("requires an attack cantrip while allowing a second attack and enforcing tradition, rank and rarity", () => {
    const draft = divineDraft();
    const [attack, second] = bloodragerSteps(draft);
    const needle = spellDocument("Needle Darts", ["cantrip", "attack"]);
    const guidance = spellDocument("Guidance", ["cantrip"]);
    const passes = (document: ReturnType<typeof spellDocument>, step = attack) =>
      matchesFilters(document, "pf2e.spells-srd", step, CONTEXT, new Set());
    expect(passes(needle)).toBe(true);
    expect(passes(guidance)).toBe(false);
    expect(passes(guidance, second)).toBe(true);
    expect(passes(needle, second)).toBe(true);
    expect(passes(spellDocument("Arcane only", ["cantrip", "attack"], ["arcane"]))).toBe(false);
    expect(passes(spellDocument("Ranked", ["attack"]))).toBe(false);
    expect(passes(spellDocument("Rare", ["cantrip", "attack"], ["divine"], "rare"))).toBe(false);
    expect(passes(guidance, { ...attack, filters: { itemType: "spell" } })).toBe(false);
  });

  it.each([
    "arcana",
    "religion",
  ])("creates only two cantrip slots for %s and never full caster ranked slots", (skill) => {
    const draft = createEmptyDraft(5);
    draft.classChoices[TRADITION_SLOT] = skill;
    const [step] = bloodragerSteps(draft);
    const source = createSpellcastingEntrySource(step.spellChoice, {}, draft);
    expect(source.system).toMatchObject({
      ability: { value: "cha" },
      prepared: { value: "spontaneous" },
      publication: { title: "Pathfinder War of Immortals", license: "ORC", remaster: true },
      slots: { slot0: { max: 2, value: 2 } },
    });
    expect(Object.keys(source.system?.slots ?? {})).toEqual(["slot0"]);
  });

  it("rejects a non-attack selection at preflight before creating actor documents", async () => {
    const { actor } = buildActorHarness();
    const draft = divineDraft();
    const steps = bloodragerSteps(draft);
    const guidance = spellDocument("Guidance", ["cantrip"]);
    draft.spellChoices[steps[0].slotId] = [spellSelection(steps[0].slotId, "guidance")];
    draft.spellChoices[steps[1].slotId] = [spellSelection(steps[1].slotId, "shield")];
    await expect(
      prepareDraftApplication(actor as never, draft, steps, {
        validateActorAuthority: () => true,
        assertAcquisitionApplyAuthority: () => undefined,
        validateSelectionEligibility: (_selection, step) =>
          matchesFilters(guidance, "pf2e.spells-srd", step, CONTEXT, new Set()),
      })
    ).rejects.toThrow(/no longer eligible/);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("applies a valid pair once, keeps unrelated entries separate, and suppresses both steps on reopening", async () => {
    const unrelatedEntry: ActorItemLike = {
      id: "sorcerer-entry",
      name: "Divine Repertoire",
      type: "spellcastingEntry",
      system: { ability: { value: "cha" }, tradition: { value: "divine" }, prepared: { value: "spontaneous" } },
    };
    const { actor } = buildActorHarness({ level: 5, items: [unrelatedEntry] });
    const draft = divineDraft();
    const steps = bloodragerSteps(draft);
    setGamePacks({
      "pf2e.spells-srd": {
        needle: spellDocument("Needle Darts", ["cantrip", "attack"]),
        guidance: spellDocument("Guidance", ["cantrip"]),
      },
    });
    draft.spellChoices[steps[0].slotId] = [spellSelection(steps[0].slotId, "needle")];
    draft.spellChoices[steps[1].slotId] = [spellSelection(steps[1].slotId, "guidance")];
    const docs = {
      needle: spellDocument("Needle Darts", ["cantrip", "attack"]),
      guidance: spellDocument("Guidance", ["cantrip"]),
    };
    await expect(
      prepareDraftApplication(actor as never, draft, steps, {
        validateActorAuthority: () => true,
        assertAcquisitionApplyAuthority: () => undefined,
        validateSelectionEligibility: (selected, step) =>
          matchesFilters(docs[selected.documentId as keyof typeof docs], "pf2e.spells-srd", step, CONTEXT, new Set()),
      })
    ).resolves.toBeDefined();
    await applySpellChoiceDraft(actor, draft, steps);
    await applySpellChoiceDraft(actor, draft, steps);
    const entries = actor.items.contents.filter((item) => item.type === "spellcastingEntry");
    const spells = actor.items.contents.filter((item) => item.type === "spell");
    expect(entries).toHaveLength(2);
    expect(spells).toHaveLength(2);
    const bloodragerEntry = entries.find(
      (entry) => entry.flags?.["wayfinder-pf2e"]?.destinationKey === "bloodrager-divine-repertoire"
    );
    expect(bloodragerEntry?.id).not.toBe(unrelatedEntry.id);
    expect(spells.map((spell) => spell.system?.location)).toEqual(Array(2).fill({ value: bloodragerEntry?.id }));
    expect(bloodragerSteps(divineDraft(), actor)).toEqual([]);
    // An invalid retained attack slot must not satisfy the attack requirement.
    spells[0].system!.traits!.value = ["cantrip"];
    expect(bloodragerSteps(divineDraft(), actor).map((step) => step.slotId)).toEqual([steps[0].slotId]);
  });
});

function divineDraft(): DraftState {
  const draft = createEmptyDraft(5);
  draft.classChoices[TRADITION_SLOT] = "religion";
  return draft;
}

function bloodragerSteps(draft: DraftState, actor: unknown = null): SpellChoiceStep[] {
  return buildBloodragerSpellChoiceSteps({
    draft,
    targetLevel: draft.targetLevel,
    effectiveClassFeatureDocuments: [BLOODRAGER],
    readExistingSpellChoiceSelections: (choice) => readExistingSpellChoiceSelections(actor, choice),
  }) as SpellChoiceStep[];
}

function spellDocument(name: string, traits: string[], traditions = ["divine"], rarity = "common") {
  return {
    name,
    type: "spell",
    system: { level: { value: 0 }, traits: { value: traits, traditions, rarity } },
  };
}

function spellSelection(slotId: string, id: string) {
  return selection(slotId, "pf2e.spells-srd", id, "spell", id);
}
