import type { SkillTrainingDraft } from "./decision-types.js";
import type { SkillTrainingChoiceMeta, SkillTrainingMeta } from "./step-types.js";

type SkillOption = { slug: string; label: string };

export function activeSkillTrainingChoiceOptions(
  metadata: Pick<SkillTrainingMeta, "choiceRules" | "fixedSkills">,
  training: SkillTrainingDraft,
  choiceRule: SkillTrainingChoiceMeta,
  projectedRanks: Readonly<Record<string, number>>
): SkillOption[] {
  const fallbackOptions = choiceRule.fallbackOptions ?? [];
  if (fallbackOptions.length === 0) {
    return choiceRule.options;
  }

  const reservedByOtherChoices = reservedSkillSlugs(metadata, training, choiceRule);
  const primaryOptionsUnavailable = choiceRule.options.every(
    (option) => reservedByOtherChoices.has(option.slug) || (projectedRanks[option.slug] ?? 0) >= 1
  );

  return primaryOptionsUnavailable ? fallbackOptions : choiceRule.options;
}

export function isActiveSkillTrainingChoice(
  metadata: Pick<SkillTrainingMeta, "choiceRules" | "fixedSkills">,
  training: SkillTrainingDraft,
  choiceRule: SkillTrainingChoiceMeta,
  projectedRanks: Readonly<Record<string, number>>,
  slug: string
): boolean {
  const activeOption = activeSkillTrainingChoiceOptions(metadata, training, choiceRule, projectedRanks).some(
    (option) => option.slug === slug
  );
  return (
    activeOption && !reservedSkillSlugs(metadata, training, choiceRule).has(slug) && (projectedRanks[slug] ?? 0) < 1
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
