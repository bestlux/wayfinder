import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";
import {
  buildContextNote,
  buildOptionContext,
  hasDedicationFeatInContext,
  resolveSelectionSlug,
  resolveSelectionTraits,
} from "../src/wayfinder/application/option-context-service";

describe("wayfinder option context service", () => {
  it("builds option context from resolved documents, draft choices, and actor items", async () => {
    const draft = createEmptyDraft(1);
    draft.classChoices["class-choice-champion-sanctification-level-1"] = "holy";

    const context = await buildOptionContext({
      draft,
      resolveDocument: async (itemType) => {
        switch (itemType) {
          case "ancestry":
            return { name: "Human", system: { slug: "human", traits: { value: ["humanoid"] } } };
          case "heritage":
            return { name: "Aiuvarin", system: { traits: { value: ["elf"] } } };
          case "class":
            return { name: "Champion", system: { slug: "champion" } };
          case "deity":
            return { name: "Iomedae", system: { sanctification: { modal: "must", what: ["holy"] } } };
          default:
            return null;
        }
      },
      listActorItems: () => [
        {
          type: "feat",
          system: {
            traits: {
              value: ["dedication"],
            },
          },
        },
      ],
      fetchSelectionDocument: async () => null,
      extractDocumentSlug: (document) => {
        const typedDocument = document as { system?: { slug?: unknown } } | null;
        return typeof typedDocument?.system?.slug === "string" ? typedDocument.system.slug.trim().toLowerCase() : null;
      },
    });

    expect(context).toEqual({
      ancestrySlug: "human",
      ancestryTraits: ["humanoid", "human"],
      heritageTraits: ["elf"],
      classSlug: "champion",
      deitySelected: true,
      sanctification: "holy",
      hasDedicationFeat: true,
    });
  });

  it("counts dedication feats from drafted feat selections when the actor does not already have one", async () => {
    const draft = createEmptyDraft(2);
    draft.selections["class-feat-level-2"] = selection("class-feat-level-2", "feat", "wizard-dedication");

    await expect(
      hasDedicationFeatInContext({
        draft,
        listActorItems: () => [],
        fetchSelectionDocument: async (selectionRef) =>
          selectionRef.documentId === "wizard-dedication"
            ? {
                type: "feat",
                system: {
                  traits: {
                    value: ["dedication"],
                  },
                },
              }
            : null,
        extractDocumentSlug: () => null,
      })
    ).resolves.toBe(true);
  });

  it("resolves selection traits and slugs from fetched documents", async () => {
    const selectedHeritage = selection("heritage-level-1", "heritage", "wintertouched");

    await expect(
      resolveSelectionTraits(selectedHeritage, {
        fetchSelectionDocument: async () => ({
          system: {
            slug: "wintertouched",
            traits: {
              value: ["cold", "Versatile"],
            },
          },
        }),
        extractDocumentSlug: (document) => {
          const typedDocument = document as { system?: { slug?: unknown } } | null;
          return typeof typedDocument?.system?.slug === "string"
            ? typedDocument.system.slug.trim().toLowerCase()
            : null;
        },
      })
    ).resolves.toEqual(["cold", "versatile", "wintertouched"]);

    await expect(
      resolveSelectionSlug(selectedHeritage, {
        fetchSelectionDocument: async () => ({
          system: {
            slug: "Wintertouched",
          },
        }),
        extractDocumentSlug: (document) => {
          const typedDocument = document as { system?: { slug?: unknown } } | null;
          return typeof typedDocument?.system?.slug === "string"
            ? typedDocument.system.slug.trim().toLowerCase()
            : null;
        },
      })
    ).resolves.toBe("wintertouched");
  });

  it("builds dependency-aware context notes outside the shell", async () => {
    const step: PendingStep = {
      id: "class-branch-cause-level-1",
      level: 1,
      kind: "class-branch",
      slotKind: "class-branch",
      title: "Cause",
      description: "",
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

    await expect(
      buildContextNote(
        step,
        {
          ancestrySlug: null,
          ancestryTraits: [],
          heritageTraits: [],
          classSlug: "champion",
          deitySelected: false,
          sanctification: null,
          hasDedicationFeat: false,
        },
        {
          resolveDocument: async () => ({ name: "Champion" }),
        }
      )
    ).resolves.toBe(
      "Resolve the deity step first so Wayfinder can narrow champion causes to the legal sanctification path."
    );
  });
});

function selection(slotId: string, itemType: string, documentId: string): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType: itemType === "feat" ? "class" : null,
    name: documentId,
    level: 2,
  };
}
