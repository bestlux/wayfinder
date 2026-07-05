import { createPickItemStep } from "../domain/step-types.js";
import { formatSlug } from "../formatting.js";
import { discoverFlagChoiceMeta } from "./rule-discovery.js";
export function buildFlagChoiceStepsFromRules(args) {
    const { sourceItemType, effectiveSourceDocument, sourceSelection, extractSlug } = args;
    if (!effectiveSourceDocument || !sourceSelection) {
        return [];
    }
    return discoverFlagChoiceMeta({
        sourceItemType,
        sourceDocument: effectiveSourceDocument,
        sourceSelection,
        extractSlug,
        localize: args.localize,
        actorContext: args.actorContext,
        requireResolvedActorPlaceholders: args.requireResolvedActorPlaceholders,
    }).map((choice) => createPickItemStep("flag-choice", choiceSourceLevel(effectiveSourceDocument), buildFlagChoiceTitle(choice), buildFlagChoiceDescription(choice), choice.filters, {
        slotId: choice.slotId,
        flagChoice: choice,
    }));
}
function choiceSourceLevel(document) {
    const value = document?.system?.level?.value;
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}
function buildFlagChoiceTitle(choice) {
    return choice.prompt ?? choice.sourceName + " " + formatSlug(choice.flag);
}
function buildFlagChoiceDescription(choice) {
    const sourceLabel = choice.sourceItemType === "feat"
        ? "selected feat"
        : choice.sourceItemType === "classfeature"
            ? "selected class feature"
            : choice.sourceItemType;
    return "Choose the " + formatSlug(choice.itemType).toLowerCase() + " this " + sourceLabel + " configures.";
}
//# sourceMappingURL=step-builders.js.map