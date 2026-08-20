import { getClassContributor } from "./classes/registry.js";
import { buildSpellChoiceStepsForContributor } from "./spell-choice/step-builders.js";
import { asSpellChoiceClassDocument } from "./spell-choice/types.js";
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
export async function buildSpellChoiceSteps(params) {
    const effectiveClassDocument = asSpellChoiceClassDocument(params.effectiveClassDocument);
    if (!effectiveClassDocument) {
        return [];
    }
    return buildSpellChoiceStepsForContributor({
        ...params,
        effectiveClassDocument,
    }, getClassContributor(params.extractSlug(effectiveClassDocument)));
}
export function buildHistoricalSpellChoicePlanningNote(params) {
    const effectiveClassDocument = asSpellChoiceClassDocument(params.effectiveClassDocument);
    const classSlug = effectiveClassDocument ? params.extractSlug(effectiveClassDocument) : null;
    if (params.currentLevel <= 1 || !classSlug || !HISTORICAL_CUTOFF_CLASS_SLUGS.has(classSlug)) {
        return null;
    }
    return `Wayfinder does not re-plan spells you picked at level ${params.currentLevel} or below. Whatever is already on the sheet counts as done, so check it there.`;
}
//# sourceMappingURL=spell-choice-service.js.map