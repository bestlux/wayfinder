import { createEmptyDraft } from "../../draft-service.js";
export function decideExternalDraftRefresh(input) {
    const localDraft = input.localDraft ?? createEmptyDraft(input.currentLevel);
    const liveDraft = input.liveDraft ?? createEmptyDraft(input.currentLevel);
    if (draftContentFingerprint(localDraft) === draftContentFingerprint(liveDraft)) {
        return "acknowledge";
    }
    if (input.saveState.phase === "saving" && !input.lifecycleBusy) {
        return "defer";
    }
    const saveIsClean = (input.saveState.phase === "idle" || input.saveState.phase === "saved") &&
        input.saveState.revision === input.saveState.durableRevision;
    return saveIsClean && !input.lifecycleBusy ? "adopt" : "conflict";
}
export function actorUpdateTouchesWayfinderDraft(changes, moduleId) {
    if (!isRecord(changes)) {
        return false;
    }
    if (`flags.${moduleId}.draft` in changes) {
        return true;
    }
    const flags = changes.flags;
    if (!isRecord(flags)) {
        return false;
    }
    const moduleFlags = flags[moduleId];
    return isRecord(moduleFlags) && ("draft" in moduleFlags || "-=draft" in moduleFlags);
}
function draftContentFingerprint(draft) {
    return JSON.stringify({ ...draft, updatedAt: null });
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=external-draft-refresh-service.js.map