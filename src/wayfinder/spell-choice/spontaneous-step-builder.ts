import { wizardMaxSpellRank } from "../../shared/spellcasting.js";
import type { PendingStep } from "../../types.js";
import { findClassFeatureSource } from "./source-utils.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
import type { ReadExistingSpellChoiceSelections, SpellChoiceClassDocument } from "./types.js";

interface BuildSpontaneousRepertoireStepsParams {
  draft: Parameters<typeof appendPendingSpellChoiceStep>[2];
  currentLevel: number;
  effectiveClassDocument: SpellChoiceClassDocument;
  targetLevel: number;
  classSlug: string;
  spellcastingFeatureName: string;
  tradition: string;
  ability: string;
  cantripCount: number;
  initialRankOneCount: number;
  rankIncreaseCount: number;
  rankMaintenanceCount: number;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}

export function buildSpontaneousRepertoireSpellChoiceSteps(
  params: BuildSpontaneousRepertoireStepsParams
): PendingStep[] {
  const source = findClassFeatureSource(params.effectiveClassDocument, params.spellcastingFeatureName);
  const destination = {
    type: "spontaneous",
    key: `${params.classSlug}-${params.tradition}-spontaneous`,
    label: `${formatTitle(params.tradition)} spell repertoire`,
    entryName: `${formatTitle(params.tradition)} Spontaneous Spells`,
    tradition: params.tradition,
    ability: params.ability,
    prepared: "spontaneous",
  } as const;
  const steps: PendingStep[] = [];
  const addStep = (step: PendingStep): void =>
    appendPendingSpellChoiceStep(steps, step, params.draft, params.readExistingSpellChoiceSelections);

  addStep(
    makeSpellChoiceStep({
      slotId: `spell-choice-${params.classSlug}-cantrips-level-1`,
      level: 1,
      title: `${formatTitle(params.classSlug)} cantrips`,
      description: `Choose the ${params.cantripCount} ${params.tradition} cantrips in your starting repertoire.`,
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
      slotId: `spell-choice-${params.classSlug}-repertoire-rank-1-level-1`,
      level: 1,
      title: `${formatTitle(params.classSlug)} starting repertoire`,
      description: `Choose the ${params.initialRankOneCount} 1st-rank ${params.tradition} spells in your starting repertoire.`,
      source,
      classSlug: params.classSlug,
      dependsOn: "class",
      count: params.initialRankOneCount,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
      destination,
    })
  );

  for (let level = Math.max(2, params.currentLevel + 1); level <= params.targetLevel; level += 1) {
    const rank = wizardMaxSpellRank(level);
    const count = level % 2 === 1 ? params.rankIncreaseCount : params.rankMaintenanceCount;
    addStep(
      makeSpellChoiceStep({
        slotId: `spell-choice-${params.classSlug}-repertoire-rank-${rank}-level-${level}`,
        level,
        title: `Level ${level} ${formatTitle(params.classSlug)} repertoire`,
        description: `Choose ${count} rank ${rank} ${params.tradition} spell${count === 1 ? "" : "s"} for your repertoire.`,
        source,
        classSlug: params.classSlug,
        dependsOn: "class",
        count,
        minRank: rank,
        maxRank: rank,
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
        destination,
      })
    );
  }

  return steps;
}

function formatTitle(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
