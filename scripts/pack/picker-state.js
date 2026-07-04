import { hidesUnsupportedEmbeddedChoiceSets } from "./embedded-choice-policy.js";
export function getPickerInfoState(step, context, optionCount, filteredCount, search, hasActiveFilters = false) {
    const blocked = getPickerBlockedState(step, context);
    if (blocked) {
        return blocked;
    }
    if (optionCount === 0) {
        if (hidesUnsupportedEmbeddedChoiceSets(step)) {
            return {
                tone: "empty",
                eyebrow: "Unsupported guided options",
                title: "No guided options are available",
                message: "Nothing directly guided is available here. Wayfinder hides direct options that require unsupported follow-up choices; use the PF2E sheet for those choices for now.",
            };
        }
        return {
            tone: "empty",
            eyebrow: "No matching sources",
            title: "No valid options are available",
            message: "Nothing in your enabled sources matches this step. Ask your GM if more content can be allowlisted.",
        };
    }
    if (filteredCount === 0 && (search.trim() || hasActiveFilters)) {
        const searchActive = search.trim().length > 0;
        return {
            tone: "search",
            eyebrow: hasActiveFilters ? "Filters active" : "Search results",
            title: searchActive && hasActiveFilters
                ? "No choices match this search and filters"
                : hasActiveFilters
                    ? "No choices match current filters"
                    : "No choices match this search",
            message: searchActive && hasActiveFilters
                ? "Adjust the search or remove a filter to widen the list again."
                : hasActiveFilters
                    ? "Remove or change a filter to widen the list again."
                    : "Adjust the search terms to widen the list again.",
        };
    }
    return null;
}
export function getPickerBlockedState(step, context) {
    switch (step.slotKind) {
        case "heritage":
            return context.ancestrySlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose an ancestry first",
                    message: "Pick an ancestry first — heritages depend on it, and your options will show up here once that's set.",
                };
        case "ancestry-feat":
            if (context.ancestryTraits.length === 0) {
                return {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose an ancestry before ancestry feats",
                    message: "Ancestry feats are filtered from the drafted ancestry and any versatile heritage tags.",
                };
            }
            return context.classSlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a class before ancestry feats",
                    message: "Some ancestry feats depend on class features such as spellcasting. Pick the class step before reviewing ancestry feat options.",
                };
        case "class-feat":
            return context.classSlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a class first",
                    message: "Class feat options are filtered from the drafted class. Pick the class step before reviewing class feats.",
                };
        case "class-branch":
            if (step.branch?.dependsOn === "deity" && !context.deitySelected) {
                return {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a deity first",
                    message: "This class path depends on the drafted deity and sanctification state. Resolve the deity step before reviewing these branch options.",
                };
            }
            return context.classSlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a class first",
                    message: "Pick a class first. Each class has its own branch — domain, doctrine, racket, and so on — and we'll show those once we know which class you're playing.",
                };
        case "deity":
            return context.classSlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a class first",
                    message: "Wayfinder only offers deity choices when a drafted class grants them. Pick the class step before reviewing deity options.",
                };
        case "spell-choice":
            if (step.spellChoice?.dependsOn === "class" && !context.classSlug) {
                return {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose a class first",
                    message: "Pick a class first. Spell options depend on what tradition you'll be casting from.",
                };
            }
            if (requiresResolvedCurriculum(step)) {
                return {
                    tone: "blocked",
                    eyebrow: "Prerequisite required",
                    title: "Choose an arcane school first",
                    message: "This spell choice depends on the drafted arcane school. Resolve the school step before reviewing curriculum spells.",
                };
            }
            return null;
        default:
            return null;
    }
}
function requiresResolvedCurriculum(step) {
    const spellChoice = step.spellChoice;
    return (!!spellChoice &&
        spellChoice.dependsOn === "class-branch" &&
        spellChoice.curriculumSpellNames.length === 0 &&
        spellChoice.requiresCurriculum !== false);
}
//# sourceMappingURL=picker-state.js.map