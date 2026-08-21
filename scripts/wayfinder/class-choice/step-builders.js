import { createClassBranchStep, createClassChoiceStep, createPickItemStep, createSkillTrainingStep, } from "../domain/step-types.js";
import { formatSlug, withIndefiniteArticle } from "../formatting.js";
import { buildChoiceRollOptions, discoverClassBranchMetas, discoverClassChoiceMeta, discoverGrantedItemMeta, discoverSkillTrainingMeta, getClassFeatureSources, } from "./rule-discovery.js";
export function buildClassTrainingStepsFromRules(args) {
    const { effectiveClassDocument, classSelection, extractSlug, localize, intelligenceModifier } = args;
    if (!effectiveClassDocument) {
        return [];
    }
    const training = discoverSkillTrainingMeta({
        classDocument: effectiveClassDocument,
        classSelection,
        extractSlug,
        localize,
        intelligenceModifier,
        activeRollOptions: args.activeRollOptions,
    });
    if (!training) {
        return [];
    }
    return [
        createSkillTrainingStep(1, `${training.className} skill training`, "Your class trains you in a few skills outright and lets you choose the rest.", training),
    ];
}
export async function buildClassBranchStepsFromRules(args) {
    const context = await loadClassFeatureContext(args);
    if (!context) {
        return [];
    }
    return buildClassBranchStepsFromFeatures(context.classFeatures, context.classSlug, args.extractSlug);
}
export async function buildClassGrantedItemStepsFromRules(args) {
    const context = await loadClassFeatureContext(args);
    if (!context) {
        return [];
    }
    return buildClassGrantedItemStepsFromFeatures(context.classFeatures, context.classSlug);
}
export async function buildClassChoiceStepsFromRules(args) {
    const context = await loadClassFeatureContext(args);
    if (!context) {
        return [];
    }
    return buildClassChoiceStepsFromFeatureSources({
        classFeatures: context.classFeatures,
        classSlug: context.classSlug,
        effectiveDeityDocument: args.effectiveDeityDocument,
        extractSlug: args.extractSlug,
        localize: args.localize,
        selectedValuesBySlotId: args.selectedValuesBySlotId,
        activeRollOptions: args.activeRollOptions,
    });
}
export function buildClassChoiceStepsFromFeatureSources(args) {
    return buildClassChoiceStepsFromFeatures(args);
}
async function loadClassFeatureContext(args) {
    const { effectiveClassDocument, targetLevel, fetchSelectionDocument, extractSlug } = args;
    if (!effectiveClassDocument) {
        return null;
    }
    return {
        classSlug: extractSlug(effectiveClassDocument),
        classFeatures: await getClassFeatureSources(effectiveClassDocument, targetLevel, fetchSelectionDocument),
    };
}
function buildClassBranchStepsFromFeatures(classFeatures, classSlug, extractSlug) {
    const steps = [];
    for (const feature of classFeatures) {
        const branches = discoverClassBranchMetas({
            selectorDocument: feature.document,
            selectorSelection: feature.selection,
            classSlug,
            extractSlug,
        });
        for (const branch of branches) {
            steps.push(createClassBranchStep(feature.level, branch));
        }
    }
    return steps;
}
function buildClassGrantedItemStepsFromFeatures(classFeatures, classSlug) {
    const steps = [];
    const activeRollOptions = new Set();
    if (classSlug) {
        activeRollOptions.add(`class:${classSlug}`.toLowerCase());
    }
    for (const feature of classFeatures) {
        const grant = discoverGrantedItemMeta({
            selectorDocument: feature.document,
            selectorSelection: feature.selection,
            classSlug,
            activeRollOptions,
        });
        if (!grant) {
            continue;
        }
        steps.push(createPickItemStep(grant.itemType === "deity" ? "deity" : "grant-choice", feature.level, grant.itemType === "deity" ? "Choose a deity" : `Choose ${grant.selectorName.toLowerCase()}`, grant.itemType === "deity"
            ? "Your deity sets your divine skill, favored weapon, sanctification, and divine font."
            : `Pick the ${grant.selectorName.toLowerCase()} this class feature hands you.`, grant.filters, {
            slotId: grant.slotId,
            grantSelection: grant,
        }));
    }
    return steps;
}
function buildClassChoiceStepsFromFeatures(args) {
    const steps = [];
    const rollOptions = buildChoiceRollOptions(args.effectiveDeityDocument);
    for (const option of args.activeRollOptions ?? []) {
        rollOptions.add(option.toLowerCase());
    }
    for (const feature of args.classFeatures) {
        const choices = discoverClassChoiceMeta({
            sourceDocument: feature.document,
            sourceSelection: feature.selection,
            sourceLevel: feature.level,
            classSlug: args.classSlug,
            extractSlug: args.extractSlug,
            localize: args.localize,
            rollOptions,
            selectedValuesBySlotId: args.selectedValuesBySlotId,
            existingSelectionsByFlag: feature.existingRulesSelections,
            staticGrantOwner: feature.staticGrantOwner,
        });
        for (const choice of choices) {
            steps.push(createClassChoiceStep(feature.level, choice, {
                title: buildClassChoiceTitle(choice, args.localize),
                description: buildClassChoiceDescription(choice),
            }));
        }
    }
    return steps;
}
function buildClassChoiceTitle(choice, localize) {
    const localized = localize(choice.sourceName);
    const flagLabel = formatSlug(choice.flag);
    if (choice.flag === "sanctification") {
        return "Sanctification";
    }
    if (choice.flag === "divineFont") {
        return "Divine Font";
    }
    return localized && localized !== choice.sourceName ? `${localized}: ${flagLabel}` : flagLabel;
}
function buildClassChoiceDescription(choice) {
    const classLabel = choice.classSlug ? formatSlug(choice.classSlug).toLowerCase() : "class";
    if (choice.flag === "sanctification") {
        return `Pick the sanctification your deity allows ${withIndefiniteArticle(classLabel)}.`;
    }
    if (choice.flag === "divineFont") {
        return `Pick the divine font your deity grants ${withIndefiniteArticle(classLabel)}.`;
    }
    return `Pick the ${formatSlug(choice.flag).toLowerCase()} this class feature hands you.`;
}
//# sourceMappingURL=step-builders.js.map