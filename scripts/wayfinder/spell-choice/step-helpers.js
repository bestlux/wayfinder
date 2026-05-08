import { createSpellChoiceStep } from "../domain/step-types.js";
export function appendPendingSpellChoiceStep(steps, step, draft, readExistingSpellChoiceSelections) {
    if (!shouldSuppressResolvedSpellChoiceStep(step, draft, readExistingSpellChoiceSelections)) {
        steps.push(step);
    }
}
export function makeSpellChoiceStep(args) {
    return createSpellChoiceStep(args.level, args.title, args.description, {
        slotId: args.slotId,
        sourcePackId: args.source.sourcePackId,
        sourceDocumentId: args.source.sourceDocumentId,
        sourceUuid: args.source.sourceUuid,
        sourceName: args.source.sourceName,
        classSlug: args.classSlug,
        dependsOn: args.dependsOn,
        destination: { ...args.destination },
        count: args.count,
        minRank: args.minRank,
        maxRank: args.maxRank,
        cantrip: args.cantrip,
        ...(args.allowedSpellSlugs ? { allowedSpellSlugs: args.allowedSpellSlugs } : {}),
        ...(args.excludedTraditions ? { excludedTraditions: args.excludedTraditions } : {}),
        curriculumSpellNames: args.curriculumSpellNames,
        ...(args.requiresCurriculum !== undefined ? { requiresCurriculum: args.requiresCurriculum } : {}),
        additionalAllowedSpellNames: args.additionalAllowedSpellNames,
        ...(args.additionalAllowedSpellUuids ? { additionalAllowedSpellUuids: args.additionalAllowedSpellUuids } : {}),
        restrictToCommon: args.restrictToCommon,
    });
}
export function hasSatisfiedExistingSelections(step, draft, readExistingSpellChoiceSelections) {
    const choice = step.spellChoice;
    if (!choice) {
        return false;
    }
    const existingSelections = readExistingSpellChoiceSelections(choice);
    const draftedSelections = draft.spellChoices[step.slotId] ?? [];
    return existingSelections.length >= choice.count && draftedSelections.length === 0;
}
function shouldSuppressResolvedSpellChoiceStep(step, draft, readExistingSpellChoiceSelections) {
    return hasSatisfiedExistingSelections(step, draft, readExistingSpellChoiceSelections);
}
//# sourceMappingURL=step-helpers.js.map