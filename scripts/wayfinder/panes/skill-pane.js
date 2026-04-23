import { PROFICIENCY_CODES, PROFICIENCY_LABELS, SKILL_LABELS } from "../../constants.js";
import { formatSlug } from "../formatting.js";
export function buildSkillIncreasePane(step, draft, projectedRanks, skillEntries) {
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
export function buildSkillTrainingPane(step, draft, projectedRanks, skillEntries, deps) {
    const training = draft.skillTrainings[step.slotId] ?? emptyTrainingDraft();
    const metadata = step.training;
    if (!metadata) {
        throw new Error(`Missing training metadata for step ${step.slotId}`);
    }
    const selectedRuleChoices = Object.fromEntries(metadata.choiceRules.map((choiceRule) => [choiceRule.key, training.ruleChoices[choiceRule.key] ?? null]));
    const reservedSkills = new Set([
        ...metadata.fixedSkills,
        ...Object.values(selectedRuleChoices).filter((slug) => typeof slug === "string" && slug.length > 0),
    ]);
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
        const selectedSlug = selectedRuleChoices[choiceRule.key];
        const reservedByOtherChoices = new Set([
            ...metadata.fixedSkills,
            ...training.additional,
            ...Object.entries(selectedRuleChoices)
                .filter(([key, slug]) => key !== choiceRule.key && typeof slug === "string" && slug.length > 0)
                .map(([, slug]) => slug),
        ]);
        const fallbackOptions = Array.isArray(choiceRule.fallbackOptions) && choiceRule.fallbackOptions.length > 0
            ? choiceRule.fallbackOptions
            : [];
        const selectedIsPrimary = !!selectedSlug && choiceRule.options.some((option) => option.slug === selectedSlug);
        const selectedIsFallbackOnly = !!selectedSlug && !selectedIsPrimary && fallbackOptions.some((option) => option.slug === selectedSlug);
        const useFallbackOptions = fallbackOptions.length > 0 &&
            (primaryOptionsFullyUnavailable(choiceRule.options, reservedByOtherChoices, projectedRanks, selectedSlug) ||
                selectedIsFallbackOnly);
        const visibleOptions = useFallbackOptions ? fallbackOptions : choiceRule.options;
        return {
            key: choiceRule.key,
            prompt: useFallbackOptions ? (choiceRule.fallbackPrompt ?? choiceRule.prompt) : choiceRule.prompt,
            sourceLabel: choiceRule.sourceLabel,
            selectedSlug,
            selectedLabel: selectedSlug ? (SKILL_LABELS[selectedSlug] ?? formatSlug(selectedSlug)) : null,
            options: visibleOptions.map((option) => ({
                ...option,
                selected: option.slug === selectedSlug,
                disabled: option.slug !== selectedSlug &&
                    (reservedByOtherChoices.has(option.slug) || (projectedRanks[option.slug] ?? 0) >= 1),
                disabledReason: reservedByOtherChoices.has(option.slug)
                    ? "Already chosen elsewhere in this step"
                    : (projectedRanks[option.slug] ?? 0) >= 1
                        ? "Already trained from another source"
                        : null,
            })),
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
        ...Object.values(selectedRuleChoices)
            .filter((slug) => typeof slug === "string" && slug.length > 0)
            .map((slug) => SKILL_LABELS[slug] ?? formatSlug(slug)),
        ...training.additional.map((slug) => SKILL_LABELS[slug] ?? formatSlug(slug)),
        ...Object.values(training.loreChoices)
            .filter((value) => typeof value === "string" && value.trim().length > 0)
            .map((value) => value.trim()),
    ];
    const totalChoiceCount = metadata.choiceRules.length + metadata.additionalCount + metadata.loreChoices.length;
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
        selectedLabel: selectedLabels.length > 0
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
function primaryOptionsFullyUnavailable(options, reservedByOtherChoices, projectedRanks, selectedSlug) {
    return options.every((option) => {
        if (option.slug === selectedSlug) {
            return false;
        }
        return reservedByOtherChoices.has(option.slug) || (projectedRanks[option.slug] ?? 0) >= 1;
    });
}
function emptyTrainingDraft() {
    return { ruleChoices: {}, additional: [], loreChoices: {} };
}
function normalizeLoreValue(value) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}
export function compareSkillIncreaseSlotIds(left, right) {
    const leftLevel = skillIncreaseLevelFromSlotId(left);
    const rightLevel = skillIncreaseLevelFromSlotId(right);
    if (leftLevel !== rightLevel) {
        return leftLevel - rightLevel;
    }
    return left.localeCompare(right);
}
export function skillIncreaseLevelFromSlotId(slotId) {
    const match = /skill-increase-level-(\d+)/.exec(slotId);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
export function maxProficiencyRank(level) {
    if (level >= 15)
        return 4;
    if (level >= 7)
        return 3;
    return 2;
}
//# sourceMappingURL=skill-pane.js.map