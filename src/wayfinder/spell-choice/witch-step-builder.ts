import { wizardMaxSpellRank } from "../../shared/spellcasting.js";
import type { PendingStep } from "../../types.js";
import { buildPreparedSpellChoiceSteps, preparedSpellChoiceDestination } from "./prepared-step-builder.js";
import { findClassFeatureSource } from "./source-utils.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
import type { SpellTradition } from "./tradition-utils.js";
import type { ReadExistingSpellChoiceSelections, SpellChoiceClassDocument } from "./types.js";

interface BuildWitchSpellChoiceStepsParams {
  draft: Parameters<typeof appendPendingSpellChoiceStep>[2];
  currentLevel: number;
  effectiveClassDocument: SpellChoiceClassDocument;
  targetLevel: number;
  tradition: SpellTradition;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}

export function buildWitchSpellChoiceSteps(params: BuildWitchSpellChoiceStepsParams): PendingStep[] {
  const initialSteps = buildPreparedSpellChoiceSteps({
    draft: params.draft,
    effectiveClassDocument: params.effectiveClassDocument,
    classSlug: "witch",
    classLabel: "Witch",
    spellcastingFeatureName: "Witch Spellcasting",
    tradition: params.tradition,
    ability: "int",
    cantripCount: 5,
    rankOneCount: 2,
    readExistingSpellChoiceSelections: params.readExistingSpellChoiceSelections,
  });
  const source = findClassFeatureSource(params.effectiveClassDocument, "Witch Spellcasting");
  const destination = {
    ...preparedSpellChoiceDestination({
      classSlug: "witch",
      tradition: params.tradition,
      ability: "int",
    }),
    type: "spellbook" as const,
    label: "Witch familiar spells",
  };
  const learnedSteps: PendingStep[] = [];
  const addStep = (step: PendingStep): void =>
    appendPendingSpellChoiceStep(learnedSteps, step, params.draft, params.readExistingSpellChoiceSelections);

  for (let level = Math.max(2, params.currentLevel + 1); level <= params.targetLevel; level += 1) {
    addStep(
      makeSpellChoiceStep({
        slotId: `spell-choice-witch-familiar-level-${level}`,
        level,
        title: `Level ${level} witch familiar spells`,
        description: `Add the two ${params.tradition} spells your familiar learns at level ${level}. They can be any spell rank you can currently cast.`,
        source,
        classSlug: "witch",
        dependsOn: "class",
        count: 2,
        minRank: 1,
        maxRank: wizardMaxSpellRank(level),
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
        reuseExistingEntryOnly: true,
        destination,
      })
    );
  }

  return [...initialSteps, ...learnedSteps];
}
