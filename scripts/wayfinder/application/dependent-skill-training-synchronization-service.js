import { compileSkillPaneProgression } from "./build-skill-pane-service.js";
import { applySkillProgressionReconciliation } from "./draft-adjustment-service.js";
export async function synchronizeDependentSkillTrainingChoices(options) {
    const progression = await compileSkillPaneProgression(options.state.draft, {
        baseSkillRanks: options.baseSkillRanks,
        steps: options.steps,
        resolveDocument: options.resolveDocument,
        localize: options.localize,
    });
    return applySkillProgressionReconciliation(options.state, progression);
}
//# sourceMappingURL=dependent-skill-training-synchronization-service.js.map