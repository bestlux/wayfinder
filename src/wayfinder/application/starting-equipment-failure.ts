import type { AcquisitionLocalize } from "./acquisition-localization.js";
import { localizeEquipmentSourceDiagnostic } from "./acquisition-localization.js";
import { EquipmentSourceHealthError } from "./equipment-acquisition-runtime-service.js";

export function localizeStartingEquipmentError(
  localize: AcquisitionLocalize,
  error: unknown,
  fallbackKey: string
): string {
  const sourceHealthError = findEquipmentSourceHealthError(error);
  if (sourceHealthError) {
    return sourceHealthError.diagnostics
      .map((diagnostic) => localizeEquipmentSourceDiagnostic(localize, diagnostic))
      .join(" ");
  }
  return localize(fallbackKey);
}

function findEquipmentSourceHealthError(error: unknown): EquipmentSourceHealthError | null {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    if (current instanceof EquipmentSourceHealthError) return current;
    seen.add(current);
    current = current instanceof Error ? current.cause : null;
  }
  return null;
}
