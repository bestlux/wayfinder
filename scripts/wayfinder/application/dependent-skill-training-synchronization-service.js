import { projectSkillRanks } from "./build-skill-pane-service.js";
import { syncSkillTrainingSelections } from "./draft-adjustment-service.js";
export async function synchronizeDependentSkillTrainingChoices(options) {
    const projectedSkillRanksByStepId = Object.fromEntries(await Promise.all(options.steps.flatMap((step) => step.kind === "skill-training"
        ? [
            projectSkillRanks(options.state.draft, step.slotId, {
                baseSkillRanks: options.baseSkillRanks,
                steps: options.steps,
                resolveDocument: options.resolveDocument,
                localize: options.localize,
            }).then((ranks) => [step.slotId, ranks]),
        ]
        : [])));
    return syncSkillTrainingSelections(options.state, [...options.steps], projectedSkillRanksByStepId);
}
//# sourceMappingURL=dependent-skill-training-synchronization-service.js.map