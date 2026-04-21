import { fetchSelectionDocument } from "../../pack-service.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import { buildClassBranchSteps, buildClassChoiceSteps, buildClassFeatSteps, buildClassGrantedItemSteps, buildClassTrainingSteps, } from "../class-choice-service.js";
import { findDraftSelectionByType } from "../draft-decisions.js";
import { readExistingBranchSelection, readExistingClassChoiceSelection, readExistingGrantedSelection, readExistingSingletonChoiceSelection, readExistingSingletonSourceSelection, } from "../existing-selection-service.js";
import { buildWayfinderPlan } from "../plan-service.js";
import { buildSingletonChoiceSteps } from "../singleton-choice-service.js";
import { buildSpellChoiceSteps, readExistingSpellChoiceSelections } from "../spell-choice-service.js";
const DEFAULT_DEPS = {
    buildWayfinderPlan,
    buildClassFeatSteps,
    buildClassTrainingSteps,
    buildSingletonChoiceSteps,
    buildClassBranchSteps,
    buildClassGrantedItemSteps,
    buildClassChoiceSteps,
    buildSpellChoiceSteps,
    findDraftSelectionByType,
    readExistingSingletonSourceSelection,
    readExistingBranchSelection,
    readExistingGrantedSelection,
    readExistingClassChoiceSelection,
    readExistingSingletonChoiceSelection,
    readExistingSpellChoiceSelections,
    fetchSelectionDocument,
    extractDocumentSlug,
};
export async function buildWayfinderAppPlan(args, deps = DEFAULT_DEPS) {
    return deps.buildWayfinderPlan(args.snapshot, args.draft, {
        buildClassFeatSteps: async (planSnapshot, _planDraft, targetLevel) => deps.buildClassFeatSteps({
            effectiveClassDocument: await args.resolveDocument("class"),
            targetLevel,
            fulfilledCount: planSnapshot.featCounts.class + planSnapshot.featCounts.archetype,
        }),
        buildClassTrainingSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildClassTrainingSteps({
            draftClassSelection: deps.findDraftSelectionByType(planDraft, "class"),
            targetLevel,
            fetchSelectionDocument: deps.fetchSelectionDocument,
            extractSlug: deps.extractDocumentSlug,
            localize: args.localize,
        }),
        buildSingletonChoiceSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildSingletonChoiceSteps({
            draft: planDraft,
            targetLevel,
            sources: await resolveSingletonChoiceSources(planDraft, args, deps),
            extractSlug: deps.extractDocumentSlug,
            localize: args.localize,
            readExistingSingletonChoiceSelection: (choice) => deps.readExistingSingletonChoiceSelection(args.actor, choice),
        }),
        buildClassBranchSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildClassBranchSteps({
            draft: planDraft,
            effectiveClassDocument: await args.resolveDocument("class"),
            targetLevel,
            fetchSelectionDocument: deps.fetchSelectionDocument,
            extractSlug: deps.extractDocumentSlug,
            readExistingBranchSelection: (branch) => deps.readExistingBranchSelection(args.actor, branch),
        }),
        buildClassGrantedItemSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildClassGrantedItemSteps({
            draft: planDraft,
            effectiveClassDocument: await args.resolveDocument("class"),
            targetLevel,
            fetchSelectionDocument: deps.fetchSelectionDocument,
            extractSlug: deps.extractDocumentSlug,
            readExistingGrantedSelection: (grant) => deps.readExistingGrantedSelection(args.actor, grant),
        }),
        buildClassChoiceSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildClassChoiceSteps({
            draft: planDraft,
            effectiveClassDocument: await args.resolveDocument("class"),
            effectiveDeityDocument: await args.resolveDocument("deity"),
            targetLevel,
            fetchSelectionDocument: deps.fetchSelectionDocument,
            extractSlug: deps.extractDocumentSlug,
            localize: args.localize,
            readExistingClassChoiceSelection: (choice) => deps.readExistingClassChoiceSelection(args.actor, choice),
        }),
        buildSpellChoiceSteps: async (planSnapshot, planDraft, targetLevel) => {
            const effectiveClassDocument = await args.resolveDocument("class");
            const effectiveDeityDocument = await args.resolveDocument("deity");
            const effectiveSchoolDocument = await args.resolveArcaneSchoolDocument();
            const readExistingSelections = (choice) => deps.readExistingSpellChoiceSelections(args.actor, choice);
            return deps.buildSpellChoiceSteps({
                draft: planDraft,
                currentLevel: planSnapshot.level,
                effectiveClassDocument,
                effectiveDeityDocument,
                effectiveSchoolDocument,
                targetLevel,
                extractSlug: deps.extractDocumentSlug,
                readExistingSpellChoiceSelections: readExistingSelections,
            });
        },
    });
}
export async function findPlanStepBySlotId(args, slotId, deps = DEFAULT_DEPS) {
    const plan = await buildWayfinderAppPlan(args, deps);
    return plan.steps.find((step) => step.slotId === slotId) ?? null;
}
async function resolveSingletonChoiceSources(draft, args, deps) {
    const itemTypes = [
        "ancestry",
        "heritage",
        "background",
        "class",
        "deity",
    ];
    const documents = await Promise.all(itemTypes.map((itemType) => args.resolveDocument(itemType)));
    return itemTypes
        .map((itemType, index) => {
        const sourceSelection = deps.findDraftSelectionByType(draft, itemType) ??
            deps.readExistingSingletonSourceSelection(args.actor, itemType);
        return {
            sourceItemType: itemType,
            sourceSelection,
            sourceDocument: documents[index],
        };
    })
        .filter((entry) => !!entry.sourceSelection && !!entry.sourceDocument);
}
//# sourceMappingURL=wayfinder-plan-builder-service.js.map