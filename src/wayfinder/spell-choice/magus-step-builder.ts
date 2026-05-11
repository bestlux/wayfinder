import { wizardMaxSpellRank } from "../../shared/spellcasting.js";
import type { PendingStep } from "../../types.js";
import { findClassFeatureSource } from "./source-utils.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
import type { ReadExistingSpellChoiceSelections, SpellChoiceClassDocument } from "./types.js";

interface BuildMagusSpellChoiceStepsParams {
  draft: Parameters<typeof appendPendingSpellChoiceStep>[2];
  currentLevel: number;
  effectiveClassDocument: SpellChoiceClassDocument;
  targetLevel: number;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}

const MAGUS_SPELLBOOK_DESTINATION = {
  type: "spellbook",
  key: "magus-arcane-prepared",
  label: "Magus spellbook",
  entryName: "Arcane Prepared Spells",
  tradition: "arcane",
  ability: "int",
  prepared: "prepared",
} as const;

export function buildMagusSpellChoiceSteps(params: BuildMagusSpellChoiceStepsParams): PendingStep[] {
  const source = findClassFeatureSource(params.effectiveClassDocument, "Arcane Spellcasting (Magus)");
  const steps: PendingStep[] = [];
  const addStep = (step: PendingStep): void =>
    appendPendingSpellChoiceStep(steps, step, params.draft, params.readExistingSpellChoiceSelections);

  addStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-magus-cantrips-level-1",
      level: 1,
      title: "Magus spellbook cantrips",
      description: "Add the eight arcane cantrips that begin your magus spellbook.",
      source,
      classSlug: "magus",
      dependsOn: "class",
      count: 8,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: false,
      destination: MAGUS_SPELLBOOK_DESTINATION,
    })
  );

  addStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-magus-spellbook-rank-1-level-1",
      level: 1,
      title: "Magus spellbook spells",
      description: "Add the four 1st-rank arcane spells that begin your magus spellbook.",
      source,
      classSlug: "magus",
      dependsOn: "class",
      count: 4,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: false,
      destination: MAGUS_SPELLBOOK_DESTINATION,
    })
  );

  for (let level = Math.max(2, params.currentLevel + 1); level <= params.targetLevel; level += 1) {
    addStep(
      makeSpellChoiceStep({
        slotId: `spell-choice-magus-spellbook-level-${level}`,
        level,
        title: `Level ${level} magus spellbook additions`,
        description: `Add the two arcane spells you learn at level ${level}. They can be any spell rank you can currently cast.`,
        source,
        classSlug: "magus",
        dependsOn: "class",
        count: 2,
        minRank: 1,
        maxRank: wizardMaxSpellRank(level),
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: false,
        destination: MAGUS_SPELLBOOK_DESTINATION,
      })
    );
  }

  return steps;
}
