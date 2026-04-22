import { getEffectiveBuildState, listActorItems } from "../../build-state.js";
import { MODULE_ID } from "../../constants.js";
import { fetchSelectionDocument } from "../../pack-service.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import { sourceIdOf } from "../../shared/source-id.js";
import { buildClassBranchSteps, buildClassChoiceSteps, buildClassFeatSteps, buildClassGrantedItemSteps, buildClassTrainingSteps, } from "../class-choice-service.js";
import { findDraftSelectionByType } from "../draft-decisions.js";
import { readExistingBranchSelection, readExistingClassChoiceSelection, readExistingGrantedSelection, readExistingLanguageSelections, readExistingSingletonChoiceSelection, readExistingSingletonSourceSelection, } from "../existing-selection-service.js";
import { buildLanguageChoiceSteps } from "../language-choice-service.js";
import { buildWayfinderPlan } from "../plan-service.js";
import { buildSingletonChoiceSteps } from "../singleton-choice-service.js";
import { buildSpellChoiceSteps, readExistingSpellChoiceSelections } from "../spell-choice-service.js";
const DEFAULT_DEPS = {
    buildWayfinderPlan,
    buildClassFeatSteps,
    buildClassTrainingSteps,
    buildSingletonChoiceSteps,
    buildLanguageChoiceSteps,
    buildClassBranchSteps,
    buildClassGrantedItemSteps,
    buildClassChoiceSteps,
    buildSpellChoiceSteps,
    findDraftSelectionByType,
    readExistingSingletonSourceSelection,
    readExistingBranchSelection,
    readExistingGrantedSelection,
    readExistingLanguageSelections,
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
        buildClassTrainingSteps: async (_planSnapshot, planDraft, targetLevel) => {
            const effectiveBuildState = await getEffectiveBuildState(args.actor, planDraft);
            return deps.buildClassTrainingSteps({
                draftClassSelection: deps.findDraftSelectionByType(planDraft, "class"),
                sourceSelections: [
                    {
                        sourceItemType: "ancestry",
                        sourceSelection: deps.findDraftSelectionByType(planDraft, "ancestry") ??
                            deps.readExistingSingletonSourceSelection(args.actor, "ancestry"),
                        sourceDocument: effectiveBuildState.ancestry?.document ?? null,
                    },
                    {
                        sourceItemType: "heritage",
                        sourceSelection: deps.findDraftSelectionByType(planDraft, "heritage") ??
                            deps.readExistingSingletonSourceSelection(args.actor, "heritage"),
                        sourceDocument: effectiveBuildState.heritage,
                    },
                    {
                        sourceItemType: "background",
                        sourceSelection: deps.findDraftSelectionByType(planDraft, "background") ??
                            deps.readExistingSingletonSourceSelection(args.actor, "background"),
                        sourceDocument: effectiveBuildState.background?.document ?? null,
                    },
                    ...(await resolveSkillTrainingFeatSources(planDraft, args, deps)),
                ],
                targetLevel,
                effectiveBuildState,
                fetchSelectionDocument: deps.fetchSelectionDocument,
                extractSlug: deps.extractDocumentSlug,
                localize: args.localize,
            });
        },
        buildSingletonChoiceSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildSingletonChoiceSteps({
            draft: planDraft,
            targetLevel,
            sources: await resolveSingletonChoiceSources(planDraft, args, deps),
            extractSlug: deps.extractDocumentSlug,
            localize: args.localize,
            readExistingSingletonChoiceSelection: (choice) => deps.readExistingSingletonChoiceSelection(args.actor, choice),
        }),
        buildLanguageChoiceSteps: async (planSnapshot, planDraft, targetLevel) => deps.buildLanguageChoiceSteps({
            snapshot: planSnapshot,
            targetLevel,
            draft: planDraft,
            effectiveBuildState: await getEffectiveBuildState(args.actor, planDraft),
            readExistingLanguageSelections: () => deps.readExistingLanguageSelections(args.actor),
            localizeLanguage: (slug) => localizeLanguageLabel(slug),
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
function localizeLanguageLabel(slug) {
    const globals = globalThis;
    const configLanguages = globals.CONFIG?.PF2E?.languages ?? {};
    const languageKey = configLanguages[slug];
    if (typeof languageKey === "string" && languageKey.length > 0) {
        return game.i18n.localize(languageKey);
    }
    return slug
        .split(/[-_ ]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
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
async function resolveSkillTrainingFeatSources(draft, args, deps) {
    const featSelections = dedupeSelectionsByUuid([
        ...Object.values(draft.selections).filter(isAncestryFeatSelection),
        ...readExistingAncestryFeatSelections(args.actor),
    ]);
    const documents = await Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection)));
    return featSelections.flatMap((sourceSelection, index) => {
        const sourceDocument = documents[index];
        return sourceDocument
            ? [
                {
                    sourceItemType: "feat",
                    sourceSelection,
                    sourceDocument,
                },
            ]
            : [];
    });
}
function isAncestryFeatSelection(selection) {
    return selection.itemType === "feat" && selection.featType === "ancestry";
}
function readExistingAncestryFeatSelections(actor) {
    return listActorItems(actor)
        .map((item) => selectionFromAncestryFeatItem(item))
        .filter((selection) => selection !== null);
}
function selectionFromAncestryFeatItem(item) {
    const typedItem = item;
    if (!typedItem || typedItem.type !== "feat") {
        return null;
    }
    const featType = typedItem.system?.featType?.value ?? typedItem.system?.category;
    if (featType !== "ancestry") {
        return null;
    }
    const sourceId = sourceIdOf(typedItem);
    if (!sourceId) {
        return null;
    }
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(sourceId);
    if (!match) {
        return null;
    }
    const level = toPositiveInteger(typedItem.system?.level?.value) ?? 1;
    const slotId = typeof typedItem.flags?.[MODULE_ID]?.slotId === "string" && typedItem.flags[MODULE_ID].slotId.length > 0
        ? typedItem.flags[MODULE_ID].slotId
        : `ancestry-feat-level-${level}`;
    return {
        slotId,
        packId: match[1],
        documentId: match[2],
        uuid: sourceId,
        itemType: "feat",
        featType: "ancestry",
        name: typeof typedItem.name === "string" ? typedItem.name : "",
        level,
    };
}
function dedupeSelectionsByUuid(selections) {
    const seen = new Set();
    const result = [];
    for (const selection of selections) {
        if (seen.has(selection.uuid)) {
            continue;
        }
        seen.add(selection.uuid);
        result.push(selection);
    }
    return result;
}
function toPositiveInteger(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 1 ? Math.floor(numeric) : null;
}
//# sourceMappingURL=wayfinder-plan-builder-service.js.map