import { asSpellChoiceClassDocument, asSpellChoiceDeityDocument, asSpellChoiceSchoolDocument, } from "./types.js";
export async function buildSpellChoiceSteps(params, contributor) {
    const effectiveClassDocument = asSpellChoiceClassDocument(params.effectiveClassDocument);
    if (!effectiveClassDocument) {
        return [];
    }
    return ((await contributor?.buildSpellChoiceSteps?.({
        draft: params.draft,
        currentLevel: params.currentLevel,
        targetLevel: params.targetLevel,
        effectiveClassDocument,
        effectiveDeityDocument: asSpellChoiceDeityDocument(params.effectiveDeityDocument),
        effectiveSchoolDocument: asSpellChoiceSchoolDocument(params.effectiveSchoolDocument),
        extractSlug: params.extractSlug,
        readExistingSpellChoiceSelections: params.readExistingSpellChoiceSelections,
    })) ?? []);
}
//# sourceMappingURL=step-builders.js.map