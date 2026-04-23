import type { SelectionRef, SingletonChoiceMeta, SingletonChoiceStep } from "../../types.js";
import { createSingletonChoiceStep } from "../domain/step-types.js";
import { formatSlug } from "../formatting.js";
import { discoverSingletonChoiceMeta } from "./rule-discovery.js";

export function buildSingletonChoiceStepsFromRules(args: {
  sourceItemType: SingletonChoiceMeta["sourceItemType"];
  effectiveSourceDocument: unknown | null;
  sourceSelection: SelectionRef | null;
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
}): SingletonChoiceStep[] {
  const { sourceItemType, effectiveSourceDocument, sourceSelection, extractSlug, localize } = args;
  if (!effectiveSourceDocument || !sourceSelection) {
    return [];
  }

  const sourceLevel = choiceSourceLevel(sourceSelection, effectiveSourceDocument);
  return discoverSingletonChoiceMeta({
    sourceItemType,
    sourceDocument: effectiveSourceDocument,
    sourceSelection,
    sourceLevel,
    extractSlug,
    localize,
  }).map((choice) =>
    createSingletonChoiceStep(sourceLevel, choice, {
      title: formatChoiceFlag(choice.flag),
      description:
        choice.prompt ?? `Choose the ${formatChoiceFlag(choice.flag).toLowerCase()} this ${sourceItemType} grants.`,
    })
  );
}

function choiceSourceLevel(selection: SelectionRef, document: unknown): number {
  const slotLevel = /-level-(\d+)$/.exec(selection.slotId)?.[1];
  if (slotLevel) {
    return Math.max(1, Number(slotLevel));
  }

  const value = (document as { system?: { level?: { value?: unknown } } } | null | undefined)?.system?.level?.value;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}

function formatChoiceFlag(flag: string): string {
  return formatSlug(flag.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
}
