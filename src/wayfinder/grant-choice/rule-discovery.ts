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
