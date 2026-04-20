import type { SlotKind } from "./step-types.js";

export const SLOT_IDS = {
  abilityBoostsLevel1: "ability-boosts-level-1",
  ancestry: "ancestry-level-1",
  background: "background-level-1",
  class: "class-level-1",
  deity: "deity-level-1",
  heritage: "heritage-level-1",
  wizardArcaneSchool: "class-branch-arcane-school-level-1",
} as const;

export const SLOT_PREFIXES = {
  ancestryFeat: "ancestry-feat-level-",
  classBranch: "class-branch-",
  classChoice: "class-choice-",
  classFeat: "class-feat-level-",
  deity: "deity-level-",
  skillTraining: "skill-training-",
  spellChoice: "spell-choice-",
  wizardArcaneSchool: "class-branch-arcane-school-level-",
} as const;

const SLOT_KIND_PREFIXES: Array<{ kind: SlotKind; prefix: string }> = [
  { kind: "ability-boosts", prefix: "ability-boosts-level-" },
  { kind: "ancestry-feat", prefix: SLOT_PREFIXES.ancestryFeat },
  { kind: "class-branch", prefix: SLOT_PREFIXES.classBranch },
  { kind: "class-choice", prefix: SLOT_PREFIXES.classChoice },
  { kind: "class-feat", prefix: SLOT_PREFIXES.classFeat },
  { kind: "deity", prefix: SLOT_PREFIXES.deity },
  { kind: "general-feat", prefix: "general-feat-level-" },
  { kind: "skill-feat", prefix: "skill-feat-level-" },
  { kind: "skill-increase", prefix: "skill-increase-level-" },
  { kind: "skill-training", prefix: SLOT_PREFIXES.skillTraining },
  { kind: "spell-choice", prefix: SLOT_PREFIXES.spellChoice },
  { kind: "ancestry", prefix: "ancestry-level-" },
  { kind: "background", prefix: "background-level-" },
  { kind: "class", prefix: "class-level-" },
  { kind: "heritage", prefix: "heritage-level-" },
];

export function getSlotIdKind(slotId: string): SlotKind | null {
  return SLOT_KIND_PREFIXES.find((entry) => slotId.startsWith(entry.prefix))?.kind ?? null;
}

export function isSanctificationChoiceSlotId(slotId: string): boolean {
  return /^class-choice-.+-sanctification-level-\d+$/.test(slotId);
}

export function isWizardArcaneSchoolSlotId(slotId: string): boolean {
  return /^class-branch-arcane-school-level-\d+$/.test(slotId);
}
