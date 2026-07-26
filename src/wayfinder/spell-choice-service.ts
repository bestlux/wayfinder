import { getClassContributor } from "./classes/registry.js";
import { buildSpellChoiceStepsForContributor } from "./spell-choice/step-builders.js";
import { asSpellChoiceClassDocument, type BuildSpellChoiceStepsParams } from "./spell-choice/types.js";

export { findSpellcastingEntryForChoice, wizardMaxSpellRank } from "../shared/spellcasting.js";
export { readExistingSpellChoiceSelections } from "./spell-choice/existing-selections.js";

const HISTORICAL_CUTOFF_CLASS_SLUGS = new Set([
  "bard",
  "magus",
  "oracle",
  "psychic",
  "sorcerer",
  "summoner",
  "witch",
  "wizard",
]);

export async function buildSpellChoiceSteps(params: BuildSpellChoiceStepsParams) {
  const effectiveClassDocument = asSpellChoiceClassDocument(params.effectiveClassDocument);
  if (!effectiveClassDocument) {
    return [];
  }

  return buildSpellChoiceStepsForContributor(
    {
      ...params,
      effectiveClassDocument,
    },
    getClassContributor(params.extractSlug(effectiveClassDocument))
  );
}

export function buildHistoricalSpellChoicePlanningNote(
  params: Pick<BuildSpellChoiceStepsParams, "currentLevel" | "effectiveClassDocument" | "extractSlug">
): string | null {
  const effectiveClassDocument = asSpellChoiceClassDocument(params.effectiveClassDocument);
  const classSlug = effectiveClassDocument ? params.extractSlug(effectiveClassDocument) : null;
  if (params.currentLevel <= 1 || !classSlug || !HISTORICAL_CUTOFF_CLASS_SLUGS.has(classSlug)) {
    return null;
  }

  return `Spell choices for levels up to ${params.currentLevel} aren't re-planned for existing characters. Spells already on the sheet are treated as complete — review them there.`;
}
