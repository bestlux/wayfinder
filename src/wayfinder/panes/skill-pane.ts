import { PROFICIENCY_CODES, PROFICIENCY_LABELS, SKILL_LABELS } from "../../constants.js";
import type { DraftState, PendingStep } from "../../types.js";
import { maxProficiencyRank } from "../domain/skill-rank-projection.js";
import {
  activeSkillTrainingChoiceOptions,
  isActiveSkillTrainingChoice,
} from "../domain/skill-training-choice-availability.js";
import { formatSlug } from "../formatting.js";
import type { SkillIncreaseStepPane, SkillTrainingStepPane } from "../view-models.js";

interface SkillPaneDependencies {
  isTrainingStepComplete: (step: PendingStep) => boolean;
}

interface SkillEntry {
  slug: string;
  label: string;
  keyAbility?: string | null;
}

export function buildSkillIncreasePane(
  step: PendingStep,
  draft: DraftState,
  projectedRanks: Record<string, number>,
  skillEntries: SkillEntry[]
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
    templateKind: "skill-increase",
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
  skillEntries: SkillEntry[],
  deps: SkillPaneDependencies
): SkillTrainingStepPane {
  const training = draft.skillTrainings[step.slotId] ?? emptyTrainingDraft();
  const metadata = step.training;
  if (!metadata) {
    throw new Error(`Missing training metadata for step ${step.slotId}`);
  }

  const selectedRuleChoices = Object.fromEntries(
    metadata.choiceRules.map((choiceRule) => [choiceRule.key, training.ruleChoices[choiceRule.key] ?? null])
  );
  const reservedSkills = new Set<string>([
    ...metadata.fixedSkills,
    ...Object.values(selectedRuleChoices).filter((slug): slug is string => typeof slug === "string" && slug.length > 0),
  ]);
  const keyAbilities = new Map(skillEntries.map(({ slug, keyAbility }) => [slug, keyAbility ?? null]));

  const additionalSkills =
    metadata.additionalCount > 0
      ? skillEntries
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
          })
      : [];

  let hasInvalidRuleChoice = false;
  const choiceSections = metadata.choiceRules.map((choiceRule) => {
    const selectedSlug = selectedRuleChoices[choiceRule.key];
    const reservedByOtherChoices = new Set<string>([
      ...metadata.fixedSkills,
      ...training.additional,
      ...Object.entries(selectedRuleChoices)
        .filter(([key, slug]) => key !== choiceRule.key && typeof slug === "string" && slug.length > 0)
        .map(([, slug]) => slug as string),
    ]);
    const visibleOptions = activeSkillTrainingChoiceOptions(metadata, training, choiceRule, projectedRanks);
    const useFallbackOptions = visibleOptions === choiceRule.fallbackOptions;
    const activeSelectedSlug =
      selectedSlug && isActiveSkillTrainingChoice(metadata, training, choiceRule, projectedRanks, selectedSlug)
        ? selectedSlug
        : null;
    hasInvalidRuleChoice ||= !!selectedSlug && !activeSelectedSlug;
    const options = visibleOptions.map((option) => {
      const currentRank = Math.min(4, Math.max(0, projectedRanks[option.slug] ?? 0));
      const selected = option.slug === activeSelectedSlug;
      const disabledReason = selected
        ? null
        : reservedByOtherChoices.has(option.slug)
          ? "Already chosen elsewhere in this step"
          : currentRank >= 1
            ? "Already trained from another source"
            : null;

      return {
        ...option,
        currentRank,
        currentRankLabel: PROFICIENCY_LABELS[currentRank] ?? "Untrained",
        currentRankCode: PROFICIENCY_CODES[currentRank] ?? "U",
        keyAbility: keyAbilities.get(option.slug) ?? null,
        selected,
        disabled: !selected && disabledReason !== null,
        disabledReason,
      };
    });
    const unavailableReasons = [
      ...new Set(
        options.map((option) => option.disabledReason).filter((reason): reason is string => typeof reason === "string")
      ),
    ];

    return {
      key: choiceRule.key,
      prompt: useFallbackOptions ? (choiceRule.fallbackPrompt ?? choiceRule.prompt) : choiceRule.prompt,
      sourceLabel: choiceRule.sourceLabel,
      selectedSlug: activeSelectedSlug,
      selectedLabel: activeSelectedSlug ? (SKILL_LABELS[activeSelectedSlug] ?? formatSlug(activeSelectedSlug)) : null,
      unavailableLegend: unavailableReasons.length > 0 ? `Dimmed options: ${unavailableReasons.join("; ")}` : null,
      options,
    };
  });

  const loreSections = metadata.loreChoices.map((choice) => {
    const value = training.loreChoices[choice.key] ?? "";
    return {
      key: choice.key,
      prompt: choice.prompt,
      sourceLabel: choice.sourceLabel,
      value,
      placeholder: choice.placeholder,
      allowCustom: choice.allowCustom,
      suggestions: choice.suggestions.map((suggestion) => ({
        value: suggestion,
        selected: normalizeLoreValue(suggestion) === normalizeLoreValue(value),
      })),
    };
  });

  const fixedLabels = metadata.fixedSkills.map((slug) => SKILL_LABELS[slug] ?? formatSlug(slug));
  const fixedLoreLabels = metadata.fixedLores;
  const selectedLabels = [
    ...choiceSections
      .map((section) => section.selectedLabel)
      .filter((label): label is string => typeof label === "string" && label.length > 0),
    ...training.additional.map((slug) => SKILL_LABELS[slug] ?? formatSlug(slug)),
    ...Object.values(training.loreChoices)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()),
  ];
  const totalChoiceCount = metadata.choiceRules.length + metadata.additionalCount + metadata.loreChoices.length;

  return {
    kind: "skill-training",
    templateKind: "skill-training",
    stepId: step.id,
    slotId: step.slotId,
    level: step.level,
    modeLabel: "Skill Training",
    title: step.title,
    description: step.description,
    completed: deps.isTrainingStepComplete(step) && !hasInvalidRuleChoice,
    selectedLabel:
      selectedLabels.length > 0
        ? `${selectedLabels.length}/${totalChoiceCount} chosen`
        : "Choose starting skill training",
    className: metadata.className,
    fixedSkills: fixedLabels,
    fixedLores: fixedLoreLabels,
    choiceSections,
    loreSections,
    additionalCount: metadata.additionalCount,
    additionalRemaining: Math.max(0, metadata.additionalCount - training.additional.length),
    additionalSkills,
  };
}

function emptyTrainingDraft() {
  return { ruleChoices: {}, additional: [], loreChoices: {} };
}

function normalizeLoreValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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
