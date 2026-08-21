import type { EmbeddedItemSource } from "../../shared/actor-model.js";
import { cloneData } from "../../shared/cloning.js";
import {
  type AcquisitionEquipmentSize,
  type AcquisitionKitExpansionSnapshotV1,
  ADVENTURERS_PACK_SOURCE_UUID,
} from "../domain/acquisition-types.js";
import { fingerprintEquipmentDocument } from "./equipment-catalogue-service.js";

export const ADVENTURERS_PACK_UUID = ADVENTURERS_PACK_SOURCE_UUID;

const PROFILE = Object.freeze([
  item("mca3x", null, "Compendium.pf2e.equipment-srd.Item.3lgwjrFEsQVKzhh7", 1),
  item("mca3x/02xhi", "mca3x", "Compendium.pf2e.equipment-srd.Item.fyYnQf1NAx9fWFaS", 1),
  item("mca3x/30xet", "mca3x", "Compendium.pf2e.equipment-srd.Item.VnPh324pKwd2ZB66", 1),
  item("mca3x/afbn4", "mca3x", "Compendium.pf2e.equipment-srd.Item.xShIDyydOMkGvGNb", 10),
  item("mca3x/fabyb", "mca3x", "Compendium.pf2e.equipment-srd.Item.UlIxxLm71UdRgCFE", 1),
  item("mca3x/jtagt", "mca3x", "Compendium.pf2e.equipment-srd.Item.L9ZV076913otGtiB", 2),
  item("mca3x/lems2", "mca3x", "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS", 5),
  item("mca3x/lpl11", "mca3x", "Compendium.pf2e.equipment-srd.Item.fagzYdmfYyMQ6J77", 1),
  item("mca3x/z9tim", "mca3x", "Compendium.pf2e.equipment-srd.Item.81aHsD27HFGnq1Nt", 1),
]);

interface ProfileItem {
  readonly expansionPath: string;
  readonly parentPath: string | null;
  readonly sourceUuid: string;
  readonly quantity: number;
}

export interface PreparedPf2eKitExpansion {
  readonly snapshot: AcquisitionKitExpansionSnapshotV1;
  readonly sources: ReadonlyMap<string, EmbeddedItemSource>;
}

export async function prepareAdventurersPackExpansion(args: {
  readonly sourceUuid: string;
  readonly kitDocument: unknown;
  readonly targetSize: AcquisitionEquipmentSize;
  readonly fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>;
}): Promise<PreparedPf2eKitExpansion> {
  if (args.sourceUuid !== ADVENTURERS_PACK_UUID) {
    throw new TypeError("Only the exact PF2E Adventurer's Pack profile can be expanded automatically.");
  }
  const kit = record(args.kitDocument);
  if (record(kit.system).slug !== "adventurers-pack" || kit.type !== "kit") {
    throw new Error("The Adventurer's Pack document no longer matches its qualified PF2E profile.");
  }
  assertStableKitPaths(record(kit.system).items);
  const createGrantedItems = kit.createGrantedItems;
  if (typeof createGrantedItems !== "function") {
    throw new Error("PF2E kit expansion is unavailable for Adventurer's Pack.");
  }
  const pf2eSize = materializedSize(args.targetSize);
  const granted = await Reflect.apply(createGrantedItems, args.kitDocument as object, [{ size: pf2eSize }]);
  if (!Array.isArray(granted)) throw new Error("PF2E returned malformed Adventurer's Pack granted items.");
  const grantedFacts = granted.map(grantedItemFacts);
  assertGrantedProfile(grantedFacts, pf2eSize);

  const sources = new Map<string, EmbeddedItemSource>();
  const items: AcquisitionKitExpansionSnapshotV1["items"][number][] = [];
  for (const profile of PROFILE) {
    const document = await args.fetchDocumentByUuid(profile.sourceUuid);
    const source = documentSource(document);
    if (!source || sourceUuidOf(source) !== profile.sourceUuid) {
      throw new Error(`Adventurer's Pack child source ${profile.sourceUuid} is unavailable or drifted.`);
    }
    const itemType = physicalType(source.type);
    const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : null;
    if (!itemType || !name) throw new Error(`Adventurer's Pack child ${profile.sourceUuid} is not a physical item.`);
    sources.set(profile.expansionPath, cloneData(source) as EmbeddedItemSource);
    items.push({
      ...profile,
      documentFingerprint: fingerprintEquipmentDocument(source),
      name,
      itemType,
      size: normalizedSize(pf2eSize),
    });
  }
  return {
    snapshot: Object.freeze({
      version: 1,
      profile: "adventurers-pack-v1",
      requestedQuantity: 1,
      items: Object.freeze(items.map((entry) => Object.freeze(entry))),
    }),
    sources,
  };
}

export function isQualifiedKitSource(sourceUuid: string): boolean {
  return sourceUuid === ADVENTURERS_PACK_UUID;
}

function item(expansionPath: string, parentPath: string | null, sourceUuid: string, quantity: number): ProfileItem {
  return Object.freeze({ expansionPath, parentPath, sourceUuid, quantity });
}

function assertStableKitPaths(rawItems: unknown): void {
  const root = record(rawItems);
  const paths: string[] = [];
  const visit = (value: unknown, prefix: string): void => {
    for (const [key, child] of Object.entries(record(value))) {
      const path = prefix ? `${prefix}/${key}` : key;
      paths.push(path);
      const nested = record(child).items;
      if (nested !== undefined) visit(nested, path);
    }
  };
  visit(root, "");
  const expected = PROFILE.map((entry) => entry.expansionPath);
  if (canonicalJson(paths.sort()) !== canonicalJson([...expected].sort())) {
    throw new Error("Adventurer's Pack stable item paths changed in PF2E.");
  }
}

function grantedItemFacts(value: unknown) {
  const item = record(value);
  const source = documentSource(value) ?? item;
  const system = record(item.system);
  return {
    sourceUuid: sourceUuidOf(source),
    quantity: positiveInteger(system.quantity ?? record(source.system).quantity),
    size: system.size ?? record(source.system).size,
  };
}

function assertGrantedProfile(
  granted: readonly ReturnType<typeof grantedItemFacts>[],
  expectedSize: ReturnType<typeof materializedSize>
): void {
  if (granted.length !== PROFILE.length) throw new Error("PF2E Adventurer's Pack expansion cardinality changed.");
  const byUuid = new Map(granted.map((entry) => [entry.sourceUuid, entry]));
  if (byUuid.size !== PROFILE.length) throw new Error("PF2E Adventurer's Pack expansion contains duplicate sources.");
  for (const profile of PROFILE) {
    const actual = byUuid.get(profile.sourceUuid);
    if (!actual || actual.quantity !== profile.quantity || actual.size !== expectedSize) {
      throw new Error(`PF2E Adventurer's Pack child ${profile.sourceUuid} changed.`);
    }
  }
}

function materializedSize(size: AcquisitionEquipmentSize): "tiny" | "med" | "lg" | "huge" | "grg" {
  return size === "tiny"
    ? "tiny"
    : size === "small" || size === "medium"
      ? "med"
      : size === "large"
        ? "lg"
        : size === "huge"
          ? "huge"
          : "grg";
}

function normalizedSize(size: ReturnType<typeof materializedSize>) {
  return size === "med" ? "medium" : size === "lg" ? "large" : size === "grg" ? "gargantuan" : size;
}

function documentSource(document: unknown): Readonly<Record<string, unknown>> | null {
  const value = record(document);
  const toObject = value.toObject;
  const source = typeof toObject === "function" ? Reflect.apply(toObject, document as object, [true]) : document;
  return isRecord(source) ? (cloneData(source) as Readonly<Record<string, unknown>>) : null;
}

function sourceUuidOf(source: Readonly<Record<string, unknown>>): string | null {
  const stats = record(source._stats).compendiumSource;
  const core = record(record(source.flags).core).sourceId;
  const value = typeof stats === "string" && stats ? stats : typeof core === "string" && core ? core : null;
  return value;
}

function physicalType(value: unknown): AcquisitionKitExpansionSnapshotV1["items"][number]["itemType"] | null {
  return value === "ammo" || value === "backpack" || value === "consumable" || value === "equipment" ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Kit material contains an unsupported value.");
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
