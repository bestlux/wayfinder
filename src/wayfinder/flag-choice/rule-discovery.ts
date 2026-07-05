import type { FlagChoiceMeta, SelectionRef } from "../../types.js";
import { type ChoiceFilterActorContext, resolveChoiceSetFilters } from "../choice-set-filters.js";
import { formatSlug } from "../formatting.js";
import { documentFeatureLevel, extractChoiceKey, getDocumentRules, toNonEmptyString } from "../rule-data.js";

interface NamedDocumentLike {
  name?: unknown;
}

type FlagChoiceSourceItemType = FlagChoiceMeta["sourceItemType"];

export function discoverFlagChoiceMeta(args: {
  sourceItemType: FlagChoiceSourceItemType;
  sourceDocument: unknown;
  sourceSelection: SelectionRef;
  extractSlug: (document: unknown) => string | null;
  actorContext?: ChoiceFilterActorContext | null;
  requireResolvedActorPlaceholders?: boolean;
}): FlagChoiceMeta[] {
  const { sourceItemType, sourceDocument, sourceSelection, extractSlug } = args;
  const document = sourceDocument as NamedDocumentLike | null | undefined;
  const sourceName = toNonEmptyString(document?.name) ?? sourceSelection.name;
  const sourceSlug = extractSlug(sourceDocument) ?? sourceSelection.documentId;
  const level = documentFeatureLevel(sourceDocument);
  const rules = getDocumentRules(sourceDocument);

  return rules.flatMap((rule, sourceRuleIndex) => {
    const flag = extractChoiceKey(rule);
    if (rule.key !== "ChoiceSet" || !flag || hasGrantForFlag(rules, flag)) {
      return [];
    }

    const resolution = resolveChoiceSetFilters(rule, {
      sourceLevel: level,
      actorContext: args.actorContext,
      requireResolvedActorPlaceholders: args.requireResolvedActorPlaceholders,
    });
    if (!resolution) {
      return [];
    }
    if (isUnsupportedFlagChoiceItemType(resolution.filters.itemType)) {
      return [];
    }

    const dependsOn = resolveActorDependency(resolution.actorDependencies);
    const dependencyKey = dependsOn ?? "none";
    return [
      {
        slotId:
          "flag-choice-" + dependencyKey + "-" + sourceItemType + "-" + sourceSlug + "-" + flag + "-level-" + level,
        sourceItemType,
        sourcePackId: sourceSelection.packId,
        sourceDocumentId: sourceSelection.documentId,
        sourceUuid: sourceSelection.uuid,
        sourceName,
        sourceRuleIndex,
        flag,
        prompt: resolvePrompt(rule.prompt),
        itemType: resolution.filters.itemType,
        selectionValue: isRecord(rule.choices) && rule.choices.slugsAsValues === true ? "slug" : "uuid",
        dependsOn,
        filters: resolution.filters,
      } satisfies FlagChoiceMeta,
    ];
  });
}

function isUnsupportedFlagChoiceItemType(itemType: string): boolean {
  return ["armor", "backpack", "consumable", "equipment", "shield", "treasure", "weapon"].includes(itemType);
}

function hasGrantForFlag(rules: Array<Record<string, unknown>>, flag: string): boolean {
  return rules.some(
    (entry) =>
      entry.key === "GrantItem" && typeof entry.uuid === "string" && entry.uuid.includes("rulesSelections." + flag)
  );
}

function resolveActorDependency(dependencies: Array<FlagChoiceMeta["dependsOn"]>): FlagChoiceMeta["dependsOn"] {
  if (dependencies.includes("class")) {
    return "class";
  }
  if (dependencies.includes("ancestry")) {
    return "ancestry";
  }
  return null;
}

function resolvePrompt(prompt: unknown): string | null {
  const value = toNonEmptyString(prompt);
  return value ? formatSlug(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
