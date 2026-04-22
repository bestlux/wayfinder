import { PROFICIENCY_CODES, PROFICIENCY_LABELS, SKILL_LABELS } from "../../constants.js";
import type { DraftState, PendingStep } from "../../types.js";
import { formatSlug } from "../formatting.js";
import type { SkillIncreaseStepPane, SkillTrainingStepPane } from "../view-models.js";

interface SkillPaneDependencies {
  isTrainingStepComplete: (step: PendingStep) => boolean;
}

export function buildSkillIncreasePane(
  step: PendingStep,
  draft: DraftState,
  projectedRanks: Record<string, number>,
  skillEntries: Array<{ slug: string; label: string }>
): SkillIncreaseStepPane {
  const selectedSkill = draft.skillIncreases[step.slotId] ?? null;
  const maxRank = maxProficiencyRank(step.level);
  const maxRankLabel = PROFICIENCY_LABELS[maxRank] ?? "Expert";

  const skills = skillEntries.map(({ slug, label }) => {
    const currentRank = Math.min(4, Math.max(0, projectedRanks[slug] ?? 0));
    const targetRank = Math.min(4, currentRank + 1);
    const atCap = currentRank >= maxRank;
    const isSelected = selectedSkill === slug;

    return {
      slug,
      label,
      currentRank,
      currentRankLabel: PROFICIENCY_LABELS[currentRank] ?? "Untrained",
      currentRankCode: PROFICIENCY_CODES[currentRank] ?? "U",
      targetRank,
      targetRankLabel: PROFICIENCY_LABELS[targetRank] ?? "Trained",
      targetRankCode: PROFICIENCY_CODES[targetRank] ?? "T",
      selected: isSelected,
      disabled: atCap && !isSelected,
      disabledReason: atCap ? `Already at ${PROFICIENCY_LABELS[currentRank]} (max for level ${step.level})` : null,
    };
  });

  const selectedLabel = selectedSkill
    ? `${SKILL_LABELS[selectedSkill] ?? formatSlug(selectedSkill)} → ${PROFICIENCY_LABELS[Math.min(4, (projectedRanks[selectedSkill] ?? 0) + 1)] ?? "Trained"}`
    : "Choose one skill";

  return {
    kind: "skill-increase",
    isPickItem: false,
    isManual: false,
    isBoost: false,
    isSkillIncrease: true,
    isSkillTraining: false,
    isSingletonChoice: false,
    isLanguageChoice: false,
    isClassChoice: false,
    isSpellChoice: false,
    stepId: step.id,
    slotId: step.slotId,
    level: step.level,
    modeLabel: "Skill Increase",
    title: step.title,
    description: step.description,
    completed: !!selectedSkill,
    selectedLabel,
    maxRankLabel,
    skills,
  };
}

export function buildSkillTrainingPane(
  step: PendingStep,
  draft: DraftState,
  projectedRanks: Record<string, number>,
  skillEntries: Array<{ slug: string; label: string }>,
  deps: SkillPaneDependencies
): SkillTrainingStepPane {
  const training = draft.skillTrainings[step.slotId] ?? { ruleChoices: {}, additional: [] };
  const metadata = step.training;
  if (!metadata) {
    throw new Error(`Missing training metadata for step ${step.slotId}`);
  }

  const reservedSkills = new Set<string>([...metadata.fixedSkills, ...Object.values(training.ruleChoices)]);

  const additionalSkills = skillEntries
    .filter(({ slug }) => !reservedSkills.has(slug))
    .map(({ slug, label }) => {
      const currentRank = Math.min(4, Math.max(0, projectedRanks[slug] ?? 0));
      const selected = training.additional.includes(slug);
      return {
        slug,
        label,
        currentRank,
        currentRankLabel: PROFICIENCY_LABELS[currentRank] ?? "Untrained",
        currentRankCode: PROFICIENCY_CODES[currentRank] ?? "U",
        targetRank: 1,
        targetRankLabel: "Trained",
        targetRankCode: "T",
        selected,
        disabled: currentRank >= 1 && !selected,
        disabledReason: currentRank >= 1 ? "Already trained from another source" : null,
      };
    });

  const choiceSections = metadata.choiceRules.map((choiceRule) => {
    const selectedSlug = training.ruleChoices[choiceRule.flag] ?? null;
    return {
      flag: choiceRule.flag,
      prompt: choiceRule.prompt,
      selectedSlug,
      selectedLabel: selectedSlug ? (SKILL_LABELS[selectedSlug] ?? formatSlug(selectedSlug)) : null,
      options: choiceRule.options.map((option) => ({
        ...option,
        selected: option.slug === selectedSlug,
      })),
    };
  });

  const fixedLabels = metadata.fixedSkills.map((slug) => SKILL_LABELS[slug] ?? formatSlug(slug));
  const selectedLabels = [
    ...Object.values(training.ruleChoices).map((slug) => SKILL_LABELS[slug] ?? formatSlug(slug)),
    ...training.additional.map((slug) => SKILL_LABELS[slug] ?? formatSlug(slug)),
  ];

  return {
    kind: "skill-training",
    isPickItem: false,
    isManual: false,
    isBoost: false,
    isSkillIncrease: false,
    isSkillTraining: true,
    isSingletonChoice: false,
    isLanguageChoice: false,
    isClassChoice: false,
    isSpellChoice: false,
    stepId: step.id,
    slotId: step.slotId,
    level: step.level,
    modeLabel: "Skill Training",
    title: step.title,
    description: step.description,
    completed: deps.isTrainingStepComplete(step),
    selectedLabel:
      selectedLabels.length > 0
        ? `${selectedLabels.length}/${metadata.choiceRules.length + metadata.additionalCount} chosen`
        : "Choose class skill training",
    className: metadata.className,
    fixedSkills: fixedLabels,
    choiceSections,
    additionalCount: metadata.additionalCount,
    additionalRemaining: Math.max(0, metadata.additionalCount - training.additional.length),
    additionalSkills,
  };
}

export function compareSkillIncreaseSlotIds(left: string, right: string): number {
  const leftLevel = skillIncreaseLevelFromSlotId(left);
  const rightLevel = skillIncreaseLevelFromSlotId(right);
  if (leftLevel !== rightLevel) {
    return leftLevel - rightLevel;
  }

  return left.localeCompare(right);
}

export function skillIncreaseLevelFromSlotId(slotId: string): number {
  const match = /skill-increase-level-(\d+)/.exec(slotId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function maxProficiencyRank(level: number): number {
  if (level >= 15) return 4;
  if (level >= 7) return 3;
  return 2;
}
