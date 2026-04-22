import { applyBoostDraft } from "./actor-updater/boost-application.js";
import { applyLanguageChoiceDraft } from "./actor-updater/language-choice-application.js";
import { syncNativeClassSpellcasting } from "./actor-updater/native-spellcasting-application.js";
import { createEmbeddedSource, featSelections, hasSourceId, insertFeatSelection, orderSelections, replaceSingletonItem, singletonSelections, } from "./actor-updater/selection-application.js";
import { applySingletonChoiceDraft } from "./actor-updater/singleton-choice-application.js";
import { applySpellChoiceDraft } from "./actor-updater/spell-choice-application.js";
import { applySkillIncreaseDraft, applyTrainingDraft } from "./actor-updater/training-application.js";
import { applyClassBranchDraft } from "./class-branch-service.js";
import { applyClassFeatureChoiceDraft } from "./class-feature-choice-service.js";
import { fetchSelectionDocument } from "./pack-service.js";
export async function applyDraftToActor(actor, draft, steps) {
    const selections = orderSelections(draft, steps);
    const stepsBySlotId = new Map(steps.map((step) => [step.slotId, step]));
    for (const selection of singletonSelections(selections)) {
        await replaceSingletonItem(actor, selection, draft, steps);
    }
    await applySingletonChoiceDraft(actor, draft, steps);
    await applyLanguageChoiceDraft(actor, draft, steps);
    const projectedTrainingRanks = await applyTrainingDraft(actor, draft, steps);
    await applyClassFeatureChoiceDraft(actor, draft, steps, {
        createEmbeddedSource,
        fetchSelectionDocument,
    });
    await applyClassBranchDraft(actor, draft, steps, {
        createEmbeddedSource,
        fetchSelectionDocument,
    });
    await syncNativeClassSpellcasting(actor, draft);
    for (const selection of featSelections(selections)) {
        if (hasSourceId(actor, selection.uuid)) {
            continue;
        }
        const step = stepsBySlotId.get(selection.slotId);
        await insertFeatSelection(actor, selection, step ?? null);
    }
    await applySpellChoiceDraft(actor, draft, steps);
    await applyBoostDraft(actor, draft);
    await applySkillIncreaseDraft(actor, draft, projectedTrainingRanks);
    const currentLevel = Number(actor?.system?.details?.level?.value ?? 1) || 1;
    if (draft.targetLevel > currentLevel && typeof actor.update === "function") {
        await actor.update({
            "system.details.level.value": draft.targetLevel,
        });
    }
}
//# sourceMappingURL=actor-updater.js.map