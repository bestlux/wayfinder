/**
 * Owns the ordering/materialization invariant for a lazy equipment catalogue.
 * Callers may inspect the complete order without paying to project any records.
 */
export function createEquipmentCatalogueRecordSource(sourceUuids, materializeRecordAt) {
    const orderedSourceUuids = Object.freeze([...sourceUuids]);
    if (new Set(orderedSourceUuids).size !== orderedSourceUuids.length) {
        throw new TypeError("Starting-equipment catalogue source identities must be unique.");
    }
    return Object.freeze({
        sourceUuids: orderedSourceUuids,
        recordAt(index) {
            if (!Number.isSafeInteger(index) || index < 0 || index >= orderedSourceUuids.length) {
                throw new RangeError(`Starting-equipment catalogue record index ${index} is outside the source.`);
            }
            const record = materializeRecordAt(index);
            if (record.sourceUuid !== orderedSourceUuids[index]) {
                throw new Error("Starting-equipment catalogue record drifted from its ordered source identity.");
            }
            return record;
        },
    });
}
export function equipmentCatalogueRecordSourceFromRecords(records) {
    return createEquipmentCatalogueRecordSource(records.map((record) => record.sourceUuid), (index) => records[index]);
}
export const EMPTY_EQUIPMENT_CATALOGUE_RECORD_SOURCE = equipmentCatalogueRecordSourceFromRecords([]);
//# sourceMappingURL=equipment-catalogue-record-source.js.map