import { cloneData } from "../../shared/cloning.js";
import type { AcquisitionPriceSnapshot } from "../domain/acquisition-types.js";
import { materializedPhysicalItemSize } from "./equipment-size-preparation-service.js";

export const MAX_BROWSE_PHYSICAL_PREPARATION_ENTRIES = 12;

export interface BrowsePhysicalPreparationEntry {
  readonly key: string;
  readonly source: Readonly<Record<string, unknown>>;
}

export interface BrowsePhysicalPreparationInput {
  readonly actor: unknown;
  readonly targetLevel: number;
  readonly targetSize: AcquisitionPriceSnapshot["size"];
  readonly entries: readonly BrowsePhysicalPreparationEntry[];
}

export type BrowsePhysicalPreparationResult =
  | { readonly key: string; readonly prepared: unknown; readonly error: null }
  | { readonly key: string; readonly prepared: null; readonly error: unknown };

export type PrepareBrowsePhysicalItems = (
  input: BrowsePhysicalPreparationInput
) => Promise<readonly BrowsePhysicalPreparationResult[]>;

export function isBrowsePhysicalBatchSafeSource(source: unknown): boolean {
  const system = record(record(source).system);
  const rules = system.rules;
  const subitems = system.subitems;
  const hasNoSubitems =
    subitems === undefined || subitems === null || (Array.isArray(subitems) && subitems.length === 0);
  return Array.isArray(rules) && rules.length === 0 && hasNoSubitems;
}

export async function prepareTransientBrowsePhysicalItems(
  input: BrowsePhysicalPreparationInput
): Promise<readonly BrowsePhysicalPreparationResult[]> {
  assertBrowsePreparationEntries(input.entries);
  if (input.entries.length === 0) return Object.freeze([]);
  const temporary = createTransientBrowseActor(input);
  const temporaryRecord = record(temporary);
  const itemCollection = temporaryRecord.items;
  const deleteItem = record(itemCollection).delete;
  if (typeof deleteItem !== "function") {
    throw new Error("PF2E transient equipment preparation requires an in-memory embedded Item collection.");
  }
  const results: BrowsePhysicalPreparationResult[] = [];
  let mappingFailure: { readonly error: unknown } | null = null;
  try {
    for (const [index, entry] of input.entries.entries()) {
      const prepared = embeddedItemById(temporary, browseItemId(index));
      results.push(
        prepared
          ? { key: entry.key, prepared: { system: cloneData(record(prepared).system) }, error: null }
          : {
              key: entry.key,
              prepared: null,
              error: new Error(`PF2E did not prepare transient browse equipment entry ${entry.key}.`),
            }
      );
    }
  } catch (error) {
    mappingFailure = { error };
  }
  const preparedIds = embeddedItemIds(temporary);
  for (const id of preparedIds) {
    (deleteItem as (id: string) => unknown).call(itemCollection, id);
  }
  if (embeddedItemIds(temporary).length > 0) {
    throw new Error("PF2E transient browse equipment preparation leaked embedded Items.");
  }
  if (mappingFailure) throw mappingFailure.error;
  return Object.freeze(results);
}

function assertBrowsePreparationEntries(entries: readonly BrowsePhysicalPreparationEntry[]): void {
  if (entries.length > MAX_BROWSE_PHYSICAL_PREPARATION_ENTRIES) {
    throw new TypeError(
      `Browse physical preparation accepts at most ${MAX_BROWSE_PHYSICAL_PREPARATION_ENTRIES} visible entries.`
    );
  }
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!entry.key || keys.has(entry.key)) {
      throw new TypeError("Browse physical preparation requires unique non-empty entry keys.");
    }
    if (!isBrowsePhysicalBatchSafeSource(entry.source)) {
      throw new TypeError("Browse physical batch preparation requires ruleless, subitem-free item sources.");
    }
    keys.add(entry.key);
  }
}

function createTransientBrowseActor(input: BrowsePhysicalPreparationInput): unknown {
  const actorToObject = record(input.actor).toObject;
  if (typeof actorToObject !== "function") {
    throw new Error("Equipment pricing requires a PF2E actor preparation context.");
  }
  const actorSource = cloneData((actorToObject as (source?: boolean) => unknown).call(input.actor, true)) as Record<
    string,
    unknown
  >;
  const actorSystem = record(actorSource.system);
  const details = record(actorSystem.details);
  const level = record(details.level);
  level.value = input.targetLevel;
  details.level = level;
  actorSystem.details = details;
  actorSource.system = actorSystem;
  actorSource._id = transientId();
  actorSource.name = `Wayfinder browse-price preparation ${input.targetLevel}`;
  actorSource.items = input.entries.map((entry, index) => {
    const itemSource = cloneData(entry.source) as Record<string, unknown>;
    const itemSystem = record(itemSource.system);
    itemSystem.size = materializedPhysicalItemSize(input.targetSize);
    itemSource.system = itemSystem;
    itemSource._id = browseItemId(index);
    return itemSource;
  });
  const actorClass = record(record(CONFIG).Actor).documentClass;
  if (typeof actorClass !== "function") throw new Error("PF2E actor preparation is unavailable.");
  return new (actorClass as new (source: unknown, context: unknown) => unknown)(actorSource, { temporary: true });
}

function embeddedItemIds(actor: unknown): string[] {
  const contents = record(record(actor).items).contents;
  if (!Array.isArray(contents)) return [];
  return contents.flatMap((item) => {
    const itemRecord = record(item);
    const id = itemRecord.id ?? itemRecord._id;
    return typeof id === "string" && id ? [id] : [];
  });
}

function embeddedItemById(actor: unknown, id: string): unknown | null {
  const items = record(actor).items;
  const get = record(items).get;
  if (typeof get === "function") return (get as (id: string) => unknown).call(items, id) ?? null;
  const contents = record(items).contents;
  if (!Array.isArray(contents)) return null;
  return contents.find((item) => {
    const itemRecord = record(item);
    return itemRecord.id === id || itemRecord._id === id;
  });
}

function browseItemId(index: number): string {
  return `wfbrowse${index.toString(36).padStart(8, "0")}`;
}

function transientId(): string {
  const randomId = record(record(globalThis).foundry).utils;
  const mint = record(randomId).randomID;
  if (typeof mint === "function") return (mint as (length: number) => string)(16);
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
