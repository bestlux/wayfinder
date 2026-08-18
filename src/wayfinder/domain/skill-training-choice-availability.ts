import type { SkillTrainingDraft } from "./decision-types.js";
import type { SkillTrainingChoiceMeta, SkillTrainingMeta } from "./step-types.js";

type SkillOption = { slug: string; label: string };

export function activeSkillTrainingChoiceOptions(
  metadata: Pick<SkillTrainingMeta, "choiceRules" | "fixedSkills">,
  training: SkillTrainingDraft,
  choiceRule: SkillTrainingChoiceMeta,
  projectedRanks: Readonly<Record<string, number>>,
  allowRecoveredSelection = false
): SkillOption[] {
  const fallbackOptions = choiceRule.fallbackOptions ?? [];
  if (fallbackOptions.length === 0) {
    return choiceRule.options;
  }

  const reservedByOtherChoices = reservedSkillSlugs(metadata, training, choiceRule);
  const recoveredSelection = allowRecoveredSelection ? training.ruleChoices[choiceRule.key] : null;
  const primaryOptionsUnavailable = choiceRule.options.every(
    (option) =>
      reservedByOtherChoices.has(option.slug) ||
      ((projectedRanks[option.slug] ?? 0) >= 1 && option.slug !== recoveredSelection)
  );

  return primaryOptionsUnavailable ? fallbackOptions : choiceRule.options;
}

export function isActiveSkillTrainingChoice(
  metadata: Pick<SkillTrainingMeta, "choiceRules" | "fixedSkills">,
  training: SkillTrainingDraft,
  choiceRule: SkillTrainingChoiceMeta,
  projectedRanks: Readonly<Record<string, number>>,
  slug: string,
  allowRecoveredSelection = false
): boolean {
  const activeOption = activeSkillTrainingChoiceOptions(
    metadata,
    training,
    choiceRule,
    projectedRanks,
    allowRecoveredSelection
  ).some((option) => option.slug === slug);
  const alreadyAppliedRecoverySelection = allowRecoveredSelection && training.ruleChoices[choiceRule.key] === slug;
  return (
    activeOption &&
    !reservedSkillSlugs(metadata, training, choiceRule).has(slug) &&
    ((projectedRanks[slug] ?? 0) < 1 || alreadyAppliedRecoverySelection)
  );
}

function reservedSkillSlugs(
  metadata: Pick<SkillTrainingMeta, "choiceRules" | "fixedSkills">,
  training: SkillTrainingDraft,
  choiceRule: SkillTrainingChoiceMeta
): Set<string> {
  return new Set<string>([
    ...metadata.fixedSkills,
    ...training.additional,
    ...Object.entries(training.ruleChoices)
      .filter(([key, slug]) => key !== choiceRule.key && typeof slug === "string" && slug.length > 0)
      .map(([, slug]) => slug),
  ]);
}
