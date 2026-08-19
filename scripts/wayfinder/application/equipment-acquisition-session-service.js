import { createAcquisitionExecutionSession, } from "./acquisition-execution-service.js";
export function createEquipmentAcquisitionExecutionDependencies(options) {
    if (!options.characterDraft.acquisition) {
        throw new TypeError("Starting-equipment execution requires an acquisition draft.");
    }
    return {
        resolveSource: ({ actor, draft, entry }) => options.runtime.resolveSourceForApply({
            actor,
            characterDraft: options.characterDraft,
            acquisition: draft,
            entry,
        }),
        readHistory: options.readHistory,
        resolveCurrentPolicySnapshot: ({ actor, draft }) => options.runtime.resolveCurrentPolicySnapshot(actor, draft),
        assertApplyAuthority: options.assertApplyAuthority,
        readApplyingUser: options.readApplyingUser,
        readEnvironment: options.readEnvironment,
        ...(options.now ? { now: options.now } : {}),
        ...(options.inventory ? { inventory: options.inventory } : {}),
    };
}
export function createEquipmentAcquisitionExecutionSession(options) {
    return createAcquisitionExecutionSession(createEquipmentAcquisitionExecutionDependencies(options));
}
//# sourceMappingURL=equipment-acquisition-session-service.js.map