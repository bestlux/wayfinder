import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { SelectionRef } from "../src/types";
import { buildClassBranchSteps, buildClassTrainingSteps } from "../src/wayfinder/class-choice-service";

describe("class-choice-service", () => {
  afterEach(() => {
    delete (globalThis as any).CONFIG;
  });

  it("emits a generalized class training step from supported skill choices", async () => {
    const fighterSelection = selection("pf2e.classes", "fighter", "Fighter", "class");
    const documents = new Map<string, any>([
      [
        fighterSelection.uuid,
        {
          name: "Fighter",
          system: {
            slug: "fighter",
            trainedSkills: {
              additional: 3,
              value: ["athletics", "invalid-entry"],
            },
            rules: [
              {
                key: "ChoiceSet",
                flag: "fighterSkill",
                prompt: "Choose a class skill",
                choices: [
                  { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
                  { value: "athletics", label: "PF2E.Skill.Athletics" },
                ],
              },
              {
                key: "ChoiceSet",
                flag: "battleStyle",
                prompt: "Choose a battle style",
                choices: [
                  { value: "archer", label: "Archer" },
                  { value: "guardian", label: "Guardian" },
                ],
              },
            ],
          },
        },
      ],
    ]);

    const steps = await buildClassTrainingSteps({
      draftClassSelection: fighterSelection,
      targetLevel: 3,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: (document) => document?.system?.slug ?? null,
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "skill-training",
      slotId: "skill-training-fighter-level-1",
      training: {
        classSlug: "fighter",
        className: "Fighter",
        fixedSkills: ["athletics", "invalid-entry"],
        additionalCount: 3,
        choiceRules: [
          {
            flag: "fighterSkill",
            prompt: "Choose a class skill",
            options: [
              { slug: "acrobatics", label: "Acrobatics" },
              { slug: "athletics", label: "Athletics" },
            ],
          },
        ],
      },
    });
  });

  it("does not emit a class training step when the class only has unsupported non-skill choices", async () => {
    const classSelection = selection("pf2e.classes", "wizard", "Wizard", "class");
    const documents = new Map<string, any>([
      [
        classSelection.uuid,
        {
          name: "Wizard",
          system: {
            slug: "wizard",
            trainedSkills: {
              additional: 0,
              value: [],
            },
            rules: [
              {
                key: "ChoiceSet",
                flag: "arcaneSchool",
                choices: [
                  { value: "evocation", label: "Evocation" },
                  { value: "illusion", label: "Illusion" },
                ],
              },
            ],
          },
        },
      ],
    ]);

    const steps = await buildClassTrainingSteps({
      draftClassSelection: classSelection,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: (document) => document?.system?.slug ?? null,
      localize: (value) => value,
    });

    expect(steps).toEqual([]);
  });

  it("keeps extended skill slugs when a class skill rule includes configured world skills", async () => {
    globalThis.CONFIG = {
      PF2E: {
        skills: {
          acrobatics: { label: "PF2E.Skill.Acrobatics" },
          sailing: { label: "World.Skill.Sailing" },
        },
      },
    } as any;

    const classSelection = selection("pf2e.classes", "swashbuckler", "Swashbuckler", "class");
    const documents = new Map<string, any>([
      [
        classSelection.uuid,
        {
          name: "Swashbuckler",
          system: {
            slug: "swashbuckler",
            trainedSkills: {
              additional: 0,
              value: ["sailing"],
            },
            rules: [
              {
                key: "ChoiceSet",
                flag: "classSkill",
                prompt: "Choose a class skill",
                choices: [
                  { value: "acrobatics", label: "PF2E.Skill.Acrobatics" },
                  { value: "sailing", label: "World.Skill.Sailing" },
                ],
              },
            ],
          },
        },
      ],
    ]);

    const steps = await buildClassTrainingSteps({
      draftClassSelection: classSelection,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: (document) => document?.system?.slug ?? null,
      localize: (value) => value.replace(/^PF2E\.Skill\./, "").replace(/^World\.Skill\./, ""),
    });

    expect(steps[0]?.training?.fixedSkills).toEqual(["sailing"]);
    expect(steps[0]?.training?.choiceRules[0]?.options).toEqual([
      { slug: "acrobatics", label: "Acrobatics" },
      { slug: "sailing", label: "Sailing" },
    ]);
  });

  it("emits branch steps from selector features and skips ones already chosen on the actor", async () => {
    const draft = createEmptyDraft(1);
    const rogueClass = {
      system: {
        slug: "rogue",
        items: {
          one: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.racket-selector",
            name: "Rogue's Racket",
          },
          two: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.missing-selector",
            name: "Ignore Me",
          },
        },
      },
    };
    const documents = new Map<string, any>([
      [
        "Compendium.pf2e.classfeatures.Item.racket-selector",
        {
          type: "feat",
          name: "Rogue's Racket",
          system: {
            category: "classfeature",
            level: { value: 1 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "roguesRacket",
                choices: {
                  filter: ["item:tag:rogue-racket"],
                },
              },
              {
                key: "GrantItem",
                uuid: "{item|flags.pf2e.rulesSelections.roguesRacket}",
              },
            ],
          },
        },
      ],
      [
        "Compendium.pf2e.classfeatures.Item.missing-selector",
        {
          type: "feat",
          name: "Ignore Me",
          system: {
            slug: "ignore-me",
            category: "classfeature",
            level: { value: 1 },
            rules: [
              {
                key: "ChoiceSet",
                flag: "ignoredChoice",
                choices: {
                  filter: ["item:tag:ignored-choice"],
                },
              },
            ],
          },
        },
      ],
    ]);

    const steps = await buildClassBranchSteps({
      draft,
      effectiveClassDocument: rogueClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      readExistingBranchSelection: () => null,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "class-branch",
      slotId: "class-branch-rogue-s-racket-level-1",
      branch: {
        selectorName: "Rogue's Racket",
        flag: "roguesRacket",
        optionTag: "rogue-racket",
        classSlug: "rogue",
      },
    });

    const skipped = await buildClassBranchSteps({
      draft,
      effectiveClassDocument: rogueClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      readExistingBranchSelection: () => "Compendium.pf2e.classfeatures.Item.scoundrel",
    });

    expect(skipped).toEqual([]);
  });

  it("emits wizard arcane-school and arcane-thesis branch steps from the real selector shape", async () => {
    const draft = createEmptyDraft(1);
    const wizardClass = {
      system: {
        slug: "wizard",
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
          bond: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.arcane-bond",
            name: "Arcane Bond",
          },
        },
      },
    };
    const documents = new Map<string, any>([
      [
        "Compendium.pf2e.classfeatures.Item.arcane-school-selector",
        {
          type: "feat",
          name: "Arcane School",
          system: {
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
      ],
      [
        "Compendium.pf2e.classfeatures.Item.arcane-thesis-selector",
        {
          type: "feat",
          name: "Arcane Thesis",
          system: {
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
      ],
      [
        "Compendium.pf2e.classfeatures.Item.arcane-bond",
        {
          type: "feat",
          name: "Arcane Bond",
          system: {
            category: "classfeature",
            level: { value: 1 },
            rules: [
              {
                key: "GrantItem",
                uuid: "Compendium.pf2e.actionspf2e.Item.Drain Bonded Item",
              },
            ],
          },
        },
      ],
    ]);

    const steps = await buildClassBranchSteps({
      draft,
      effectiveClassDocument: wizardClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      readExistingBranchSelection: () => null,
    });

    expect(steps).toHaveLength(2);
    expect(steps).toMatchObject([
      {
        kind: "class-branch",
        slotId: "class-branch-arcane-school-level-1",
        branch: {
          selectorName: "Arcane School",
          flag: "arcaneSchool",
          optionTag: "wizard-arcane-school",
          classSlug: "wizard",
        },
      },
      {
        kind: "class-branch",
        slotId: "class-branch-arcane-thesis-level-1",
        branch: {
          selectorName: "Arcane Thesis",
          flag: "arcaneThesis",
          optionTag: "wizard-arcane-thesis",
          classSlug: "wizard",
        },
      },
    ]);
  });
});

function selection(packId: string, documentId: string, name: string, itemType: string): SelectionRef {
  return {
    slotId: `${itemType}-level-1`,
    packId,
    documentId,
    uuid: `Compendium.${packId}.Item.${documentId}`,
    itemType,
    featType: itemType === "feat" ? "classfeature" : null,
    name,
    level: 1,
  };
}

function slugFromDocument(document: any): string | null {
  const systemSlug = document?.system?.slug;
  if (typeof systemSlug === "string" && systemSlug.trim()) {
    return systemSlug.trim();
  }

  const ancestrySlug = document?.system?.ancestry?.slug;
  if (typeof ancestrySlug === "string" && ancestrySlug.trim()) {
    return ancestrySlug.trim();
  }

  const name = typeof document?.name === "string" ? document.name.trim() : "";
  if (!name) {
    return null;
  }

  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || null
  );
}
