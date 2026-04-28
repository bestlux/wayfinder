import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { SelectionRef } from "../src/types";
import { buildFeatSpellChoiceSteps } from "../src/wayfinder/spell-choice/feat-step-builder";

describe("wayfinder feat spell-choice step builder", () => {
  it("builds an adapted cantrip choice that excludes the class tradition", () => {
    const steps = buildFeatSpellChoiceSteps({
      draft: createEmptyDraft(1),
      effectiveClassDocument: {
        name: "Wizard",
        system: {
          slug: "wizard",
        },
      },
      featSources: [
        {
          sourceSelection: selection("ancestry-feat-level-1", "adapted-cantrip", "Adapted Cantrip", "ancestry"),
          sourceDocument: adaptedCantripDocument(),
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "spell-choice",
      slotId: "spell-choice-feat-adapted-cantrip-cantrip-level-1",
      spellChoice: {
        count: 1,
        cantrip: true,
        excludedTraditions: ["arcane"],
        destination: {
          type: "spellbook",
          key: "wizard-arcane-prepared",
          tradition: "arcane",
        },
      },
    });
  });

  it("suppresses adapted cantrip when actor state already has the selected cantrip", () => {
    const draft = createEmptyDraft(1);
    const steps = buildFeatSpellChoiceSteps({
      draft,
      effectiveClassDocument: {
        name: "Wizard",
        system: {
          slug: "wizard",
        },
      },
      featSources: [
        {
          sourceSelection: selection("ancestry-feat-level-1", "adapted-cantrip", "Adapted Cantrip", "ancestry"),
          sourceDocument: adaptedCantripDocument(),
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
      readExistingSpellChoiceSelections: (choice) => [
        selection(choice.slotId, "electric-arc", "Electric Arc", null, "spell"),
      ],
    });

    expect(steps).toEqual([]);
  });

  it("builds an innate arcane cantrip choice from feat spell ChoiceSet rules", () => {
    const steps = buildFeatSpellChoiceSteps({
      draft: createEmptyDraft(1),
      effectiveClassDocument: null,
      featSources: [
        {
          sourceSelection: selection("ancestry-feat-level-1", "arcane-tattoos", "Arcane Tattoos", "ancestry"),
          sourceDocument: arcaneTattoosDocument(),
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "spell-choice",
      slotId: "spell-choice-feat-arcane-tattoos-cantrip-level-1",
      spellChoice: {
        count: 1,
        cantrip: true,
        classSlug: null,
        dependsOn: null,
        allowedSpellSlugs: ["shield", "tanglevine", "daze"],
        destination: {
          type: "innate",
          key: "feat-arcane-tattoos-innate-arcane",
          tradition: "arcane",
          prepared: "innate",
        },
      },
    });
  });
});

function adaptedCantripDocument(): unknown {
  return {
    name: "Adapted Cantrip",
    system: {
      slug: "adapted-cantrip",
      description: {
        value:
          "<p>Choose one cantrip from a magical tradition other than your own. You can cast this cantrip as a spell of your class's tradition.</p>",
      },
    },
  };
}

function arcaneTattoosDocument(): unknown {
  return {
    name: "Arcane Tattoos",
    system: {
      slug: "arcane-tattoos",
      description: {
        value: "<p>You can cast the associated cantrip as an innate arcane spell at will.</p>",
      },
      rules: [
        {
          key: "ChoiceSet",
          choices: {
            itemType: "spell",
            slugsAsValues: true,
            filter: [{ or: ["item:slug:shield", "item:slug:tanglevine", "item:slug:daze"] }],
          },
        },
      ],
    },
  };
}

function selection(
  slotId: string,
  documentId: string,
  name = documentId,
  featType: string | null = null,
  itemType = "feat"
): SelectionRef {
  return {
    slotId,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    itemType,
    featType,
    name,
    level: 1,
  };
}
