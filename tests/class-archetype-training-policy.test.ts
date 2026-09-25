import { describe, expect, it } from "vitest";
import { projectPreparedSkillSources } from "../src/actor-updater/prepared-skill-source-projection";
import { applyTrainingDraft } from "../src/actor-updater/training-application";
import type { EffectiveBuildState } from "../src/build-state";
import { createEmptyDraft } from "../src/draft-service";
import { extractDocumentSlug } from "../src/shared/slug";
import type { SelectionRef } from "../src/types";
import { compileSkillPaneProgression } from "../src/wayfinder/application/build-skill-pane-service";
import { type ClassArchetypeProfile, classArchetypeProfile } from "../src/wayfinder/class-archetype/registry";
import {
  classArchetypeInitialTrainingProjection,
  withClassArchetypeInitialTraining,
} from "../src/wayfinder/class-archetype/training-policy";
import { buildClassTrainingSteps } from "../src/wayfinder/class-choice-service";
import { compileSkillProgression } from "../src/wayfinder/domain/skill-progression";
import {
  createClassArchetypeStep,
  createPickItemStep,
  createSkillTrainingStep,
} from "../src/wayfinder/domain/step-types";

describe("class archetype initial training", () => {
  it("replaces Bloodrager training without changing the class source or rule indices", () => {
    const document = classDocument("barbarian");
    const original = structuredClone(document);
    const projected = withClassArchetypeInitialTraining(document, profile("bloodrager"));

    expect(projected).toMatchObject({ system: { trainedSkills: { value: ["athletics", "medicine"], additional: 2 } } });
    expect(document).toEqual(original);
    expect((projected as typeof document).system.rules).toBe(document.system.rules);
    expect(withClassArchetypeInitialTraining(document, null)).toBe(document);
    expect(withClassArchetypeInitialTraining(document, profile("vindicator"))).toBe(document);
  });

  it("serializes a document while retaining its compendium identity for source-bound skill grants", () => {
    const source = classDocument("barbarian");
    const document = {
      name: source.name,
      system: source.system,
      uuid: source.uuid,
      toObject: () => ({ ...source, uuid: undefined }),
    };
    expect(withClassArchetypeInitialTraining(document, profile("bloodrager"))).toMatchObject({
      uuid: source.uuid,
      system: { trainedSkills: { value: ["athletics", "medicine"], additional: 2 } },
    });
  });

  it.each([
    { value: "bloodrager", classSlug: "barbarian", skills: ["athletics", "medicine"], additional: 2 },
    { value: "vindicator", classSlug: "ranger", skills: ["religion", "survival"], additional: 4 },
  ])("uses $value replacement training plus the projected Intelligence modifier", async ({
    value,
    classSlug,
    skills,
    additional,
  }) => {
    const document = classDocument(classSlug);
    const steps = await buildClassTrainingSteps({
      draftClassSelection: classSelection(classSlug),
      classArchetypeProfile: profile(value),
      targetLevel: 1,
      effectiveBuildState: buildState(2),
      fetchSelectionDocument: async () => document,
      extractSlug: extractDocumentSlug,
      localize: (value) => value,
    });
    expect(steps).toMatchObject([{ training: { fixedSkills: skills, additionalCount: additional + 2 } }]);
  });

  it("does not change Standard Barbarian's extra skill allowance", async () => {
    const steps = await buildClassTrainingSteps({
      draftClassSelection: classSelection("barbarian"),
      targetLevel: 1,
      effectiveBuildState: buildState(2),
      fetchSelectionDocument: async () => classDocument("barbarian"),
      extractSlug: extractDocumentSlug,
      localize: (value) => value,
    });
    expect(steps).toMatchObject([{ training: { fixedSkills: ["athletics"], additionalCount: 5 } }]);
  });

  it("suppresses the Vindicator-excluded Nature grant only in static projection", () => {
    const document = classDocument("ranger");
    const selected = profile("vindicator");
    expect(classArchetypeInitialTrainingProjection(document, selected)).toMatchObject({
      system: { trainedSkills: { value: ["religion", "survival"], additional: 4 }, rules: [] },
    });
    expect((withClassArchetypeInitialTraining(document, selected) as typeof document).system.rules).toHaveLength(1);
    expect(classArchetypeInitialTrainingProjection(document, null)).toBe(document);
  });

  it.each(["vindicator", "standard"])("projects the %s Ranger's actual fixed skills", async (value) => {
    const selected = profile("vindicator");
    const draft = createEmptyDraft(3);
    const selection = classSelection("ranger");
    draft.selections[selection.slotId] = selection;
    draft.classArchetypeChoices[selected.decisionSlotId] = value;
    const progression = await compileSkillPaneProgression(draft, {
      baseSkillRanks: {},
      steps: [createPickItemStep("class", 1, "Class", "", { itemType: "class" }), archetypeStep(selected)],
      resolveDocument: async (itemType) => (itemType === "class" ? classDocument("ranger") : null),
      resolveSelectionDocument: async () => ({ system: { rules: [] } }),
      localize: (value) => value,
    });
    expect(progression.finalRanks.survival).toBe(1);
    expect(progression.finalRanks.religion ?? 0).toBe(value === "vindicator" ? 1 : 0);
    expect(progression.finalRanks.nature ?? 0).toBe(value === "vindicator" ? 0 : 1);
  });

  it("recognizes a proven retained Vindicator even when the current plan has no profile choices", async () => {
    const selected = profile("vindicator");
    const progression = await compileSkillPaneProgression(createEmptyDraft(3), {
      actorDocuments: retainedItems(selected),
      baseSkillRanks: { religion: 1, survival: 1 },
      steps: [],
      resolveDocument: async (itemType) => (itemType === "class" ? classDocument("ranger") : null),
      localize: (value) => value,
    });
    expect(progression.finalRanks).toMatchObject({ religion: 1, survival: 1 });
    expect(progression.finalRanks.nature ?? 0).toBe(0);
  });

  it("keeps prepared Vindicator grants aligned with the pane and accepts PF2E's Nature-free skill state", async () => {
    const selected = profile("vindicator");
    const selection = classSelection("ranger");
    const draft = createEmptyDraft(1);
    draft.selections[selection.slotId] = selection;
    draft.classArchetypeChoices[selected.decisionSlotId] = selected.value;
    const training = createSkillTrainingStep(1, "Ranger training", "", {
      classSlug: "ranger",
      className: "Ranger",
      fixedSkills: ["religion", "survival"],
      fixedLores: [],
      choiceRules: [],
      loreChoices: [],
      additionalCount: 1,
    });
    draft.skillTrainings[training.slotId] = { additional: ["acrobatics"], ruleChoices: {}, loreChoices: {} };
    const steps = [
      createPickItemStep("class", 1, "Class", "", { itemType: "class" }),
      archetypeStep(selected),
      training,
    ];
    const baselineRanks = { religion: 0, survival: 0, nature: 0, acrobatics: 0 };
    const validSkillSlugs = new Set(Object.keys(baselineRanks));
    const source = classDocument("ranger");
    const projection = projectPreparedSkillSources({
      draft,
      steps,
      sources: [{ selection, source }],
      validSkillSlugs,
    });
    const prepared = compileSkillProgression({
      baselineRanks,
      draft,
      steps,
      sourceGrants: projection.sourceGrants,
      validSkillSlugs,
      mode: "editing",
    });
    const pane = await compileSkillPaneProgression(draft, {
      baseSkillRanks: baselineRanks,
      validSkillSlugs,
      steps,
      resolveDocument: async (type) => (type === "class" ? source : null),
      resolveSelectionDocument: async () => ({ system: { rules: [] } }),
      localize: (value) => value,
    });
    expect(prepared.inputFingerprint).toBe(pane.inputFingerprint);
    expect(projection.requiredBeforeSkillGrants.map((grant) => grant.slug)).toEqual(["religion", "survival"]);
    const actor = {
      items: [],
      system: {
        skills: { religion: { rank: 1 }, survival: { rank: 1 }, nature: { rank: 0 }, acrobatics: { rank: 0 } },
      },
    };
    const options = { preparedSkillProgression: prepared, ...projection, persistActorUpdate: false };
    await expect(applyTrainingDraft(actor, draft, steps, options)).resolves.toMatchObject({
      religion: 1,
      survival: 1,
      acrobatics: 1,
      nature: 0,
    });
    actor.system.skills.nature.rank = 1;
    await expect(applyTrainingDraft(actor, draft, steps, options)).rejects.toThrow("Skill progression changed");
  });

  it("also excludes Nature in prepared grants for a proven retained Vindicator", () => {
    const draft = createEmptyDraft(3);
    const selected = profile("vindicator");
    const projection = projectPreparedSkillSources({
      actorDocuments: retainedItems(selected),
      draft,
      steps: [],
      sources: [{ selection: classSelection("ranger"), source: classDocument("ranger") }],
      validSkillSlugs: new Set(["religion", "survival", "nature"]),
    });
    expect(projection.requiredBeforeSkillGrants.map((grant) => grant.slug)).toEqual(["religion", "survival"]);
  });

  it("does not infer Vindicator from an unproven feature tag or orphaned profile document", async () => {
    const selected = profile("vindicator");
    const progression = await compileSkillPaneProgression(createEmptyDraft(3), {
      actorDocuments: retainedItems(selected).filter((item) => item.id !== "selector-1"),
      baseSkillRanks: {},
      steps: [],
      resolveDocument: async (itemType) => (itemType === "class" ? classDocument("ranger") : null),
      localize: (value) => value,
    });
    expect(progression.finalRanks.nature).toBe(1);
    expect(progression.finalRanks.religion ?? 0).toBe(0);
  });
});

function profile(value: string): ClassArchetypeProfile {
  const result = classArchetypeProfile(value);
  if (!result) throw new Error(`Missing profile ${value}`);
  return result;
}

function classDocument(slug: string) {
  return {
    name: slug,
    type: "class",
    uuid: classSelection(slug).uuid,
    system: {
      slug,
      trainedSkills: {
        value: slug === "barbarian" ? ["athletics"] : ["survival"],
        additional: slug === "barbarian" ? 3 : 4,
      },
      rules:
        slug === "ranger"
          ? [
              {
                key: "ActiveEffectLike",
                mode: "upgrade",
                path: "system.skills.nature.rank",
                value: 1,
                predicate: [{ not: "feature:vindicator" }],
              },
            ]
          : [],
    },
  };
}

function classSelection(slug: string): SelectionRef {
  return {
    slotId: "class-level-1",
    name: slug,
    packId: "pf2e.classes",
    documentId: slug,
    uuid: `Compendium.pf2e.classes.Item.${slug}`,
    itemType: "class",
    featType: null,
    level: 1,
    slug,
  };
}

function archetypeStep(profile: ClassArchetypeProfile) {
  return createClassArchetypeStep(1, {
    slotId: profile.decisionSlotId,
    sourceName: profile.selector.selection.name,
    standardValue: "standard",
    options: [
      { value: "standard", label: "Standard", img: null, detail: null },
      { value: profile.value, label: profile.label, img: null, detail: null },
    ],
    selector: {
      slotId: profile.decisionSlotId.replace("class-archetype-", "class-branch-"),
      selectorPackId: profile.selector.selection.packId,
      selectorDocumentId: profile.selector.selection.documentId,
      selectorUuid: profile.selector.selection.uuid,
      selectorName: profile.selector.selection.name,
      selectorRuleIndex: profile.selector.ruleIndex,
      flag: profile.selector.flag,
      optionTag: profile.selectorTag,
      classSlug: profile.classSlug,
      dependsOn: "class",
    },
  });
}

function retainedItems(profile: ClassArchetypeProfile) {
  return [
    { ...classDocument(profile.classSlug), id: "class-1" },
    {
      id: "selector-1",
      type: "feat",
      flags: {
        core: { sourceId: profile.selector.selection.uuid },
        pf2e: { rulesSelections: { [profile.selector.flag]: profile.selection.uuid } },
      },
    },
    {
      id: "profile-1",
      type: "feat",
      flags: { core: { sourceId: profile.selection.uuid }, pf2e: { grantedBy: { id: "selector-1" } } },
    },
  ];
}

function buildState(intelligence: number): EffectiveBuildState {
  return {
    ancestry: {
      document: { name: "Human", system: { boosts: {} } },
      mode: "standard",
      selectedBoosts: {},
      alternateBoosts: [],
      lockedBoosts: [],
      voluntary: { enabled: false, legacy: false, boost: null, flaws: [] },
      buildBoosts: [],
      buildFlaws: [],
    },
    heritage: null,
    background: { document: { system: { boosts: {} } }, selectedBoosts: {}, buildBoosts: [] },
    class: { document: {}, keyAbilityOptions: ["str"], selectedKeyAbility: "str" },
    deity: null,
    languages: null,
    levelBoosts: { 1: ["str", "dex", "con", "int"], 5: [], 10: [], 15: [], 20: [] },
    allowedBoosts: { 1: 4, 5: 0, 10: 0, 15: 0, 20: 0 },
    projectedAbilities: {
      str: { key: "str", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      dex: { key: "dex", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      con: { key: "con", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      int: { key: "int", modifier: intelligence, partial: false, boostCount: 0, flawCount: 0 },
      wis: { key: "wis", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
      cha: { key: "cha", modifier: 0, partial: false, boostCount: 0, flawCount: 0 },
    },
  };
}
