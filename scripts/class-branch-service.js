import { applySelectorApplication, buildSelectorSelection, stripSelectedSelectorEntries, } from "./selector-application.js";
export async function applyClassBranchDraft(actor, draft, steps, deps) {
    const stepOrder = new Map(steps.map((step, index) => [step.slotId, index]));
    const orderedSteps = steps
        .filter((step) => step.kind === "class-branch" && step.branch)
        .sort((left, right) => (stepOrder.get(left.slotId) ?? 0) - (stepOrder.get(right.slotId) ?? 0));
    for (const step of orderedSteps) {
        const selection = draft.branchSelections[step.slotId];
        const branch = step.branch;
        if (!selection || !branch) {
            continue;
        }
        const plan = {
            selectorSelection: createBranchSelectorSelection(branch, step.slotId),
            slotId: step.slotId,
            ruleSelections: [
                {
                    flag: branch.flag,
                    ruleIndex: branch.selectorRuleIndex,
                    value: selection.uuid,
                },
            ],
            omitSelectedRulesOnCreate: true,
            grantPlan: {
                flag: branch.flag,
                slotId: step.slotId,
                selection,
                selectorRuleIndex: branch.selectorRuleIndex,
                createRulePolicy: "remove-all-grant-items",
                updateCreatedGrant: true,
            },
        };
        await applySelectorApplication(actor, plan, {
            ...deps,
            createEmbeddedSource: (selection, sourceDraft, sourceSteps) => deps.createEmbeddedSource(selection, sourceDraft ?? draft, sourceSteps ?? steps),
        });
    }
}
export function stripPreselectedClassBranchEntries(classSource, draft, steps) {
    stripSelectedSelectorEntries(classSource, getSelectedBranchSteps(draft, steps).map((step) => ({
        uuid: step.branch.selectorUuid,
        documentId: step.branch.selectorDocumentId,
        name: step.branch.selectorName,
    })));
}
export function createBranchSelectorSelection(branch, slotId) {
    return buildSelectorSelection(slotId, branch.selectorPackId, branch.selectorDocumentId, branch.selectorUuid, branch.selectorName);
}
function getSelectedBranchSteps(draft, steps) {
    return steps.filter((step) => step.kind === "class-branch" && !!step.branch && !!draft.branchSelections[step.slotId]);
}
//# sourceMappingURL=class-branch-service.js.map