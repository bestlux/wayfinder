import type { DraftState, PendingStep, SelectionRef, SpellChoiceMeta } from "../../types.js";
import { createSpellChoiceStep } from "../domain/step-types.js";
import type { ReadExistingSpellChoiceSelections, SourceRef } from "./types.js";

interface CreateSpellChoiceStepArgs {
  slotId: string;
  level: number;
  title: string;
  description: string;
  source: SourceRef;
  classSlug: string | null;
  dependsOn: "class" | "class-branch" | null;
  count: number;
  minRank: number;
  maxRank: number;
  cantrip: boolean;
  allowedSpellSlugs?: string[];
  excludedTraditions?: string[];
  curriculumSpellNames: string[];
  requiresCurriculum?: boolean;
  additionalAllowedSpellNames: string[];
  additionalAllowedSpellUuids?: string[];
  restrictToCommon: boolean;
  destination: SpellChoiceMeta["destination"];
}

export function appendPendingSpellChoiceStep(
  steps: PendingStep[],
  step: PendingStep,
  draft: DraftState,
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections
): void {
  if (!shouldSuppressResolvedSpellChoiceStep(step, draft, readExistingSpellChoiceSelections)) {
    steps.push(step);
  }
}

export function makeSpellChoiceStep(args: CreateSpellChoiceStepArgs): PendingStep {
  return createSpellChoiceStep(args.level, args.title, args.description, {
    slotId: args.slotId,
    sourcePackId: args.source.sourcePackId,
    sourceDocumentId: args.source.sourceDocumentId,
    sourceUuid: args.source.sourceUuid,
    sourceName: args.source.sourceName,
    classSlug: args.classSlug,
    dependsOn: args.dependsOn,
    destination: { ...args.destination },
    count: args.count,
    minRank: args.minRank,
    maxRank: args.maxRank,
    cantrip: args.cantrip,
    ...(args.allowedSpellSlugs ? { allowedSpellSlugs: args.allowedSpellSlugs } : {}),
    ...(args.excludedTraditions ? { excludedTraditions: args.excludedTraditions } : {}),
    curriculumSpellNames: args.curriculumSpellNames,
    ...(args.requiresCurriculum !== undefined ? { requiresCurriculum: args.requiresCurriculum } : {}),
    additionalAllowedSpellNames: args.additionalAllowedSpellNames,
    ...(args.additionalAllowedSpellUuids ? { additionalAllowedSpellUuids: args.additionalAllowedSpellUuids } : {}),
    restrictToCommon: args.restrictToCommon,
  });
}

export function hasSatisfiedExistingSelections(
  step: PendingStep,
  draft: DraftState,
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections
): boolean {
  const choice = step.spellChoice;
  if (!choice) {
    return false;
  }

  const existingSelections = readExistingSpellChoiceSelections(choice);
  const draftedSelections = draft.spellChoices[step.slotId] ?? [];
  return existingSelections.length >= choice.count && draftedSelections.length === 0;
}

function shouldSuppressResolvedSpellChoiceStep(
  step: PendingStep,
  draft: DraftState,
  readExistingSpellChoiceSelections: (choice: SpellChoiceMeta) => SelectionRef[]
): boolean {
  return hasSatisfiedExistingSelections(step, draft, readExistingSpellChoiceSelections);
}
