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
        sourcePublication: {
          title: "Pathfinder Lost Omens Character Guide",
          license: "OGL",
          remaster: false,
        },
        destination: {
          type: "innate",
          key: "feat-arcane-tattoos-innate-arcane",
          tradition: "arcane",
          prepared: "innate",
        },
      },
    });
  });

  it("builds Necromancer Dedication's four-cantrip occult dirge at the level the feat was taken", () => {
    const draft = createEmptyDraft(1);
    const steps = buildFeatSpellChoiceSteps({
      draft,
      effectiveClassDocument: null,
      featSources: [
        {
          sourceSelection: {
            slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
            packId: "pf2e.feats-srd",
            documentId: "Tt6WVxyR4YjmvZLO",
            uuid: "Compendium.pf2e.feats-srd.Item.Tt6WVxyR4YjmvZLO",
            itemType: "feat",
            featType: "class",
            name: "Necromancer Dedication",
            level: 1,
          },
          sourceDocument: necromancerDedicationDocument(),
        },
      ],
      extractSlug: (document) => (document as { system?: { slug?: string } } | null)?.system?.slug ?? null,
      readExistingSpellChoiceSelections: () => [],
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "spell-choice",
      level: 1,
      slotId: "spell-choice-feat-necromancer-dedication-cantrip-level-1",
      title: "Necromancer dirge cantrips",
      description: expect.stringContaining("prepare two"),
      spellChoice: {
        sourceUuid: "Compendium.pf2e.feats-srd.Item.Tt6WVxyR4YjmvZLO",
        classSlug: null,
        dependsOn: null,
        count: 4,
        minRank: 0,
        maxRank: 0,
        cantrip: true,
        restrictToCommon: true,
        destination: {
          type: "spellbook",
          key: "necromancer-occult-dirge",
          entryReuse: "key-only",
          label: "Necromancer dirge",
          entryName: "Necromancer Dirge",
          tradition: "occult",
          ability: "int",
          prepared: "prepared",
          preparedCantripSlots: 2,
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
      publication: {
        title: "Pathfinder Player Core",
        authors: "",
        license: "ORC",
        remaster: true,
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
      publication: {
        title: "Pathfinder Lost Omens Character Guide",
        authors: "",
        license: "OGL",
        remaster: false,
      },
    },
  };
}

function necromancerDedicationDocument(): unknown {
  return {
    name: "Necromancer Dedication",
    system: {
      slug: "necromancer-dedication",
      description: {
        value:
          "<p>You can cast spells like a necromancer, gaining a dirge with four common occult cantrips of your choice. You can prepare two cantrips each day from your dirge.</p>",
      },
      rules: [],
      publication: {
        title: "Pathfinder Impossible Magic",
        authors: "",
        license: "ORC",
        remaster: true,
      },
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
