import { describe, expect, it, vi } from "vitest";
import { applyClassFeatureChoiceDraft, stripPreselectedClassFeatureEntries } from "../src/class-feature-choice-service";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";

describe("class-feature-choice-service", () => {
  it("strips class features that Wayfinder owns through granted-item or class-choice draft selections", () => {
    const draft = createEmptyDraft(1);
    draft.selections["deity-level-1"] = selection("pf2e.deities", "gorum", "Gorum", "deity");
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "harm";

    const classSource = {
      system: {
        items: {
          deity: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
            name: "Deity",
          },
          divineFont: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.divine-font",
            name: "Divine Font",
          },
          doctrine: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.doctrine",
            name: "Doctrine",
          },
        },
      },
    };

    stripPreselectedClassFeatureEntries(classSource, draft, [deityStep(), divineFontStep()]);

    expect(Object.keys(classSource.system.items)).toEqual(["doctrine"]);
  });

  it("creates and updates class-owned feature items for cleric deity, sanctification, and divine font", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["deity-level-1"] = selection("pf2e.deities", "gorum", "Gorum", "deity");
    draft.classChoices["class-choice-deity-sanctification-level-1"] = "holy";
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "harm";

    let idCounter = 0;
    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Cleric",
            system: {},
          },
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) => {
        const created = sources.map((source) => {
          const item = {
            id: `created-${++idCounter}`,
            type: source.type,
            name: source.name,
            sourceId: source.flags?.core?.sourceId ?? null,
            flags: source.flags ?? {},
            system: source.system ?? {},
            _stats: source._stats ?? {},
          };
          actor.items.contents.push(item);
          return item;
        });
        return created;
      }),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    const sources = new Map<string, any>([
      [
        "Compendium.pf2e.classfeatures.Item.deity-cleric",
        featureSource("Deity", "Compendium.pf2e.classfeatures.Item.deity-cleric", {
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
              flag: "sanctification",
              choices: [
                { value: "holy", label: "Holy" },
                { value: "unholy", label: "Unholy" },
              ],
            },
          ],
        }),
      ],
      [
        "Compendium.pf2e.classfeatures.Item.divine-font",
        featureSource("Divine Font", "Compendium.pf2e.classfeatures.Item.divine-font", {
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "divineFont",
              choices: [
                { value: "heal", label: "Heal" },
                { value: "harm", label: "Harm" },
              ],
            },
          ],
        }),
      ],
      ["Compendium.pf2e.deities.Item.gorum", featureSource("Gorum", "Compendium.pf2e.deities.Item.gorum", {})],
    ]);

    await applyClassFeatureChoiceDraft(actor as any, draft, [deityStep(), sanctificationStep(), divineFontStep()], {
      createEmbeddedSource: async (selection) => {
        const source = sources.get(selection.uuid);
        return source ? structuredClone(source) : null;
      },
      fetchSelectionDocument: async (selection) => {
        const source = sources.get(selection.uuid);
        if (!source) {
          return null;
        }

        return {
          system: structuredClone(source.system),
        };
      },
    });

    const createdSources = actor.createEmbeddedDocuments.mock.calls.flatMap((call) => call[1] as any[]);
    const deityFeature = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.deity-cleric"
    );
    const deityGrant = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.deities.Item.gorum"
    );
    const divineFontFeature = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.divine-font"
    );

    expect(deityFeature).toBeTruthy();
    expect(deityFeature.system.location).toBe("class-1");
    expect(deityFeature.system.rules).toHaveLength(2);
    expect(deityFeature.system.rules.some((rule: any) => rule.key === "GrantItem")).toBe(false);
    expect(deityFeature.flags.pf2e.rulesSelections).toEqual({
      deity: "Compendium.pf2e.deities.Item.gorum",
      sanctification: "holy",
    });

    expect(deityGrant).toBeTruthy();
    expect(deityGrant.flags.pf2e.grantedBy).toEqual({
      id: "created-1",
      onDelete: "cascade",
    });

    expect(divineFontFeature).toBeTruthy();
    expect(divineFontFeature.system.location).toBe("class-1");
    expect(divineFontFeature.flags.pf2e.rulesSelections).toEqual({
      divineFont: "harm",
    });

    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      {
        _id: "created-1",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "deity",
            choices: {
              itemType: "deity",
            },
            selection: "Compendium.pf2e.deities.Item.gorum",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.deity}",
          },
          {
            key: "ChoiceSet",
            flag: "sanctification",
            choices: [
              { value: "holy", label: "Holy" },
              { value: "unholy", label: "Unholy" },
            ],
            selection: "holy",
          },
        ],
        "flags.pf2e.rulesSelections.sanctification": "holy",
        "flags.pf2e.rulesSelections.deity": "Compendium.pf2e.deities.Item.gorum",
        "flags.pf2e.itemGrants.deity": {
          id: "created-2",
          onDelete: "detach",
          nested: null,
        },
        "flags.pf2e-wayfinder.slotId": "deity-level-1",
      },
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      {
        _id: "created-3",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "divineFont",
            choices: [
              { value: "heal", label: "Heal" },
              { value: "harm", label: "Harm" },
            ],
            selection: "harm",
          },
        ],
        "flags.pf2e.rulesSelections.divineFont": "harm",
        "flags.pf2e-wayfinder.slotId": "class-choice-divine-font-divineFont-level-1",
      },
    ]);
  });

  it("preserves fixed grant rules when creating deity-owned class features", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["deity-level-1"] = selection("pf2e.deities", "iomedae", "Iomedae", "deity");

    let idCounter = 0;
    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Champion",
            system: {},
          },
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) =>
        sources.map((source) => {
          const item = {
            id: `created-${++idCounter}`,
            type: source.type,
            name: source.name,
            sourceId: source.flags?.core?.sourceId ?? null,
            flags: source.flags ?? {},
            system: source.system ?? {},
            _stats: source._stats ?? {},
          };
          actor.items.contents.push(item);
          return item;
        })
      ),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    const sources = new Map<string, any>([
      [
        "Compendium.pf2e.classfeatures.Item.deity-champion",
        featureSource("Deity", "Compendium.pf2e.classfeatures.Item.deity-champion", {
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
              key: "GrantItem",
              uuid: "Compendium.pf2e.classfeatures.Item.deific-weapon",
            },
            {
              key: "GrantItem",
              uuid: "Compendium.pf2e.classfeatures.Item.champions-aura",
            },
          ],
        }),
      ],
      ["Compendium.pf2e.deities.Item.iomedae", featureSource("Iomedae", "Compendium.pf2e.deities.Item.iomedae", {})],
    ]);

    await applyClassFeatureChoiceDraft(actor as any, draft, [championDeityStep()], {
      createEmbeddedSource: async (selection) => {
        const source = sources.get(selection.uuid);
        return source ? structuredClone(source) : null;
      },
      fetchSelectionDocument: async (selection) => {
        const source = sources.get(selection.uuid);
        return source ? { system: structuredClone(source.system) } : null;
      },
    });

    const createdSources = actor.createEmbeddedDocuments.mock.calls.flatMap((call) => call[1] as any[]);
    const deityFeature = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.deity-champion"
    );

    expect(deityFeature).toBeTruthy();
    expect(deityFeature.system.rules).toEqual([
      {
        key: "ChoiceSet",
        flag: "deity",
        choices: {
          itemType: "deity",
        },
        selection: "Compendium.pf2e.deities.Item.iomedae",
      },
      {
        key: "GrantItem",
        uuid: "Compendium.pf2e.classfeatures.Item.deific-weapon",
      },
      {
        key: "GrantItem",
        uuid: "Compendium.pf2e.classfeatures.Item.champions-aura",
      },
    ]);
  });

  it("reconciles an existing granted deity before updating the selector feature", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["deity-level-1"] = selection("pf2e.deities", "iomedae", "Iomedae", "deity");

    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Champion",
            system: {},
          },
          {
            id: "selector-1",
            type: "feat",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.classfeatures.Item.deity-champion",
              },
              pf2e: {
                rulesSelections: {
                  deity: "Compendium.pf2e.deities.Item.iomedae",
                },
                itemGrants: {
                  deity: {
                    id: "deity-1",
                  },
                },
              },
            },
            system: {
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
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.classfeatures.Item.deific-weapon",
                },
              ],
            },
          },
          {
            id: "deity-1",
            type: "deity",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.deities.Item.iomedae",
              },
              pf2e: {
                grantedBy: {
                  id: "selector-1",
                  onDelete: "cascade",
                },
              },
            },
            system: {},
          },
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await applyClassFeatureChoiceDraft(actor as any, draft, [championDeityStep()], {
      createEmbeddedSource: async () => null,
      fetchSelectionDocument: async () => null,
    });

    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      {
        _id: "deity-1",
        "flags.core.sourceId": "Compendium.pf2e.deities.Item.iomedae",
        "flags.pf2e.grantedBy": {
          id: "selector-1",
          onDelete: "cascade",
        },
        "flags.pf2e-wayfinder.importedBy": "pf2e-wayfinder",
        "flags.pf2e-wayfinder.slotId": "deity-level-1",
      },
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      {
        _id: "selector-1",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "deity",
            choices: {
              itemType: "deity",
            },
            selection: "Compendium.pf2e.deities.Item.iomedae",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.deity}",
          },
          {
            key: "GrantItem",
            uuid: "Compendium.pf2e.classfeatures.Item.deific-weapon",
          },
        ],
        "flags.pf2e.rulesSelections.deity": "Compendium.pf2e.deities.Item.iomedae",
        "flags.pf2e.itemGrants.deity": {
          id: "deity-1",
          onDelete: "detach",
          nested: null,
        },
        "flags.pf2e-wayfinder.slotId": "deity-level-1",
      },
    ]);
  });
});

function deityStep(): PendingStep {
  return {
    id: "deity-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "deity",
    title: "Choose a deity",
    description: "",
    required: true,
    slotId: "deity-level-1",
    filters: { itemType: "deity" },
    grantSelection: {
      slotId: "deity-level-1",
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: "deity-cleric",
      selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
      selectorName: "Deity",
      selectorRuleIndex: 0,
      grantRuleIndex: 1,
      flag: "deity",
      itemType: "deity",
      classSlug: "cleric",
    },
  };
}

function championDeityStep(): PendingStep {
  return {
    id: "deity-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "deity",
    title: "Choose a deity",
    description: "",
    required: true,
    slotId: "deity-level-1",
    filters: { itemType: "deity" },
    grantSelection: {
      slotId: "deity-level-1",
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: "deity-champion",
      selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-champion",
      selectorName: "Deity",
      selectorRuleIndex: 0,
      grantRuleIndex: 1,
      flag: "deity",
      itemType: "deity",
      classSlug: "champion",
    },
  };
}

function sanctificationStep(): PendingStep {
  return {
    id: "class-choice-deity-sanctification-level-1",
    level: 1,
    kind: "class-choice",
    slotKind: "class-choice",
    title: "Sanctification",
    description: "",
    required: true,
    slotId: "class-choice-deity-sanctification-level-1",
    classChoice: {
      slotId: "class-choice-deity-sanctification-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "deity-cleric",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
      sourceName: "Deity",
      sourceRuleIndex: 2,
      flag: "sanctification",
      classSlug: "cleric",
      dependsOn: "deity",
      options: [
        { value: "holy", label: "Holy", img: null, detail: null },
        { value: "unholy", label: "Unholy", img: null, detail: null },
      ],
    },
  };
}

function divineFontStep(): PendingStep {
  return {
    id: "class-choice-divine-font-divineFont-level-1",
    level: 1,
    kind: "class-choice",
    slotKind: "class-choice",
    title: "Divine Font",
    description: "",
    required: true,
    slotId: "class-choice-divine-font-divineFont-level-1",
    classChoice: {
      slotId: "class-choice-divine-font-divineFont-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "divine-font",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.divine-font",
      sourceName: "Divine Font",
      sourceRuleIndex: 0,
      flag: "divineFont",
      classSlug: "cleric",
      dependsOn: "deity",
      options: [
        { value: "heal", label: "Heal", img: null, detail: null },
        { value: "harm", label: "Harm", img: null, detail: null },
      ],
    },
  };
}

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

function featureSource(name: string, sourceId: string, system: Record<string, unknown>): any {
  return {
    name,
    type: "feat",
    _stats: {
      compendiumSource: sourceId,
    },
    system,
    flags: {
      core: {
        sourceId,
      },
      pf2e: {
        rulesSelections: {},
      },
      "pf2e-wayfinder": {
        importedBy: "pf2e-wayfinder",
      },
    },
  };
}
