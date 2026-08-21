import { cloneData } from "../../shared/cloning.js";
import { materializeStructuredCreatureSizeChoice } from "../../shared/structured-creature-size-choice.js";
import type { DraftState } from "../../types.js";
import type { AcquisitionPriceSnapshot } from "../domain/acquisition-types.js";

export interface PrepareDraftedEquipmentActorInput {
  readonly actor: unknown;
  readonly draft: DraftState;
  readonly targetLevel: number;
  readonly fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>;
}

export type PrepareDraftedEquipmentActor = (input: PrepareDraftedEquipmentActorInput) => Promise<unknown>;

export function materializedPhysicalItemSize(
  size: AcquisitionPriceSnapshot["size"]
): "tiny" | "med" | "lg" | "huge" | "grg" {
  const sizes = {
    tiny: "tiny",
    small: "med",
    medium: "med",
    large: "lg",
    huge: "huge",
    gargantuan: "grg",
  } as const;
  return sizes[size];
}

export async function resolvePreparedDraftedEquipmentSize(
  input: PrepareDraftedEquipmentActorInput & { readonly prepareDraftedActor: PrepareDraftedEquipmentActor }
): Promise<AcquisitionPriceSnapshot["size"]> {
  const draftedSelections = Object.values(input.draft.selections).filter(
    (selection) => selection.itemType === "ancestry" || selection.itemType === "heritage"
  );
  const draftedAncestries = draftedSelections.filter((selection) => selection.itemType === "ancestry");
  const draftedHeritages = draftedSelections.filter((selection) => selection.itemType === "heritage");
  if (draftedAncestries.length === 0 && draftedHeritages.length === 0) {
    const actorItems = embeddedActorItems(input.actor);
    const actorAncestries = actorItems.filter((item) => record(item).type === "ancestry");
    const actorHeritages = actorItems.filter((item) => record(item).type === "heritage");
    if (actorAncestries.length !== 1 || actorHeritages.length > 1) {
      throw new TypeError(
        "Equipment requires exactly one effective ancestry and at most one effective heritage for authoritative size."
      );
    }
    return requirePreparedEquipmentSize(input.actor);
  }
  if (draftedAncestries.length !== 1 || draftedHeritages.length > 1) {
    throw new TypeError(
      "Equipment size preparation cannot mix missing or ambiguous drafted ancestry and heritage selections."
    );
  }
  const preparedActor = await input.prepareDraftedActor(input);
  return requirePreparedEquipmentSize(preparedActor);
}

function requirePreparedEquipmentSize(preparedActor: unknown): AcquisitionPriceSnapshot["size"] {
  const system = record(record(preparedActor).system);
  const traits = record(system.traits);
  const rawNaturalSize = traits.naturalSize;
  const rawActorSize = record(traits.size).value;
  const rawEquipmentSize = rawNaturalSize ?? rawActorSize;
  const size = equipmentSize(record(rawEquipmentSize).value ?? rawEquipmentSize);
  if (!size) throw new TypeError("Equipment requires a selected ancestry with a supported authoritative size.");
  return size;
}

export async function prepareTransientDraftedEquipmentActor(
  input: PrepareDraftedEquipmentActorInput
): Promise<unknown> {
  const selections = Object.values(input.draft.selections).filter(
    (selection) => selection.itemType === "ancestry" || selection.itemType === "heritage"
  );
  const ancestrySelections = selections.filter((selection) => selection.itemType === "ancestry");
  const heritageSelections = selections.filter((selection) => selection.itemType === "heritage");
  if (ancestrySelections.length !== 1 || heritageSelections.length > 1) {
    throw new TypeError("Equipment size preparation requires one drafted ancestry and at most one heritage.");
  }
  const itemSources: Record<string, unknown>[] = [];
  for (const selection of selections) {
    if (selection.itemType !== "ancestry" && selection.itemType !== "heritage") continue;
    const document = await input.fetchDocumentByUuid(selection.uuid);
    const source = documentSource(document);
    if (!source || record(source).type !== selection.itemType) {
      throw new TypeError(`The drafted ${selection.itemType} document cannot prepare authoritative actor size.`);
    }
    const stamped = cloneData(source) as Record<string, unknown>;
    applyDraftedSingletonChoices(stamped, selection.itemType, input.draft.singletonChoices);
    stamped._id = transientId();
    itemSources.push(stamped);
  }
  const actorToObject = record(input.actor).toObject;
  if (typeof actorToObject !== "function") {
    throw new TypeError("Equipment size preparation requires a PF2E actor document.");
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
  actorSource.name = `Wayfinder drafted-size preparation ${input.targetLevel}`;
  actorSource.items = itemSources;
  const actorClass = record(record(CONFIG).Actor).documentClass;
  if (typeof actorClass !== "function") throw new Error("PF2E actor preparation is unavailable.");
  return new (actorClass as new (source: unknown, context: unknown) => unknown)(actorSource, { temporary: true });
}

function applyDraftedSingletonChoices(
  source: Record<string, unknown>,
  itemType: "ancestry" | "heritage",
  choices: Readonly<Record<string, string>>
): void {
  const system = record(source.system);
  const slug = typeof system.slug === "string" && system.slug ? system.slug : null;
  const rules = Array.isArray(system.rules) ? system.rules : [];
  if (!slug) return;
  const prefix = `singleton-choice-${itemType}-${slug}-`;
  for (const [slotId, value] of Object.entries(choices)) {
    if (!slotId.startsWith(prefix) || !value) continue;
    const match = /^(.+)-level-\d+$/u.exec(slotId.slice(prefix.length));
    const flag = match?.[1];
    if (!flag) continue;
    const sourceRuleIndex = rules.findIndex(
      (candidate) => record(candidate).key === "ChoiceSet" && record(candidate).flag === flag
    );
    const rule = rules[sourceRuleIndex];
    if (!rule) throw new TypeError(`The drafted ${itemType} size choice ${flag} no longer exists.`);
    const installedValue = materializeStructuredCreatureSizeChoice({
      sourceItemType: itemType,
      rules,
      sourceRuleIndex,
      selectedValue: value,
    });
    record(rule).selection = installedValue;
    const flags = record(source.flags);
    const pf2e = record(flags.pf2e);
    const rulesSelections = record(pf2e.rulesSelections);
    rulesSelections[flag] = installedValue;
    pf2e.rulesSelections = rulesSelections;
    flags.pf2e = pf2e;
    source.flags = flags;
  }
}

function documentSource(document: unknown): Readonly<Record<string, unknown>> | null {
  const toObject = record(document).toObject;
  if (typeof toObject !== "function") return null;
  const source = (toObject as (source?: boolean) => unknown).call(document, true);
  return source && typeof source === "object" ? (cloneData(source) as Readonly<Record<string, unknown>>) : null;
}

function embeddedActorItems(actor: unknown): readonly unknown[] {
  const items = record(actor).items;
  if (Array.isArray(items)) return items;
  const contents = record(items).contents;
  if (Array.isArray(contents)) return contents;
  const values = record(items).values;
  if (typeof values === "function") return [...(values as () => Iterable<unknown>).call(items)];
  return [];
}

function equipmentSize(rawSize: unknown): AcquisitionPriceSnapshot["size"] | null {
  if (typeof rawSize !== "string") return null;
  const sizes: Readonly<Record<string, AcquisitionPriceSnapshot["size"]>> = {
    tiny: "tiny",
    sm: "small",
    small: "small",
    med: "medium",
    medium: "medium",
    lg: "large",
    large: "large",
    huge: "huge",
    grg: "gargantuan",
    gargantuan: "gargantuan",
  };
  return sizes[rawSize.trim().toLowerCase()] ?? null;
}

function transientId(): string {
  const randomId = record(record(globalThis).foundry).utils;
  const mint = record(randomId).randomID;
  if (typeof mint === "function") return (mint as (length: number) => string)(16);
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
