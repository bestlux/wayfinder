import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { baseContributor } from "../src/wayfinder/classes/base-contributor";
import { clericContributor } from "../src/wayfinder/classes/cleric-contributor";
import type { BuildClassSpellChoiceStepsArgs } from "../src/wayfinder/classes/types";
import { wizardContributor } from "../src/wayfinder/classes/wizard-contributor";

const { buildWizardSpellChoiceSteps, buildClericSpellChoiceSteps } = vi.hoisted(() => ({
  buildWizardSpellChoiceSteps: vi.fn(),
  buildClericSpellChoiceSteps: vi.fn(),
}));

vi.mock("../src/wayfinder/spell-choice/wizard-step-builder", () => ({
  buildWizardSpellChoiceSteps,
}));

vi.mock("../src/wayfinder/spell-choice/cleric-step-builder", () => ({
  buildClericSpellChoiceSteps,
}));

describe("wayfinder class contributors", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the base contributor as the no-op fallback", () => {
    expect(baseContributor.slug).toBe("base");
    expect(baseContributor.buildSpellChoiceSteps).toBeUndefined();
  });

  it("delegates wizard spell-choice steps to the wizard spell-choice builder", async () => {
    const delegatedSteps = [step("wizard-step")];
    buildWizardSpellChoiceSteps.mockReturnValue(delegatedSteps);
    const args: BuildClassSpellChoiceStepsArgs = {
      ...spellChoiceArgs(),
      effectiveClassDocument: wizardClassDocument(),
      effectiveSchoolDocument: battleMagicSchoolDocument(),
    };

    expect(wizardContributor.slug).toBe("wizard");
    await expect(wizardContributor.buildSpellChoiceSteps?.(args)).resolves.toEqual(delegatedSteps);
    expect(buildWizardSpellChoiceSteps).toHaveBeenCalledWith({
      draft: args.draft,
      currentLevel: args.currentLevel,
      targetLevel: args.targetLevel,
      effectiveClassDocument: args.effectiveClassDocument,
      effectiveSchoolDocument: args.effectiveSchoolDocument,
      effectiveClassFeatureDocuments: [],
      extractSlug: args.extractSlug,
      readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
      classSlug: "wizard",
    });
    expect(buildClericSpellChoiceSteps).not.toHaveBeenCalled();
  });

  it("delegates cleric spell-choice steps to the cleric spell-choice builder", async () => {
    const delegatedSteps = [step("cleric-step")];
    buildClericSpellChoiceSteps.mockReturnValue(delegatedSteps);
    const args: BuildClassSpellChoiceStepsArgs = {
      ...spellChoiceArgs(),
      effectiveClassDocument: clericClassDocument(),
      effectiveDeityDocument: deityDocument(),
    };

    expect(clericContributor.slug).toBe("cleric");
    await expect(clericContributor.buildSpellChoiceSteps?.(args)).resolves.toEqual(delegatedSteps);
    expect(buildClericSpellChoiceSteps).toHaveBeenCalledWith({
      draft: args.draft,
      effectiveClassDocument: args.effectiveClassDocument,
      effectiveDeityDocument: args.effectiveDeityDocument,
      readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
      classSlug: "cleric",
    });
    expect(buildWizardSpellChoiceSteps).not.toHaveBeenCalled();
  });
});

function spellChoiceArgs(): BuildClassSpellChoiceStepsArgs {
  return {
    draft: createEmptyDraft(1),
    currentLevel: 1,
    targetLevel: 1,
    effectiveClassDocument: wizardClassDocument(),
    effectiveDeityDocument: null,
    effectiveSchoolDocument: null,
    extractSlug,
    readExistingSpellChoiceSelections: () => [],
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

function step(slotId: string) {
  return {
    slotId,
  };
}
