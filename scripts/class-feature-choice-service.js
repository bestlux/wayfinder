import { applySelectorApplication, buildSelectorSelection, stripSelectedSelectorEntries, } from "./selector-application.js";
import { usesNativeGrantItemCreation } from "./shared/grant-creation-policy.js";
export async function applyClassFeatureChoiceDraft(actor, draft, steps, deps) {
    const groups = collectFeatureGroups(draft, steps);
    for (const group of groups) {
        const selectorSlotId = group.grantStep?.slotId ?? group.choiceEntries[0]?.step.slotId ?? null;
        const plan = {
            selectorSelection: group.sourceSelection,
            slotId: selectorSlotId,
            ruleSelections: group.choiceEntries.map((entry) => ({
                flag: entry.meta.flag,
                ruleIndex: entry.meta.sourceRuleIndex,
                value: entry.value,
            })),
            grantPlan: group.grantMeta && group.grantSelection
                ? {
                    flag: group.grantMeta.flag,
                    slotId: group.grantStep?.slotId ?? group.grantMeta.slotId,
                    selection: group.grantSelection,
                    selectorRuleIndex: group.grantMeta.selectorRuleIndex,
                    createRulePolicy: [group.grantMeta.grantRuleIndex],
                    updateExistingGrantImmediately: true,
                }
                : null,
        };
        await applySelectorApplication(actor, plan, {
            ...deps,
            createEmbeddedSource: (selection, sourceDraft, sourceSteps) => deps.createEmbeddedSource(selection, sourceDraft ?? draft, sourceSteps ?? steps),
        });
    }
}
export function stripPreselectedClassFeatureEntries(classSource, draft, steps) {
    stripSelectedSelectorEntries(classSource, collectSelectedFeatureRefs(draft, steps));
}
function collectFeatureGroups(draft, steps) {
    const groups = new Map();
    for (const step of steps) {
        if (step.kind === "pick-item" && step.grantSelection) {
            if (usesNativeGrantItemCreation(step)) {
                continue;
            }
            const selection = draft.selections[step.slotId];
            if (!selection) {
                continue;
            }
            const key = step.grantSelection.selectorUuid;
            const group = groups.get(key) ?? {
                sourceSelection: createSourceSelection(step.grantSelection, step.slotId),
                grantStep: null,
                grantMeta: null,
                grantSelection: null,
                choiceEntries: [],
            };
            group.grantStep = step;
            group.grantMeta = step.grantSelection;
            group.grantSelection = selection;
            groups.set(key, group);
            continue;
        }
        if (step.kind === "class-choice" && step.classChoice) {
            const value = draft.classChoices[step.slotId];
            if (!value) {
                continue;
            }
            const key = step.classChoice.sourceUuid;
            const group = groups.get(key) ?? {
                sourceSelection: createSourceSelection(step.classChoice, step.slotId),
                grantStep: null,
                grantMeta: null,
                grantSelection: null,
                choiceEntries: [],
            };
            group.choiceEntries.push({ step, meta: step.classChoice, value });
            groups.set(key, group);
        }
    }
    return Array.from(groups.values());
}
function collectSelectedFeatureRefs(draft, steps) {
    const refs = new Map();
    for (const step of steps) {
        if (step.kind === "pick-item" && step.grantSelection && draft.selections[step.slotId]) {
            if (usesNativeGrantItemCreation(step)) {
                continue;
            }
            refs.set(step.grantSelection.selectorUuid, {
                uuid: step.grantSelection.selectorUuid,
                documentId: step.grantSelection.selectorDocumentId,
                name: step.grantSelection.selectorName,
            });
        }
        if (step.kind === "class-choice" && step.classChoice && draft.classChoices[step.slotId]) {
            refs.set(step.classChoice.sourceUuid, {
                uuid: step.classChoice.sourceUuid,
                documentId: step.classChoice.sourceDocumentId,
                name: step.classChoice.sourceName,
            });
        }
    }
    return Array.from(refs.values());
}
function createSourceSelection(meta, slotId) {
    const itemType = "sourceItemType" in meta ? meta.sourceItemType : "feat";
    const featType = itemType === "feat" || itemType === "classfeature" ? "classfeature" : null;
    return buildSelectorSelection(slotId, "selectorPackId" in meta ? meta.selectorPackId : meta.sourcePackId, "selectorDocumentId" in meta ? meta.selectorDocumentId : meta.sourceDocumentId, "selectorUuid" in meta ? meta.selectorUuid : meta.sourceUuid, "selectorName" in meta ? meta.selectorName : meta.sourceName, itemType === "classfeature" ? "feat" : itemType, featType);
}
//# sourceMappingURL=class-feature-choice-service.js.map