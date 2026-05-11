import type { PendingStep, SpellChoiceMeta } from "../../types.js";
import { findClassFeatureSource } from "./source-utils.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
import type { SpellTradition } from "./tradition-utils.js";
import type { ReadExistingSpellChoiceSelections, SpellChoiceClassDocument } from "./types.js";

interface BuildPreparedSpellChoiceStepsParams {
  draft: Parameters<typeof appendPendingSpellChoiceStep>[2];
  effectiveClassDocument: SpellChoiceClassDocument;
  classSlug: string;
  classLabel: string;
  spellcastingFeatureName: string;
  tradition: SpellTradition;
  ability: string;
  cantripCount: number;
  rankOneCount: number;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}

export function buildPreparedSpellChoiceSteps(params: BuildPreparedSpellChoiceStepsParams): PendingStep[] {
  const source = findClassFeatureSource(params.effectiveClassDocument, params.spellcastingFeatureName);
  const destination = preparedDestination(params);
  const steps: PendingStep[] = [];
  const addStep = (step: PendingStep): void =>
    appendPendingSpellChoiceStep(steps, step, params.draft, params.readExistingSpellChoiceSelections);

  addStep(
    makeSpellChoiceStep({
      slotId: `spell-choice-${params.classSlug}-cantrips-level-1`,
      level: 1,
      title: `${params.classLabel} prepared cantrips`,
      description: `Choose the ${params.cantripCount} ${params.tradition} cantrips this ${params.classLabel.toLowerCase()} begins prepared with.`,
      source,
      classSlug: params.classSlug,
      dependsOn: "class",
      count: params.cantripCount,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
      destination,
    })
  );

  addStep(
    makeSpellChoiceStep({
      slotId: `spell-choice-${params.classSlug}-rank-1-level-1`,
      level: 1,
      title: `${params.classLabel} prepared spells`,
      description: `Choose the ${params.rankOneCount} 1st-rank ${params.tradition} spells this ${params.classLabel.toLowerCase()} begins prepared with.`,
      source,
      classSlug: params.classSlug,
      dependsOn: "class",
      count: params.rankOneCount,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
      destination,
    })
  );

  return steps;
}

function preparedDestination(params: BuildPreparedSpellChoiceStepsParams): SpellChoiceMeta["destination"] {
  return {
    type: "prepared",
    key: `${params.classSlug}-${params.tradition}-prepared`,
    label: `${formatTitle(params.tradition)} prepared spells`,
    entryName: `${formatTitle(params.tradition)} Prepared Spells`,
    tradition: params.tradition,
    ability: params.ability,
    prepared: "prepared",
  };
}

function formatTitle(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
