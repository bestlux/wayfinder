export async function resolveStartingEquipmentRenderPlan(args) {
    return args.equipmentOnlyUpdate && args.cachedPlan?.targetLevel === args.targetLevel
        ? args.cachedPlan
        : args.buildPlan();
}
const UNAVAILABLE_ADAPTER = {
    async project(request) {
        return {
            state: "pending",
            message: "The approved Common-equipment catalogue is not loaded yet.",
            query: request.query,
            records: [],
            filters: [],
            activeFilters: request.filters,
            previewSourceUuid: request.previewSourceUuid,
        };
    },
    async prepareLine() {
        throw new Error("The approved Common-equipment catalogue is not loaded yet.");
    },
};
let registeredAdapter = UNAVAILABLE_ADAPTER;
export function registerStartingEquipmentUiAdapter(adapter) {
    registeredAdapter = adapter;
}
export function getStartingEquipmentUiAdapter() {
    return registeredAdapter;
}
//# sourceMappingURL=starting-equipment-ui-adapter.js.map