import { OFFICIAL_PACKS } from "../constants.js";
import { parseCompendiumItemUuid } from "../shared/compendium.js";
import type { ChoicePredicate, StepFilters } from "../types.js";
import { isChoicePredicate, isRecord, predicateIncludesString, toNonEmptyString } from "./rule-data.js";

export type ActorChoiceFilterDependency = "ancestry" | "class";

export interface ChoiceFilterActorContext {
  ancestrySlug?: string | null;
  classSlug?: string | null;
}

export interface ChoiceSetFilterResolution {
  filters: StepFilters;
  actorDependencies: ActorChoiceFilterDependency[];
}

interface ResolveChoiceSetFiltersOptions {
  sourceLevel: number;
  actorContext?: ChoiceFilterActorContext | null;
  requireResolvedActorPlaceholders?: boolean;
}

const STATIC_UUID_PACK_ITEM_TYPES = new Map<string, string>([
  ...OFFICIAL_PACKS.ancestry.map((packId) => [packId, "ancestry"] as const),
  ...OFFICIAL_PACKS.background.map((packId) => [packId, "background"] as const),
  ...OFFICIAL_PACKS.class.map((packId) => [packId, "class"] as const),
  ...OFFICIAL_PACKS.classFeature.map((packId) => [packId, "feat"] as const),
  ...OFFICIAL_PACKS.deity.map((packId) => [packId, "deity"] as const),
  ...OFFICIAL_PACKS.feat.map((packId) => [packId, "feat"] as const),
  ...OFFICIAL_PACKS.heritage.map((packId) => [packId, "heritage"] as const),
  ...OFFICIAL_PACKS.spell.map((packId) => [packId, "spell"] as const),
]);

const OFFICIAL_PACKS_BY_ITEM_TYPE: Record<string, readonly string[]> = {
  ancestry: OFFICIAL_PACKS.ancestry,
  background: OFFICIAL_PACKS.background,
  class: OFFICIAL_PACKS.class,
  classfeature: OFFICIAL_PACKS.classFeature,
  deity: OFFICIAL_PACKS.deity,
  feat: OFFICIAL_PACKS.feat,
  heritage: OFFICIAL_PACKS.heritage,
  spell: OFFICIAL_PACKS.spell,
};

export function resolveChoiceSetFilters(
  rule: Record<string, unknown>,
  options: ResolveChoiceSetFiltersOptions
): ChoiceSetFilterResolution | null {
  const choices = isRecord(rule.choices) && !Array.isArray(rule.choices) ? rule.choices : null;
  if (choices) {
    const rawPredicate = Array.isArray(choices.filter)
      ? choices.filter.filter(isChoicePredicate).map((entry) => resolveParentGranterLevel(entry, options.sourceLevel))
      : [];
    const resolvedPredicate = resolveActorInjectedPredicate(rawPredicate, options);
    if (!resolvedPredicate) {
      return null;
    }

    const rawItemType =
      toNonEmptyString(choices.itemType) ?? inferItemTypeFromPredicate(resolvedPredicate.predicate) ?? "feat";
    const itemType = rawItemType ? normalizeChoiceItemType(rawItemType) : null;
    if (!itemType || resolvedPredicate.predicate.length === 0) {
      return null;
    }

    const packIds = inferPackIds(itemType, resolvedPredicate.predicate);
    return {
      filters: {
        itemType,
        ...(packIds.length > 0 ? { packIds } : {}),
        predicate: resolvedPredicate.predicate,
      },
      actorDependencies: resolvedPredicate.actorDependencies,
    };
  }

  return resolveStaticUuidChoiceFilters(rule, options);
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

function resolveStaticUuidChoiceFilters(
  rule: Record<string, unknown>,
  options: ResolveChoiceSetFiltersOptions
): ChoiceSetFilterResolution | null {
  if (!Array.isArray(rule.choices)) {
    return null;
  }

  const choices = rule.choices.filter(isRecord);
  if (choices.length === 0 || choices.length !== rule.choices.length) {
    return null;
  }

  const contextPredicate = normalizePredicateList(rule.predicate, options);
  if (!contextPredicate) {
    return null;
  }

  const uuidPredicates: Record<string, ChoicePredicate[]> = {};
  const uuids: string[] = [];
  const actorDependencies = new Set<ActorChoiceFilterDependency>(contextPredicate.actorDependencies);
  for (const choice of choices) {
    const uuid = toNonEmptyString(choice.value);
    if (!uuid || !parseCompendiumItemUuid(uuid)) {
      return null;
    }

    const predicate = normalizePredicateList(choice.predicate, options);
    if (!predicate) {
      return null;
    }

    for (const dependency of predicate.actorDependencies) {
      actorDependencies.add(dependency);
    }

    uuids.push(uuid);
    if (predicate.predicate.length > 0) {
      uuidPredicates[uuid] = predicate.predicate;
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
    filters: {
      itemType: itemTypes[0],
      packIds,
      uuids,
      ...(Object.keys(uuidPredicates).length > 0 ? { uuidPredicates } : {}),
      ...(contextPredicate.predicate.length > 0 ? { contextPredicate: contextPredicate.predicate } : {}),
    },
    actorDependencies: Array.from(actorDependencies),
  };
}

function normalizePredicateList(
  value: unknown,
  options: ResolveChoiceSetFiltersOptions
): { predicate: ChoicePredicate[]; actorDependencies: ActorChoiceFilterDependency[] } | null {
  if (value === undefined) {
    return { predicate: [], actorDependencies: [] };
  }

  const predicate = Array.isArray(value) ? value.filter(isChoicePredicate) : isChoicePredicate(value) ? [value] : null;
  if (!predicate || (Array.isArray(value) && value.length !== predicate.length)) {
    return null;
  }

  return resolveActorInjectedPredicate(predicate, options);
}

function resolveActorInjectedPredicate(
  predicate: ChoicePredicate[],
  options: ResolveChoiceSetFiltersOptions
): { predicate: ChoicePredicate[]; actorDependencies: ActorChoiceFilterDependency[] } | null {
  const actorDependencies = new Set<ActorChoiceFilterDependency>();
  let unresolved = false;
  const resolved = predicate.map((entry) =>
    resolveActorInjectedPredicateEntry(entry, options, actorDependencies, () => {
      unresolved = true;
    })
  );

  if (unresolved && options.requireResolvedActorPlaceholders) {
    return null;
  }

  return {
    predicate: resolved,
    actorDependencies: Array.from(actorDependencies),
  };
}

function resolveActorInjectedPredicateEntry(
  predicate: ChoicePredicate,
  options: ResolveChoiceSetFiltersOptions,
  actorDependencies: Set<ActorChoiceFilterDependency>,
  markUnresolved: () => void
): ChoicePredicate {
  if (typeof predicate === "string") {
    return resolveActorInjectedPredicateString(predicate, options, actorDependencies, markUnresolved);
  }

  if (Array.isArray(predicate)) {
    return predicate.map((entry) =>
      resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved)
    );
  }

  const result = { ...predicate };
  if (Array.isArray(result.or)) {
    result.or = result.or.map((entry) =>
      resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved)
    );
  }
  if (Array.isArray(result.nor)) {
    result.nor = result.nor.map((entry) =>
      resolveActorInjectedPredicateEntry(entry, options, actorDependencies, markUnresolved)
    );
  }
  if (result.not) {
    result.not = resolveActorInjectedPredicateEntry(result.not, options, actorDependencies, markUnresolved);
  }

  for (const key of ["lt", "lte", "gt", "gte"] as const) {
    const comparator = result[key];
    if (!Array.isArray(comparator)) {
      continue;
    }

    result[key] = comparator.map((entry) =>
      typeof entry === "string"
        ? resolveActorInjectedPredicateString(entry, options, actorDependencies, markUnresolved)
        : entry
    ) as [string, number | string];
  }

  return result;
}

function resolveActorInjectedPredicateString(
  statement: string,
  options: ResolveChoiceSetFiltersOptions,
  actorDependencies: Set<ActorChoiceFilterDependency>,
  markUnresolved: () => void
): string {
  return statement.replace(/\{actor\|([^}]+)\}/g, (token, rawPath: string) => {
    const path = rawPath.trim();
    const dependency = actorDependencyForPath(path);
    if (dependency) {
      actorDependencies.add(dependency);
    }

    const replacement = actorPlaceholderValue(path, options.actorContext);
    if (!replacement) {
      markUnresolved();
      return token;
    }

    return replacement;
  });
}

function actorDependencyForPath(path: string): ActorChoiceFilterDependency | null {
  switch (path) {
    case "system.details.ancestry.trait":
      return "ancestry";
    case "system.details.class.trait":
      return "class";
    default:
      return null;
  }
}

function actorPlaceholderValue(path: string, context: ChoiceFilterActorContext | null | undefined): string | null {
  switch (path) {
    case "system.details.ancestry.trait":
      return toNonEmptyString(context?.ancestrySlug);
    case "system.details.class.trait":
      return toNonEmptyString(context?.classSlug);
    default:
      return null;
  }
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

  return [...(OFFICIAL_PACKS_BY_ITEM_TYPE[itemType] ?? [])];
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
