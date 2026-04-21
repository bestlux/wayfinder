import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { SelectionRef } from "../src/types";
import {
  buildClassBranchSteps,
  buildClassChoiceSteps,
  buildClassFeatSteps,
  buildClassGrantedItemSteps,
} from "../src/wayfinder/class-choice-service";

describe("class-choice-service", () => {
  it("derives class feat milestones from the effective class document", async () => {
    const steps = await buildClassFeatSteps({
      effectiveClassDocument: {
        system: {
          classFeatLevels: {
            value: [1, 2, 4, 6],
          },
        },
      },
      targetLevel: 2,
      fulfilledCount: 0,
    });

    expect(steps.map((step) => step.slotId)).toEqual(["class-feat-level-1", "class-feat-level-2"]);
  });

  it("skips branch steps already resolved on the actor unless the draft overrides them", async () => {
    const draft = createEmptyDraft(1);
    const rogueClass = {
      system: {
        slug: "rogue",
        items: {
          selector: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.racket-selector",
            name: "Rogue's Racket",
          },
        },
      },
    };
    const documents = new Map<string, unknown>([
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
                uuid: "{item|flags.system.rulesSelections.roguesRacket}",
              },
            ],
          },
        },
      ],
    ]);

    const skipped = await buildClassBranchSteps({
      draft,
      effectiveClassDocument: rogueClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      readExistingBranchSelection: () => "Compendium.pf2e.classfeatures.Item.scoundrel",
    });

    expect(skipped).toEqual([]);

    draft.branchSelections["class-branch-rogue-s-racket-level-1"] = selection(
      "pf2e.classfeatures",
      "scoundrel",
      "Scoundrel",
      "feat"
    );

    const retained = await buildClassBranchSteps({
      draft,
      effectiveClassDocument: rogueClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      readExistingBranchSelection: () => "Compendium.pf2e.classfeatures.Item.scoundrel",
    });

    expect(retained).toHaveLength(1);
  });

  it("skips deity grant steps already resolved on the actor unless the draft overrides them", async () => {
    const draft = createEmptyDraft(1);
    const clericClass = {
      system: {
        slug: "cleric",
        items: {
          deity: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
            name: "Deity",
          },
        },
      },
    };
    const documents = new Map<string, unknown>([
      [
        "Compendium.pf2e.classfeatures.Item.deity-cleric",
        {
          type: "feat",
          name: "Deity",
          system: {
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
            ],
          },
        },
      ],
    ]);

    const skipped = await buildClassGrantedItemSteps({
      draft,
      effectiveClassDocument: clericClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      readExistingGrantedSelection: () => "Compendium.pf2e.deities.Item.gorum",
    });

    expect(skipped).toEqual([]);

    draft.selections["deity-level-1"] = selection("pf2e.deities", "gorum", "Gorum", "deity");

    const retained = await buildClassGrantedItemSteps({
      draft,
      effectiveClassDocument: clericClass,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      readExistingGrantedSelection: () => "Compendium.pf2e.deities.Item.gorum",
    });

    expect(retained).toHaveLength(1);
  });

  it("skips class choice steps already resolved on the actor unless the draft overrides them", async () => {
    const draft = createEmptyDraft(1);
    const clericClass = {
      system: {
        slug: "cleric",
        items: {
          font: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.divine-font",
            name: "Divine Font",
          },
        },
      },
    };
    const documents = new Map<string, unknown>([
      [
        "Compendium.pf2e.classfeatures.Item.divine-font",
        {
          type: "feat",
          name: "Divine Font",
          system: {
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
      ],
    ]);
    const deityDocument = {
      system: {
        font: ["heal", "harm"],
      },
    };

    const skipped = await buildClassChoiceSteps({
      draft,
      effectiveClassDocument: clericClass,
      effectiveDeityDocument: deityDocument,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      localize: (value) => value,
      readExistingClassChoiceSelection: () => "heal",
    });

    expect(skipped).toEqual([]);

    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "harm";

    const retained = await buildClassChoiceSteps({
      draft,
      effectiveClassDocument: clericClass,
      effectiveDeityDocument: deityDocument,
      targetLevel: 1,
      fetchSelectionDocument: async (entry) => documents.get(entry.uuid) ?? null,
      extractSlug: slugFromDocument,
      localize: (value) => value,
      readExistingClassChoiceSelection: () => "heal",
    });

    expect(retained).toHaveLength(1);
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

function slugFromDocument(document: unknown): string | null {
  const systemSlug = (document as { system?: { slug?: unknown } } | null | undefined)?.system?.slug;
  if (typeof systemSlug === "string" && systemSlug.trim()) {
    return systemSlug.trim();
  }

  const ancestrySlug = (document as { system?: { ancestry?: { slug?: unknown } } } | null | undefined)?.system?.ancestry
    ?.slug;
  if (typeof ancestrySlug === "string" && ancestrySlug.trim()) {
    return ancestrySlug.trim();
  }

  const name = (document as { name?: unknown } | null | undefined)?.name;
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || null
  );
}
