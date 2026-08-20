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
                eyebrow: "Not guided yet",
                title: "Nothing here Wayfinder can guide",
                message: "Every option for this step leads to a follow-up choice Wayfinder can't handle yet, so it hides them rather than half-applying one. Make this choice on the PF2E sheet for now.",
            };
        }
        return {
            tone: "empty",
            eyebrow: "Nothing to pick from",
            title: "No options in your enabled sources",
            message: "Nothing in the compendia your world has turned on fits this step. Your GM can enable more content in the Wayfinder settings.",
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
                ? "Try a different search, or drop a filter."
                : hasActiveFilters
                    ? "Drop or change a filter to widen the list."
                    : "Try different search terms.",
        };
    }
    return null;
}
export function getPickerBlockedState(step, context) {
    if (step.slotKind === "campaign-feat" &&
        step.campaignFeat?.supported.length === 1 &&
        step.campaignFeat.supported[0] === "ancestry") {
        return ancestryFeatBlockedState(context);
    }
    switch (step.slotKind) {
        case "heritage":
            return context.ancestrySlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "One thing first",
                    title: "Choose an ancestry first",
                    message: "Heritages branch off your ancestry, so pick that first. Your options will show up here once it's set.",
                };
        case "ancestry-feat":
            return ancestryFeatBlockedState(context);
        case "class-feat":
            return context.classSlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "One thing first",
                    title: "Choose a class first",
                    message: "Class feats come from the class you pick, so choose that first.",
                };
        case "class-branch":
            if (step.branch?.dependsOn === "deity" && !context.deitySelected) {
                return {
                    tone: "blocked",
                    eyebrow: "One thing first",
                    title: "Choose a deity first",
                    message: "Which paths are open to you depends on your deity and how you're sanctified. Choose a deity first.",
                };
            }
            return context.classSlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "One thing first",
                    title: "Choose a class first",
                    message: "Every class has its own path to choose, a domain, a doctrine, a racket. Pick your class and the right one shows up here.",
                };
        case "deity":
            return context.classSlug
                ? null
                : {
                    tone: "blocked",
                    eyebrow: "One thing first",
                    title: "Choose a class first",
                    message: "Only some classes bring a deity with them, so pick your class first.",
                };
        case "spell-choice":
            if (step.spellChoice?.dependsOn === "class" && !context.classSlug) {
                return {
                    tone: "blocked",
                    eyebrow: "One thing first",
                    title: "Choose a class first",
                    message: "Your class decides which tradition you cast from, and that decides your spell list. Pick a class first.",
                };
            }
            if (requiresResolvedCurriculum(step)) {
                return {
                    tone: "blocked",
                    eyebrow: "One thing first",
                    title: "Choose an arcane school first",
                    message: "Your arcane school sets the curriculum these spells come from, so choose the school first.",
                };
            }
            return null;
        default:
            return null;
    }
}
function ancestryFeatBlockedState(context) {
    if (context.ancestryTraits.length === 0) {
        return {
            tone: "blocked",
            eyebrow: "One thing first",
            title: "Choose an ancestry first",
            message: "Ancestry feats come from your ancestry and any versatile heritage you took.",
        };
    }
    return context.classSlug
        ? null
        : {
            tone: "blocked",
            eyebrow: "One thing first",
            title: "Choose a class first",
            message: "A few ancestry feats key off class features like spellcasting, so Wayfinder needs your class before it can show the list.",
        };
}
function requiresResolvedCurriculum(step) {
    const spellChoice = step.spellChoice;
    return (!!spellChoice &&
        spellChoice.dependsOn === "class-branch" &&
        spellChoice.curriculumSpellNames.length === 0 &&
        spellChoice.requiresCurriculum !== false);
}
//# sourceMappingURL=picker-state.js.map