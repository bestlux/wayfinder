import type { SingletonItemType } from "../../build-state/document-types.js";
import { itemMatchesSourceId } from "../../shared/source-id.js";
import type { DraftState, PendingStep, SelectionRef } from "../../types.js";
import { buildClassBranchStepsFromRules } from "../class-choice/step-builders.js";
import { createClassArchetypeStep, createPickItemStep } from "../domain/step-types.js";
import { activeClassArchetypeProfile, buildClassArchetypeMeta, type ClassArchetypeProfile } from "./registry.js";

export async function buildClassArchetypeSteps(args: {
  draft: DraftState;
  effectiveClassDocument: unknown | null;
  targetLevel: number;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<unknown | null>;
  extractSlug: (document: unknown) => string | null;
  readExistingBranchSelection: (branch: NonNullable<PendingStep["branch"]>) => string | null;
}): Promise<PendingStep[]> {
  const branchSteps = await buildClassBranchStepsFromRules(args);
  return branchSteps.flatMap((step) => {
    const meta = buildClassArchetypeMeta(step.branch);
    if (!meta) {
      return [];
    }

    const ownDecision = args.draft.classArchetypeChoices[meta.slotId];
    if (!ownDecision && (args.readExistingBranchSelection(step.branch) || args.draft.branchSelections[step.slotId])) {
      return [];
    }

    return [
      createClassArchetypeStep(step.level, meta, {
        title: `${step.branch.selectorName}: standard or archetype`,
        description:
          "Choose the standard class progression or a supported class archetype. This decision changes later class features and spellcasting.",
      }),
    ];
  });
}

export function buildClassArchetypeFallbackFeatSteps(args: {
  draft: DraftState;
  actorItems: unknown[];
  targetLevel: number;
  projectedSingletonSources?: Array<{
    sourceItemType: SingletonItemType;
    sourceDocument: unknown | null;
  }>;
}): PendingStep[] {
  const profile = activeClassArchetypeProfile(args.draft, args.actorItems);
  if (!profile) {
    return [];
  }

  return profile.fallbackFeatChoices.flatMap((choice) => {
    if (choice.level > args.targetLevel || staticGrantReplacementAlreadyApplied(args.actorItems, choice)) {
      return [];
    }

    if (args.actorItems.some((item) => itemMatchesSourceId(item, choice.grantedBySourceUuid))) {
      return [];
    }

    const projectedSingletonSources = args.projectedSingletonSources ?? [];
    const existingItem = args.actorItems.find(
      (item) =>
        itemMatchesSourceId(item, choice.existingSourceUuid) &&
        !itemWasGrantedByReplacedSingleton(item, args.actorItems, projectedSingletonSources)
    );
    const projectedItem = projectedSingletonSources.some(({ sourceDocument }) =>
      documentDirectlyGrantsChoice(sourceDocument, choice)
    );
    if (
      (!existingItem && !projectedItem) ||
      (existingItem && itemWasGrantedBySource(existingItem, args.actorItems, choice.grantedBySourceUuid))
    ) {
      return [];
    }

    return [
      createPickItemStep("grant-choice", choice.level, choice.title, choice.description, choice.filters, {
        slotId: choice.slotId,
        staticGrantReplacement: {
          sourceUuid: choice.grantedBySourceUuid,
          originalGrantUuids: choice.originalRuleUuids,
          flag: choice.flag,
        },
      }),
    ];
  });
}

function documentDirectlyGrantsChoice(
  document: unknown,
  choice: ClassArchetypeProfile["fallbackFeatChoices"][number]
): boolean {
  const rules = (document as { system?: { rules?: unknown } } | null)?.system?.rules;
  if (!Array.isArray(rules)) {
    return false;
  }

  const matchingUuids = new Set([choice.existingSourceUuid, ...choice.originalRuleUuids]);
  return rules.some((entry) => {
    const rule = entry as { key?: unknown; uuid?: unknown } | null;
    return rule?.key === "GrantItem" && typeof rule.uuid === "string" && matchingUuids.has(rule.uuid);
  });
}

function itemWasGrantedByReplacedSingleton(
  item: unknown,
  actorItems: unknown[],
  projectedSingletonSources: Array<{ sourceItemType: SingletonItemType }>
): boolean {
  const replacedTypes = new Set(projectedSingletonSources.map((source) => source.sourceItemType));
  const grantedById = (item as { flags?: { pf2e?: { grantedBy?: { id?: unknown } } } } | null)?.flags?.pf2e?.grantedBy
    ?.id;
  if (typeof grantedById !== "string") {
    return false;
  }

  const granter = actorItems.find((candidate) => (candidate as { id?: unknown } | null)?.id === grantedById) as {
    type?: unknown;
  } | null;
  return typeof granter?.type === "string" && replacedTypes.has(granter.type as SingletonItemType);
}

function staticGrantReplacementAlreadyApplied(
  actorItems: unknown[],
  choice: ClassArchetypeProfile["fallbackFeatChoices"][number]
): boolean {
  const source = actorItems.find((item) => itemMatchesSourceId(item, choice.grantedBySourceUuid)) as {
    system?: { rules?: unknown };
  } | null;
  const rules = Array.isArray(source?.system?.rules) ? source.system.rules : [];
  return rules.some((entry) => {
    const rule = entry as { key?: unknown; uuid?: unknown; flag?: unknown } | null;
    return (
      rule?.key === "GrantItem" &&
      rule.flag === choice.flag &&
      typeof rule.uuid === "string" &&
      !choice.originalRuleUuids.includes(rule.uuid)
    );
  });
}

function itemWasGrantedBySource(item: unknown, actorItems: unknown[], sourceUuid: string): boolean {
  const grantedById = (item as { flags?: { pf2e?: { grantedBy?: { id?: unknown } } } } | null)?.flags?.pf2e?.grantedBy
    ?.id;
  return (
    typeof grantedById === "string" &&
    actorItems.some(
      (candidate) =>
        (candidate as { id?: unknown } | null)?.id === grantedById && itemMatchesSourceId(candidate, sourceUuid)
    )
  );
}
