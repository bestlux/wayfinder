import type { ChoicePredicate, GrantSelectionMeta, SelectionRef, StepFilters } from "../../types.js";
import { resolveChoiceSetFilters } from "../choice-set-filters.js";
import {
  documentFeatureLevel,
  extractChoiceKey,
  getDocumentRules,
  predicateIncludesString,
  toNonEmptyString,
} from "../rule-data.js";

interface NamedDocumentLike {
  name?: unknown;
}

type GrantChoiceSourceItemType = GrantSelectionMeta["sourceItemType"];

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

    const resolution = resolveChoiceSetFilters(rule, { sourceLevel: documentFeatureLevel(sourceDocument) });
    if (!resolution) {
      return [];
    }
    const filters = resolution.filters;

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
}

function grantDependencyPredicates(filters: StepFilters): ChoicePredicate[] {
  return [
    ...(filters.predicate ?? []),
    ...(filters.contextPredicate ?? []),
    ...Object.values(filters.uuidPredicates ?? {}).flat(),
  ];
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
