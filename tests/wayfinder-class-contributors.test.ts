import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { baseContributor } from "../src/wayfinder/classes/base-contributor";
import { clericContributor } from "../src/wayfinder/classes/cleric-contributor";
import type { BuildClassContributionArgs } from "../src/wayfinder/classes/types";
import { wizardContributor } from "../src/wayfinder/classes/wizard-contributor";

describe("wayfinder class contributors", () => {
  it("keeps the base contributor as the no-op fallback", async () => {
    expect(baseContributor.slug).toBe("base");
    await expect(baseContributor.buildPlanSteps(baseArgs())).resolves.toEqual([]);
  });

  it("routes wizard spell-choice behavior through the contributor seam", async () => {
    const steps = await wizardContributor.buildPlanSteps({
      ...baseArgs(),
      effectiveClassDocument: wizardClassDocument(),
      effectiveSchoolDocument: battleMagicSchoolDocument(),
    });

    expect(wizardContributor.slug).toBe("wizard");
    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-wizard-spellbook-cantrips-level-1",
      "spell-choice-wizard-spellbook-rank-1-level-1",
      "spell-choice-wizard-curriculum-rank-1-level-1",
    ]);
  });

  it("routes cleric spell-choice behavior through the contributor seam", async () => {
    const steps = await clericContributor.buildPlanSteps({
      ...baseArgs(),
      effectiveClassDocument: clericClassDocument(),
      effectiveDeityDocument: deityDocument(),
    });

    expect(clericContributor.slug).toBe("cleric");
    expect(steps.map((step) => step.slotId)).toEqual([
      "spell-choice-cleric-cantrips-level-1",
      "spell-choice-cleric-rank-1-level-1",
    ]);
    expect(steps[1]?.spellChoice?.additionalAllowedSpellNames).toEqual(["Burning Hands"]);
  });
});

function baseArgs(): BuildClassContributionArgs {
  return {
    draft: createEmptyDraft(1),
    currentLevel: 1,
    targetLevel: 1,
    effectiveClassDocument: wizardClassDocument(),
    effectiveDeityDocument: null,
    effectiveSchoolDocument: null,
    deps: {
      extractSlug,
      readExistingSpellChoiceSelections: () => [],
    },
  };
}

function extractSlug(document: { system?: { slug?: unknown } } | null): string | null {
  return typeof document?.system?.slug === "string" ? document.system.slug : null;
}

function wizardClassDocument() {
  return {
    system: {
      slug: "wizard",
      items: {
        spellcasting: {
          name: "Wizard Spellcasting",
          uuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
        },
      },
    },
  };
}

function clericClassDocument() {
  return {
    system: {
      slug: "cleric",
      items: {
        spellcasting: {
          name: "Cleric Spellcasting",
          uuid: "Compendium.pf2e.classfeatures.Item.cleric-spellcasting",
        },
      },
    },
  };
}

function battleMagicSchoolDocument() {
  return {
    name: "School of Battle Magic",
    flags: {
      core: {
        sourceId: "Compendium.pf2e.classfeatures.Item.school-of-battle-magic",
      },
    },
    system: {
      slug: "school-of-battle-magic",
      description: {
        value:
          "<ul><li><strong>1st:</strong> @UUID[Compendium.pf2e.spells-srd.Item.Breathe Fire], @UUID[Compendium.pf2e.spells-srd.Item.Force Barrage]</li></ul>",
      },
    },
  };
}

function deityDocument() {
  return {
    name: "Sarenrae",
    system: {
      spells: {
        1: "Compendium.pf2e.spells-srd.Item.burning-hands",
      },
    },
  };
}
