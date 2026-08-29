import { localizeEquipmentSourceDiagnostic } from "./acquisition-localization.js";
import { EquipmentSourceHealthError } from "./equipment-acquisition-runtime-service.js";
import { StartingEquipmentCommandBlockedError } from "./starting-equipment-command-error.js";
export function localizeStartingEquipmentError(localize, error, fallbackKey) {
    const sourceHealthError = findEquipmentSourceHealthError(error);
    if (sourceHealthError) {
        return sourceHealthError.diagnostics
            .map((diagnostic) => localizeEquipmentSourceDiagnostic(localize, diagnostic))
            .join(" ");
    }
    const commandBlocker = findStartingEquipmentCommandBlocker(error);
    if (commandBlocker)
        return commandBlocker.publicMessage;
    return localize(fallbackKey);
}
export function reportUnexpectedStartingEquipmentError(error, context) {
    if (findEquipmentSourceHealthError(error) || findStartingEquipmentCommandBlocker(error))
        return;
    console.error("PF2E Wayfinder starting-equipment command failed", context, error);
}
function findEquipmentSourceHealthError(error) {
    return findErrorInCauseChain(error, (current) => (current instanceof EquipmentSourceHealthError ? current : null));
}
function findStartingEquipmentCommandBlocker(error) {
    return findErrorInCauseChain(error, (current) => current instanceof StartingEquipmentCommandBlockedError ? current : null);
}
function findErrorInCauseChain(error, match) {
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current)) {
        const matched = match(current);
        if (matched)
            return matched;
        seen.add(current);
        current = current instanceof Error ? current.cause : null;
    }
    return null;
}
//# sourceMappingURL=starting-equipment-failure.js.map