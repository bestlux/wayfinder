import { classArchetypeProfile, classArchetypeProfileForDocument, } from "../class-archetype/registry.js";
const FOUNDATION_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);
export function activePlannedClassArchetypeProfile(draft, steps) {
    for (const step of steps) {
        if (step.kind !== "class-archetype")
            continue;
        const value = draft.classArchetypeChoices[step.slotId];
        if (!step.classArchetype.options.some((option) => option.value === value))
            continue;
        const profile = classArchetypeProfile(value);
        if (profile?.classSlug === step.classArchetype.selector.classSlug &&
            profile.selectorTag === step.classArchetype.selector.optionTag) {
            return profile;
        }
    }
    return null;
}
export function resolveActiveClassArchetypeProfile(draft, steps, actorDocuments) {
    const planned = activePlannedClassArchetypeProfile(draft, steps);
    if (planned)
        return planned;
    const hasActiveDecision = steps.some((step) => step.kind === "class-archetype" && typeof draft.classArchetypeChoices[step.slotId] === "string");
    if (hasActiveDecision)
        return null;
    for (const document of actorDocuments) {
        const retained = classArchetypeProfileForDocument(document);
        if (retained)
            return retained;
    }
    return null;
}
export function retainActiveClassArchetypeChoices(draft, steps) {
    const activeSlotIds = new Set(steps.filter((step) => step.kind === "class-archetype").map((step) => step.slotId));
    draft.classArchetypeChoices = Object.fromEntries(Object.entries(draft.classArchetypeChoices).filter(([slotId]) => activeSlotIds.has(slotId)));
}
/**
 * Lists selected documents whose static skill grants are part of the active
 * progression, and records whether Apply guarantees that PF2E has prepared
 * each document before Wayfinder reaches its skill phase.
 */
export function listPlannedStaticSkillSources(draft, steps) {
    const activeSlotIds = new Set(steps.map((step) => step.slotId));
    const sources = Object.values(draft.selections)
        .filter((selection) => activeSlotIds.has(selection.slotId) && FOUNDATION_ITEM_TYPES.has(selection.itemType))
        .map((selection) => ({ selection, requiredBeforeSkillPhase: true }));
    const profile = activePlannedClassArchetypeProfile(draft, steps);
    const profileStep = profile
        ? steps.find((step) => step.kind === "class-archetype" &&
            classArchetypeProfile(draft.classArchetypeChoices[step.slotId])?.value === profile.value)
        : null;
    if (profile && profileStep) {
        sources.push({
            selection: { ...profile.selection, slotId: profileStep.slotId },
            // Singleton replacement batches the registered class-archetype source
            // with a drafted class. Without a class replacement, the source is
            // materialized later by the class-archetype phase.
            requiredBeforeSkillPhase: sources.some(({ selection }) => selection.itemType === "class"),
        });
    }
    return Object.freeze(sources.map((source) => Object.freeze({
        selection: Object.freeze({ ...source.selection }),
        requiredBeforeSkillPhase: source.requiredBeforeSkillPhase,
    })));
}
//# sourceMappingURL=planned-static-skill-source-service.js.map