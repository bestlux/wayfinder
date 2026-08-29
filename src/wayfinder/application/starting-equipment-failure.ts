import type { AcquisitionLocalize } from "./acquisition-localization.js";
import { localizeEquipmentSourceDiagnostic } from "./acquisition-localization.js";
import { EquipmentSourceHealthError } from "./equipment-acquisition-runtime-service.js";
import { StartingEquipmentCommandBlockedError } from "./starting-equipment-command-error.js";

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
  const commandBlocker = findStartingEquipmentCommandBlocker(error);
  if (commandBlocker) return commandBlocker.publicMessage;
  return localize(fallbackKey);
}

export function reportUnexpectedStartingEquipmentError(
  error: unknown,
  context: { readonly operation: string; readonly stepId: string }
): void {
  if (findEquipmentSourceHealthError(error) || findStartingEquipmentCommandBlocker(error)) return;
  console.error("PF2E Wayfinder starting-equipment command failed", context, error);
}

function findEquipmentSourceHealthError(error: unknown): EquipmentSourceHealthError | null {
  return findErrorInCauseChain(error, (current) => (current instanceof EquipmentSourceHealthError ? current : null));
}

function findStartingEquipmentCommandBlocker(error: unknown): StartingEquipmentCommandBlockedError | null {
  return findErrorInCauseChain(error, (current) =>
    current instanceof StartingEquipmentCommandBlockedError ? current : null
  );
}

function findErrorInCauseChain<T>(error: unknown, match: (current: unknown) => T | null): T | null {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    const matched = match(current);
    if (matched) return matched;
    seen.add(current);
    current = current instanceof Error ? current.cause : null;
  }
  return null;
}
