import type { FlagChoiceMeta, PickItemStep, SelectionRef } from "../../types.js";
import { type ChoiceFilterActorContext } from "../choice-set-filters.js";
import { createPickItemStep } from "../domain/step-types.js";
import { formatSlug } from "../formatting.js";
import { discoverFlagChoiceMeta } from "./rule-discovery.js";

type FlagChoiceSourceItemType = FlagChoiceMeta["sourceItemType"];

export function buildFlagChoiceStepsFromRules(args: {
  sourceItemType: FlagChoiceSourceItemType;
  effectiveSourceDocument: unknown | null;
  sourceSelection: SelectionRef | null;
  extractSlug: (document: unknown) => string | null;
  actorContext?: ChoiceFilterActorContext | null;
  requireResolvedActorPlaceholders?: boolean;
}): PickItemStep[] {
  const { sourceItemType, effectiveSourceDocument, sourceSelection, extractSlug } = args;
  if (!effectiveSourceDocument || !sourceSelection) {
    return [];
  }

  return discoverFlagChoiceMeta({
    sourceItemType,
    sourceDocument: effectiveSourceDocument,
    sourceSelection,
    extractSlug,
    actorContext: args.actorContext,
    requireResolvedActorPlaceholders: args.requireResolvedActorPlaceholders,
  }).map((choice) =>
    createPickItemStep(
      "flag-choice",
      choiceSourceLevel(effectiveSourceDocument),
      buildFlagChoiceTitle(choice),
      buildFlagChoiceDescription(choice),
      choice.filters,
      {
        slotId: choice.slotId,
        flagChoice: choice,
      }
    )
  );
}

function choiceSourceLevel(document: unknown): number {
  const value = (document as { system?: { level?: { value?: unknown } } } | null | undefined)?.system?.level?.value;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}

function buildFlagChoiceTitle(choice: FlagChoiceMeta): string {
  return choice.prompt ?? choice.sourceName + " " + formatSlug(choice.flag);
}

function buildFlagChoiceDescription(choice: FlagChoiceMeta): string {
  const sourceLabel =
    choice.sourceItemType === "feat"
      ? "selected feat"
      : choice.sourceItemType === "classfeature"
        ? "selected class feature"
        : choice.sourceItemType;

  return "Choose the " + formatSlug(choice.itemType).toLowerCase() + " this " + sourceLabel + " configures.";
}
