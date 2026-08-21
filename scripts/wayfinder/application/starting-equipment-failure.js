import { localizeEquipmentSourceDiagnostic } from "./acquisition-localization.js";
import { EquipmentSourceHealthError } from "./equipment-acquisition-runtime-service.js";
export function localizeStartingEquipmentError(localize, error, fallbackKey) {
    const sourceHealthError = findEquipmentSourceHealthError(error);
    if (sourceHealthError) {
        return sourceHealthError.diagnostics
            .map((diagnostic) => localizeEquipmentSourceDiagnostic(localize, diagnostic))
            .join(" ");
    }
    return localize(fallbackKey);
}
function findEquipmentSourceHealthError(error) {
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current)) {
        if (current instanceof EquipmentSourceHealthError)
            return current;
        seen.add(current);
        current = current instanceof Error ? current.cause : null;
    }
    return null;
}
//# sourceMappingURL=starting-equipment-failure.js.map