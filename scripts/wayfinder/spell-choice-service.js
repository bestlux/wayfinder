import { getClassContributor } from "./classes/registry.js";
import { buildSpellChoiceStepsForContributor } from "./spell-choice/step-builders.js";
import { asSpellChoiceClassDocument } from "./spell-choice/types.js";
export { findSpellcastingEntryForChoice, wizardMaxSpellRank } from "../shared/spellcasting.js";
export { readExistingSpellChoiceSelections } from "./spell-choice/existing-selections.js";
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
//# sourceMappingURL=spell-choice-service.js.map