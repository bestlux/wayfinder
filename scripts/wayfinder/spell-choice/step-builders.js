import { buildClericSpellChoiceSteps } from "./cleric-step-builder.js";
import { asSpellChoiceClassDocument, asSpellChoiceDeityDocument, asSpellChoiceSchoolDocument, } from "./types.js";
import { buildWizardSpellChoiceSteps } from "./wizard-step-builder.js";
export async function buildSpellChoiceSteps(params) {
    const effectiveClassDocument = asSpellChoiceClassDocument(params.effectiveClassDocument);
    if (!effectiveClassDocument) {
        return [];
    }
    const classSlug = params.extractSlug(effectiveClassDocument);
    if (classSlug === "wizard") {
        return buildWizardSpellChoiceSteps({
            draft: params.draft,
            currentLevel: params.currentLevel,
            effectiveClassDocument,
            effectiveSchoolDocument: asSpellChoiceSchoolDocument(params.effectiveSchoolDocument),
            targetLevel: params.targetLevel,
            extractSlug: params.extractSlug,
            readExistingSpellChoiceSelections: params.readExistingSpellChoiceSelections,
            classSlug,
        });
    }
    if (classSlug === "cleric") {
        return buildClericSpellChoiceSteps({
            draft: params.draft,
            effectiveClassDocument,
            effectiveDeityDocument: asSpellChoiceDeityDocument(params.effectiveDeityDocument),
            readExistingSpellChoiceSelections: params.readExistingSpellChoiceSelections,
            classSlug,
        });
    }
    return [];
}
//# sourceMappingURL=step-builders.js.map