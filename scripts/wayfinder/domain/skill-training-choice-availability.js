export function activeSkillTrainingChoiceOptions(metadata, training, choiceRule, projectedRanks) {
    const fallbackOptions = choiceRule.fallbackOptions ?? [];
    if (fallbackOptions.length === 0) {
        return choiceRule.options;
    }
    const reservedByOtherChoices = reservedSkillSlugs(metadata, training, choiceRule);
    const primaryOptionsUnavailable = choiceRule.options.every((option) => reservedByOtherChoices.has(option.slug) || (projectedRanks[option.slug] ?? 0) >= 1);
    return primaryOptionsUnavailable ? fallbackOptions : choiceRule.options;
}
export function isActiveSkillTrainingChoice(metadata, training, choiceRule, projectedRanks, slug) {
    const activeOption = activeSkillTrainingChoiceOptions(metadata, training, choiceRule, projectedRanks).some((option) => option.slug === slug);
    return (activeOption && !reservedSkillSlugs(metadata, training, choiceRule).has(slug) && (projectedRanks[slug] ?? 0) < 1);
}
function reservedSkillSlugs(metadata, training, choiceRule) {
    return new Set([
        ...metadata.fixedSkills,
        ...training.additional,
        ...Object.entries(training.ruleChoices)
            .filter(([key, slug]) => key !== choiceRule.key && typeof slug === "string" && slug.length > 0)
            .map(([, slug]) => slug),
    ]);
}
//# sourceMappingURL=skill-training-choice-availability.js.map