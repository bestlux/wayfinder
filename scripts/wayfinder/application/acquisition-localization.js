export function localizeAcquisitionMessage(localize, message) {
    return localize(message.key, message.values);
}
export function localizeEquipmentSourceDiagnostic(localize, diagnostic) {
    const values = {
        packId: diagnostic.packId,
        sourceIdentity: diagnostic.sourceIdentity ?? "—",
    };
    switch (diagnostic.code) {
        case "equipment-pack-missing":
            return localize("wayfinder-pf2e.StartingEquipment.Diagnostics.PackMissing", values);
        case "equipment-pack-not-item":
            return localize("wayfinder-pf2e.StartingEquipment.Diagnostics.PackNotItem", values);
        case "equipment-pack-index-failed":
            return localize("wayfinder-pf2e.StartingEquipment.Diagnostics.PackIndexFailed", values);
        case "equipment-pack-index-corrupt":
            return localize("wayfinder-pf2e.StartingEquipment.Diagnostics.PackIndexCorrupt", values);
        case "equipment-source-identity-corrupt":
            return localize("wayfinder-pf2e.StartingEquipment.Diagnostics.SourceIdentityCorrupt", values);
        case "duplicate-equipment-source-identity":
            return localize("wayfinder-pf2e.StartingEquipment.Diagnostics.DuplicateSourceIdentity", values);
    }
}
//# sourceMappingURL=acquisition-localization.js.map