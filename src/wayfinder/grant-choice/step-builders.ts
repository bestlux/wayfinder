import type { GrantSelectionMeta, PickItemStep, SelectionRef } from "../../types.js";
import type { ChoiceFilterActorContext } from "../choice-set-filters.js";
import { createPickItemStep } from "../domain/step-types.js";
import { formatSlug } from "../formatting.js";
import { discoverGrantSelectionMeta } from "./rule-discovery.js";

type GrantChoiceSourceItemType = GrantSelectionMeta["sourceItemType"];

export function buildGrantChoiceStepsFromRules(args: {
  sourceItemType: GrantChoiceSourceItemType;
  effectiveSourceDocument: unknown | null;
  sourceSelection: SelectionRef | null;
  sourceLevel?: number;
  extractSlug: (document: unknown) => string | null;
  activeRollOptions?: ReadonlySet<string>;
  actorContext?: ChoiceFilterActorContext | null;
  requireResolvedActorPlaceholders?: boolean;
  selectedValuesBySlotId?: Record<string, SelectionRef | undefined>;
}): PickItemStep[] {
  const { sourceItemType, effectiveSourceDocument, sourceSelection, extractSlug } = args;
  if (!effectiveSourceDocument || !sourceSelection) {
    return [];
  }

  const discovered = discoverGrantSelectionMeta({
    sourceItemType,
    sourceDocument: effectiveSourceDocument,
    sourceSelection,
    sourceLevel: args.sourceLevel,
    extractSlug,
    activeRollOptions: args.activeRollOptions,
    actorContext: args.actorContext,
    requireResolvedActorPlaceholders: args.requireResolvedActorPlaceholders,
    selectedValuesBySlotId: args.selectedValuesBySlotId,
  });
  return discovered.map((grant) =>
    createPickItemStep(
      "grant-choice",
      args.sourceLevel ?? choiceSourceLevel(effectiveSourceDocument),
      buildGrantChoiceTitle(grant),
      buildGrantChoiceDescription(grant),
      grant.filters,
      {
        slotId: grant.slotId,
        grantSelection: grant,
      }
    )
  );
}

function choiceSourceLevel(document: unknown): number {
  const value = (document as { system?: { level?: { value?: unknown } } } | null | undefined)?.system?.level?.value;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}

function buildGrantChoiceTitle(grant: GrantSelectionMeta): string {
  if (grant.itemType === "feat") {
    return `${grant.selectorName} feat grant`;
  }

  return grant.selectorName;
}

function buildGrantChoiceDescription(grant: GrantSelectionMeta): string {
  const sourceLabel =
    grant.sourceItemType === "feat"
      ? "selected feat"
      : grant.sourceItemType === "classfeature"
        ? "selected class feature"
        : grant.sourceItemType;
  if (grant.itemType === "feat") {
    return `Choose the feat this ${sourceLabel} grants.`;
  }

  return `Choose the ${formatSlug(grant.itemType).toLowerCase()} this ${sourceLabel} grants.`;
}
