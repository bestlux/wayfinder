import type { PendingStep } from "../../types.js";

export function canGrantRestrictedSpellRarityAccess(step: PendingStep): boolean {
  return (
    step.kind === "spell-choice" &&
    step.spellChoice.restrictToCommon === true &&
    (step.spellChoice.allowedSpellSlugs?.length ?? 0) === 0 &&
    step.spellChoice.curriculumSpellNames.length === 0
  );
}

export function grantsRestrictedSpellRarityAccess(step: PendingStep, accessGranted: boolean): PendingStep {
  if (!accessGranted || !canGrantRestrictedSpellRarityAccess(step) || step.kind !== "spell-choice") {
    return step;
  }

  return {
    ...step,
    spellChoice: {
      ...step.spellChoice,
      restrictToCommon: false,
    },
  };
}
