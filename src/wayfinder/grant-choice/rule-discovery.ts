import type { ChoicePredicate, GrantSelectionMeta, SelectionRef, StepFilters } from "../../types.js";

interface NamedDocumentLike {
  name?: unknown;
  system?: {
    slug?: unknown;
    level?: {
      value?: unknown;
    };
    rules?: unknown;
  };
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
  const level = toFeatureLevel(document?.system?.level?.value);
  const rules = findRelevantRules(sourceDocument);

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

    const dependsOn = resolveGrantDependency(sourceItemType, filters.predicate ?? []);
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
      const predicate = Array.isArray(choices.filter) ? choices.filter.filter(isChoicePredicate) : [];
      const itemType = toNonEmptyString(choices.itemType) ?? inferItemTypeFromPredicate(predicate);
      if (!itemType || predicate.length === 0) {
        return null;
      }

      return {
        itemType,
        predicate,
      };
    }

    return resolveStaticUuidChoiceFilters(rule);
  }
}

function resolveStaticUuidChoiceFilters(rule: Record<string, unknown>): StepFilters | null {
  if (!Array.isArray(rule.choices) || rule.predicate !== undefined) {
    return null;
  }

  const choices = rule.choices.filter(isRecord);
  if (choices.length === 0 || choices.length !== rule.choices.length || choices.some((choice) => choice.predicate)) {
    return null;
  }

  const uuids = choices.map((choice) => toNonEmptyString(choice.value));
  if (uuids.some((uuid) => !uuid || !parseCompendiumItemUuid(uuid))) {
    return null;
  }

  const packIds = Array.from(
    new Set(
      uuids.flatMap((uuid) => {
        const parsed = uuid ? parseCompendiumItemUuid(uuid) : null;
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
    uuids: uuids.filter((uuid): uuid is string => !!uuid),
  };
}

function parseCompendiumItemUuid(uuid: string): { packId: string; documentId: string } | null {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid.trim());
  return match ? { packId: match[1], documentId: match[2] } : null;
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

function findRelevantRules(document: unknown): Array<Record<string, unknown>> {
  const rules = (document as NamedDocumentLike | null | undefined)?.system?.rules;
  return Array.isArray(rules) ? rules.filter(isRecord) : [];
}

function extractChoiceKey(rule: Record<string, unknown>): string | null {
  const candidates = [rule.flag, rule.rollOption, rule.slug];
  for (const candidate of candidates) {
    const normalized = toNonEmptyString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
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

function predicateIncludesString(predicate: ChoicePredicate, target: string): boolean {
  if (typeof predicate === "string") {
    return predicate.includes(target);
  }

  if (Array.isArray(predicate)) {
    return predicate.some((entry) => predicateIncludesString(entry, target));
  }

  if (!isRecord(predicate)) {
    return false;
  }

  return (
    (Array.isArray(predicate.or) && predicate.or.some((entry) => predicateIncludesString(entry, target))) ||
    (Array.isArray(predicate.nor) && predicate.nor.some((entry) => predicateIncludesString(entry, target))) ||
    (!!predicate.not && predicateIncludesString(predicate.not, target))
  );
}

function toFeatureLevel(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isChoicePredicate(value: unknown): value is ChoicePredicate {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isChoicePredicate(entry));
  }

  if (!isRecord(value)) {
    return false;
  }

  if ("or" in value && value.or !== undefined && (!Array.isArray(value.or) || !value.or.every(isChoicePredicate))) {
    return false;
  }

  if ("nor" in value && value.nor !== undefined && (!Array.isArray(value.nor) || !value.nor.every(isChoicePredicate))) {
    return false;
  }

  if ("not" in value && value.not !== undefined && !isChoicePredicate(value.not)) {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
