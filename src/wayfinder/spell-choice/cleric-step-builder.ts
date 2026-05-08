import type { PendingStep } from "../../types.js";
import { parseDeitySpellAccess } from "./metadata-parsing.js";
import { findClassFeatureSource } from "./source-utils.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
import type { BuildClericSpellChoiceStepsParams } from "./types.js";

const CLERIC_PREPARED_DESTINATION = {
  type: "prepared",
  key: "cleric-divine-prepared",
  label: "Divine prepared spells",
  entryName: "Divine Prepared Spells",
  tradition: "divine",
  ability: "wis",
  prepared: "prepared",
} as const;

export function buildClericSpellChoiceSteps(params: BuildClericSpellChoiceStepsParams): PendingStep[] {
  const { draft, effectiveClassDocument, effectiveDeityDocument, readExistingSpellChoiceSelections, classSlug } =
    params;
  const clericSpellcastingSource = findClassFeatureSource(effectiveClassDocument, "Cleric Spellcasting");
  const deityRankOneSpellAccess = parseDeitySpellAccess(effectiveDeityDocument, 1);
  const steps: PendingStep[] = [];

  const addStep = (step: PendingStep): void =>
    appendPendingSpellChoiceStep(steps, step, draft, readExistingSpellChoiceSelections);

  addStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-cleric-cantrips-level-1",
      level: 1,
      title: "Cleric prepared cantrips",
      description: "Choose the five divine cantrips your cleric begins prepared with.",
      source: clericSpellcastingSource,
      classSlug,
      dependsOn: "class",
      count: 5,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
      destination: CLERIC_PREPARED_DESTINATION,
    })
  );

  addStep(
    makeSpellChoiceStep({
      slotId: "spell-choice-cleric-rank-1-level-1",
      level: 1,
      title: "Cleric prepared spells",
      description: "Choose the two 1st-rank divine spells your cleric begins prepared with.",
      source: clericSpellcastingSource,
      classSlug,
      dependsOn: "class",
      count: 2,
      minRank: 1,
      maxRank: 1,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: deityRankOneSpellAccess.names,
      additionalAllowedSpellUuids: deityRankOneSpellAccess.uuids,
      restrictToCommon: true,
      destination: CLERIC_PREPARED_DESTINATION,
    })
  );

  return steps;
}
