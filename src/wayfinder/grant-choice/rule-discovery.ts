import { OFFICIAL_PACKS } from "../../constants.js";
import { parseCompendiumItemUuid } from "../../shared/compendium.js";
import type { ChoicePredicate, GrantSelectionMeta, SelectionRef, StepFilters } from "../../types.js";
import {
  documentFeatureLevel,
  extractChoiceKey,
  getDocumentRules,
  isChoicePredicate,
  isRecord,
  predicateIncludesString,
  toNonEmptyString,
} from "../rule-data.js";

interface NamedDocumentLike {
  name?: unknown;
}

type GrantChoiceSourceItemType = GrantSelectionMeta["sourceItemType"];

const STATIC_UUID_PACK_ITEM_TYPES = new Map<string, string>([
  ["pf2e.feats-srd", "feat"],
  ["pf2e.classfeatures", "feat"],
  ["pf2e.deities", "deity"],
]);

export function discoverGrantSelectionMeta(args: {
  sourceItemType: GrantChoiceSourceItemType;
  sourceDocument: unknown;
  sourceSelection: SelectionRef;
  extractSlug: (document: unknown) => string | null;
}): GrantSelectionMeta[] {
  const { sourceItemType, sourceDocument, sourceSelection, extractSlug } = args;
  const document = sourceDocument as NamedDocumentLike | null | undefined;
  const sourceName = toNonEmptyString(document?.name) ?? sourceSelection.name;
  const sourceSlug = extractSlug(sourceDocument) ?? sourceSelection.documentId;
  const level = documentFeatureLevel(sourceDocument);
  const rules = getDocumentRules(sourceDocument);

  return rules.flatMap((rule, sourceRuleIndex) => {
    const flag = extractChoiceKey(rule);
    if (rule.key !== "ChoiceSet" || !flag) {
      return [];
    }

    const filters = resolveChoiceFilters(rule);
    if (!filters) {
      return [];
    }

    const grantRuleIndex = rules.findIndex(
      (entry) =>
        entry.key === "GrantItem" && typeof entry.uuid === "string" && entry.uuid.includes(`rulesSelections.${flag}`)
    );
    if (grantRuleIndex === -1) {
      return [];
    }

    const dependsOn = resolveGrantDependency(sourceItemType, grantDependencyPredicates(filters));
    const dependencyKey = dependsOn ?? "none";
    return [
      {
        slotId: `grant-choice-${dependencyKey}-${sourceItemType}-${sourceSlug}-${flag}-level-${level}`,
        sourceItemType,
        selectorPackId: sourceSelection.packId,
        selectorDocumentId: sourceSelection.documentId,
        selectorUuid: sourceSelection.uuid,
        selectorName: sourceName,
        selectorRuleIndex: sourceRuleIndex,
        grantRuleIndex,
        flag,
        itemType: filters.itemType,
        classSlug: null,
        dependsOn,
        filters,
      } satisfies GrantSelectionMeta,
    ];
  });

  function resolveChoiceFilters(rule: Record<string, unknown>): StepFilters | null {
    const choices = isRecord(rule.choices) && !Array.isArray(rule.choices) ? rule.choices : null;
    if (choices) {
      const predicate = Array.isArray(choices.filter)
        ? choices.filter
            .filter(isChoicePredicate)
            .map((entry) => resolveParentGranterLevel(entry, documentFeatureLevel(sourceDocument)))
        : [];
      const rawItemType = toNonEmptyString(choices.itemType) ?? inferItemTypeFromPredicate(predicate) ?? "feat";
      const itemType = rawItemType ? normalizeChoiceItemType(rawItemType) : null;
      if (!itemType || predicate.length === 0) {
        return null;
      }

      const packIds = inferPackIds(itemType, predicate);
      return {
        itemType,
        ...(packIds.length > 0 ? { packIds } : {}),
        predicate,
      };
    }

    return resolveStaticUuidChoiceFilters(rule);
  }
}

function resolveParentGranterLevel(predicate: ChoicePredicate, level: number): ChoicePredicate {
  if (typeof predicate === "string") {
    return predicate;
  }

  if (Array.isArray(predicate)) {
    return predicate.map((entry) => resolveParentGranterLevel(entry, level));
  }

  const result = { ...predicate };
  for (const key of ["lt", "lte", "gt", "gte"] as const) {
    const comparator = result[key];
    if (Array.isArray(comparator) && comparator[1] === "parent:granter:level") {
      result[key] = [comparator[0], level];
    }
  }

  if (Array.isArray(result.or)) {
    result.or = result.or.map((entry) => resolveParentGranterLevel(entry, level));
  }
  if (Array.isArray(result.nor)) {
    result.nor = result.nor.map((entry) => resolveParentGranterLevel(entry, level));
  }
  if (result.not) {
    result.not = resolveParentGranterLevel(result.not, level);
  }

  return result;
}

function resolveStaticUuidChoiceFilters(rule: Record<string, unknown>): StepFilters | null {
  if (!Array.isArray(rule.choices)) {
    return null;
  }

  const choices = rule.choices.filter(isRecord);
  if (choices.length === 0 || choices.length !== rule.choices.length) {
    return null;
  }

  const contextPredicate = normalizePredicateList(rule.predicate);
  if (!contextPredicate) {
    return null;
  }

  const uuidPredicates: Record<string, ChoicePredicate[]> = {};
  const uuids: string[] = [];
  for (const choice of choices) {
    const uuid = toNonEmptyString(choice.value);
    if (!uuid || !parseCompendiumItemUuid(uuid)) {
      return null;
    }

    const predicate = normalizePredicateList(choice.predicate);
    if (!predicate) {
      return null;
    }

    uuids.push(uuid);
    if (predicate.length > 0) {
      uuidPredicates[uuid] = predicate;
    }
  }

  const packIds = Array.from(
    new Set(
      uuids.flatMap((uuid) => {
        const parsed = parseCompendiumItemUuid(uuid);
        return parsed ? [parsed.packId] : [];
      })
    )
  );
  const itemTypes = Array.from(new Set(packIds.flatMap((packId) => STATIC_UUID_PACK_ITEM_TYPES.get(packId) ?? [])));
  if (packIds.length === 0 || itemTypes.length !== 1 || itemTypes[0] === undefined) {
    return null;
  }

  return {
    itemType: itemTypes[0],
    packIds,
    uuids,
    ...(Object.keys(uuidPredicates).length > 0 ? { uuidPredicates } : {}),
    ...(contextPredicate.length > 0 ? { contextPredicate } : {}),
  };
}

function normalizePredicateList(value: unknown): ChoicePredicate[] | null {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    const predicate = value.filter(isChoicePredicate);
    return value.length === predicate.length ? predicate : null;
  }

  return isChoicePredicate(value) ? [value] : null;
}

function grantDependencyPredicates(filters: StepFilters): ChoicePredicate[] {
  return [
    ...(filters.predicate ?? []),
    ...(filters.contextPredicate ?? []),
    ...Object.values(filters.uuidPredicates ?? {}).flat(),
  ];
}

function inferItemTypeFromPredicate(predicate: ChoicePredicate[]): string | null {
  for (const entry of predicate) {
    const inferred = inferItemTypeFromPredicateEntry(entry);
    if (inferred) {
      return inferred;
    }
  }

  return null;
}

function inferItemTypeFromPredicateEntry(predicate: ChoicePredicate): string | null {
  if (typeof predicate === "string") {
    const match = /^item:type:([^:]+)$/.exec(predicate);
    return match?.[1] ?? null;
  }

  if (Array.isArray(predicate)) {
    return inferItemTypeFromPredicate(predicate);
  }

  if (!isRecord(predicate)) {
    return null;
  }

  const branches = [predicate.or, predicate.nor].filter(Array.isArray).flat();
  if (predicate.not) {
    branches.push(predicate.not);
  }

  return inferItemTypeFromPredicate(branches);
}

function normalizeChoiceItemType(itemType: string): string {
  return itemType === "feature" ? "feat" : itemType;
}

function inferPackIds(itemType: string, predicate: ChoicePredicate[]): string[] {
  if (itemType === "feat" && predicateIncludesString(predicate, "item:type:feature")) {
    return [...OFFICIAL_PACKS.classFeature];
  }

  if (itemType === "feat" && predicateIncludesPrefix(predicate, "item:tag:")) {
    return [...OFFICIAL_PACKS.classFeature, ...OFFICIAL_PACKS.feat];
  }

  return [];
}

function predicateIncludesPrefix(predicate: ChoicePredicate[], prefix: string): boolean {
  return predicate.some((entry) => predicateEntryIncludesPrefix(entry, prefix));
}

function predicateEntryIncludesPrefix(predicate: ChoicePredicate, prefix: string): boolean {
  if (typeof predicate === "string") {
    return predicate.startsWith(prefix);
  }

  if (Array.isArray(predicate)) {
    return predicateIncludesPrefix(predicate, prefix);
  }

  if (!isRecord(predicate)) {
    return false;
  }

  return (
    [predicate.or, predicate.nor]
      .filter(Array.isArray)
      .flat()
      .some((entry) => predicateEntryIncludesPrefix(entry, prefix)) ||
    (predicate.not ? predicateEntryIncludesPrefix(predicate.not, prefix) : false)
  );
}

function resolveGrantDependency(
  sourceItemType: GrantChoiceSourceItemType,
  predicate: ChoicePredicate[]
): GrantSelectionMeta["dependsOn"] {
  if (sourceItemType === "classfeature") {
    return "class";
  }

  if (
    predicateIncludesString(predicate, "{actor|system.details.class.trait}") ||
    predicateIncludesString(predicate, "item:trait:multiclass")
  ) {
    return "class";
  }

  if (predicateIncludesString(predicate, "deity:primary:")) {
    return "deity";
  }

  return null;
}
