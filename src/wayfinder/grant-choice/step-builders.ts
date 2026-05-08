import type { GrantSelectionMeta, PickItemStep, SelectionRef } from "../../types.js";
import { createPickItemStep } from "../domain/step-types.js";
import { formatSlug } from "../formatting.js";
import { discoverGrantSelectionMeta } from "./rule-discovery.js";

type GrantChoiceSourceItemType = GrantSelectionMeta["sourceItemType"];

export function buildGrantChoiceStepsFromRules(args: {
  sourceItemType: GrantChoiceSourceItemType;
  effectiveSourceDocument: unknown | null;
  sourceSelection: SelectionRef | null;
  extractSlug: (document: unknown) => string | null;
}): PickItemStep[] {
  const { sourceItemType, effectiveSourceDocument, sourceSelection, extractSlug } = args;
  if (!effectiveSourceDocument || !sourceSelection) {
    return [];
  }

  return discoverGrantSelectionMeta({
    sourceItemType,
    sourceDocument: effectiveSourceDocument,
    sourceSelection,
    extractSlug,
  }).map((grant) =>
    createPickItemStep(
      "grant-choice",
      choiceSourceLevel(effectiveSourceDocument),
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
