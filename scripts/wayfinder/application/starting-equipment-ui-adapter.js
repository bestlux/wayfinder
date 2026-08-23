import { EMPTY_EQUIPMENT_CATALOGUE_RECORD_SOURCE } from "./equipment-catalogue-record-source.js";
export async function resolveStartingEquipmentRenderPlan(args) {
    return args.equipmentOnlyUpdate && args.cachedPlan?.targetLevel === args.targetLevel
        ? args.cachedPlan
        : args.buildPlan();
}
const UNAVAILABLE_ADAPTER = {
    async project(request) {
        return {
            state: "pending",
            message: "The gear list is not loaded yet.",
            query: request.query,
            offset: 0,
            limit: request.limit,
            matchedRecordCount: 0,
            recordSource: EMPTY_EQUIPMENT_CATALOGUE_RECORD_SOURCE,
            filters: [],
            activeFilters: request.filters,
            previewSourceUuid: request.previewSourceUuid,
            titanMauler: { required: false, selectedSourceUuid: null },
        };
    },
    async prepareLine() {
        throw new Error("The approved Common-equipment catalogue is not loaded yet.");
    },
    async prepareTitanMaulerLine() {
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