import { fetchSelectionDocument } from "../pack/access.js";
import { stampSelectionFlags } from "./selection-flags.js";
import { createEmbeddedSource } from "./selection-source-application.js";
const DEFAULT_INSERT_DEPS = {
    fetchSelectionDocument,
    createEmbeddedSource: (selection, draft, steps) => createEmbeddedSource(selection, draft, steps),
};
export async function insertFeatSelection(actor, selection, step, deps = DEFAULT_INSERT_DEPS, draft, steps = []) {
    const source = await deps.createEmbeddedSource(selection, draft, steps);
    if (!source) {
        return;
    }
    const slotData = resolveFeatSlotData(actor, selection, step);
    if (slotData) {
        applyFeatSlotData(source, slotData, step);
    }
    if (typeof actor.createEmbeddedDocuments === "function") {
        const inserted = await actor.createEmbeddedDocuments("Item", [source]);
        await stampSelectionFlags(actor, inserted, selection);
    }
}
function applyFeatSlotData(source, slotData, step) {
    source.system ??= {};
    const system = source.system;
    system.location = slotData.slotId ?? slotData.groupId;
    system.level ??= {};
    if (typeof step?.level === "number") {
        system.level.taken = step.level;
    }
}
function resolveFeatSlotData(actor, selection, step) {
    const groupId = resolveFeatGroupId(selection, step);
    if (!groupId) {
        return null;
    }
    const group = (typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId]);
    if (step?.slotKind === "archetype-feat") {
        if (!group) {
            throw new Error("PF2E's Free Archetype feat group is unavailable; the draft cannot be applied safely.");
        }
        return {
            groupId,
            slotId: `archetype-${step.level}`,
        };
    }
    const slots = Object.values(group?.slots ?? {});
    if (slots.length === 0) {
        return { groupId, slotId: null };
    }
    const matchingLevel = slots.find((slot) => slot.level === step?.level && !slot.feat);
    const firstOpen = slots.find((slot) => !slot.feat);
    return {
        groupId,
        slotId: matchingLevel?.id ?? firstOpen?.id ?? null,
    };
}
function resolveFeatGroupId(selection, step) {
    switch (step?.slotKind) {
        case "ancestry-feat":
            return "ancestry";
        case "class-feat":
            return "class";
        case "archetype-feat":
            return "archetype";
        case "skill-feat":
            return "skill";
        case "general-feat":
            return "general";
        default:
            switch (selection.featType) {
                case "ancestry":
                    return "ancestry";
                case "class":
                case "archetype":
                    return "class";
                case "skill":
                    return "skill";
                case "general":
                    return "general";
                default:
                    return null;
            }
    }
}
//# sourceMappingURL=feat-selection-application.js.map