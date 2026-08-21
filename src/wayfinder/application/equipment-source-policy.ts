export const CORE_EQUIPMENT_PACK_ID = "pf2e.equipment-srd";
const EQUIPMENT_TAB_ITEM_TYPES = new Set([
  "ammo",
  "armor",
  "backpack",
  "consumable",
  "equipment",
  "shield",
  "weapon",
  "kit",
  "treasure",
]);

export type EquipmentSourceDiagnosticCode =
  | "equipment-pack-missing"
  | "equipment-pack-not-item"
  | "equipment-pack-index-failed"
  | "equipment-pack-index-corrupt"
  | "equipment-source-identity-corrupt"
  | "duplicate-equipment-source-identity";

export interface EquipmentSourceDiagnostic {
  readonly code: EquipmentSourceDiagnosticCode;
  readonly packId: string;
  readonly sourceIdentity: string | null;
  readonly message: string;
}

export interface InstalledEquipmentPackDescriptor {
  readonly id: string;
  readonly family: string;
  readonly label: string;
  readonly packageName: string;
  readonly documentName: string | null;
  readonly equipmentTab: boolean;
}

export interface NormalizedPf2eEquipmentSources {
  readonly effectivePackIds: readonly string[];
  readonly enabledSourceSlugs: readonly string[];
  readonly knownSourceSlugs: readonly string[];
  readonly showEmptySources: boolean;
  readonly showUnknownSources: boolean;
  readonly diagnostics: readonly EquipmentSourceDiagnostic[];
}

/**
 * Mirrors PF2E's equipment-tab classification from each installed pack's cached
 * index types. The raw world setting is deliberately not a discovery source:
 * stale or malformed setting keys must not turn an adjacent feat/spell pack into
 * equipment.
 */
export function discoverInstalledEquipmentPackDescriptors(input: {
  readonly packs: unknown;
}): InstalledEquipmentPackDescriptor[] {
  const descriptors: InstalledEquipmentPackDescriptor[] = [];
  for (const value of collectionValues(input.packs)) {
    const pack = record(value);
    const metadata = record(pack.metadata);
    const id = nonEmpty(pack.collection) ? pack.collection.trim() : nonEmpty(metadata.id) ? metadata.id.trim() : "";
    if (!id) continue;
    const family = packFamily(id);
    const documentName = firstNonEmpty(pack.documentName, metadata.type) || null;
    const indexedTypes = new Set(
      collectionValues(pack.index)
        .map((entry) => record(entry).type)
        .filter(nonEmpty)
    );
    descriptors.push({
      id,
      family,
      label: firstNonEmpty(metadata.label, id),
      packageName: firstNonEmpty(metadata.packageName, family),
      documentName,
      equipmentTab:
        id === CORE_EQUIPMENT_PACK_ID ||
        (documentName === "Item" && [...indexedTypes].some((type) => EQUIPMENT_TAB_ITEM_TYPES.has(type))),
    });
  }
  return descriptors.sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizePf2eEquipmentSources(input: {
  readonly installedEquipmentPacks: readonly InstalledEquipmentPackDescriptor[];
  readonly allowedPackFamilies: readonly string[];
  readonly compendiumBrowserPacks: unknown;
  readonly compendiumBrowserSources: unknown;
}): NormalizedPf2eEquipmentSources {
  const packRoot = record(input.compendiumBrowserPacks);
  const rawEquipment = record(packRoot.equipment);
  const families = new Set(input.allowedPackFamilies.map(packFamily).filter(nonEmpty));
  const diagnostics: EquipmentSourceDiagnostic[] = [];
  const effectivePackIds: string[] = [];
  const descriptors = new Map<string, InstalledEquipmentPackDescriptor>();

  for (const descriptor of [...input.installedEquipmentPacks].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!nonEmpty(descriptor.id) || descriptors.has(descriptor.id)) continue;
    descriptors.set(descriptor.id, descriptor);
    if (!families.has(packFamily(descriptor.id))) continue;
    if (record(rawEquipment[descriptor.id]).load === false) continue;
    if (descriptor.documentName !== null && descriptor.documentName !== "Item") {
      if (Object.hasOwn(rawEquipment, descriptor.id)) {
        diagnostics.push(
          sourceDiagnostic(
            "equipment-pack-not-item",
            descriptor.id,
            null,
            `Equipment pack ${descriptor.id} is not an Item compendium and was excluded.`
          )
        );
      }
      continue;
    }
    if (!descriptor.equipmentTab) continue;
    effectivePackIds.push(descriptor.id);
  }

  // Raw equipment entries can outlive an uninstalled package. Report enabled,
  // allowed stale entries, but never treat entries from another PF2E tab as equipment.
  for (const packId of Object.keys(rawEquipment).sort((left, right) => left.localeCompare(right))) {
    if (!nonEmpty(packId) || descriptors.has(packId) || !families.has(packFamily(packId))) continue;
    if (record(rawEquipment[packId]).load === false) continue;
    diagnostics.push(
      sourceDiagnostic(
        "equipment-pack-missing",
        packId,
        null,
        `Enabled equipment pack ${packId} is not installed or is unavailable to the current user.`
      )
    );
  }

  const sourceRoot = record(input.compendiumBrowserSources);
  const sources = record(sourceRoot.sources);
  const knownSourceSlugs = Object.keys(sources).sort((left, right) => left.localeCompare(right));
  const enabledSourceSlugs = Object.entries(sources)
    .filter(([, value]) => record(value).load === true)
    .map(([slug]) => slug)
    .sort((left, right) => left.localeCompare(right));
  return {
    effectivePackIds: uniqueSorted(effectivePackIds),
    enabledSourceSlugs,
    knownSourceSlugs,
    showEmptySources: sourceRoot.showEmptySources === true,
    showUnknownSources: sourceRoot.showUnknownSources === true,
    diagnostics: sortEquipmentSourceDiagnostics(diagnostics),
  };
}

export function sourceDiagnostic(
  code: EquipmentSourceDiagnosticCode,
  packId: string,
  sourceIdentity: string | null,
  message: string
): EquipmentSourceDiagnostic {
  return Object.freeze({ code, packId, sourceIdentity, message });
}

export function sortEquipmentSourceDiagnostics(
  diagnostics: readonly EquipmentSourceDiagnostic[]
): EquipmentSourceDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      left.packId.localeCompare(right.packId) ||
      (left.sourceIdentity ?? "").localeCompare(right.sourceIdentity ?? "") ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message)
  );
}

function collectionValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const values = record(value).values;
  if (typeof values !== "function") return [];
  try {
    return [...(values as () => Iterable<unknown>).call(value)];
  } catch {
    return [];
  }
}

function packFamily(value: string): string {
  return (value.split(".")[0] ?? value).trim().toLowerCase();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function firstNonEmpty(...values: unknown[]): string {
  return values.find(nonEmpty)?.trim() ?? "";
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
