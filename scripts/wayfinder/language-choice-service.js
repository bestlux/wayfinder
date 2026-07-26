import { remainingCreationBoostChoices } from "./domain/boost-rules.js";
import { SLOT_IDS } from "./domain/slot-ids.js";
import { createLanguageChoiceStep } from "./domain/step-types.js";
import { formatSlug } from "./formatting.js";
export async function buildLanguageChoiceSteps(params) {
    if (params.targetLevel < 1 || (!params.snapshot.isBlank && params.snapshot.level > 1)) {
        return [];
    }
    if (!params.effectiveBuildState.ancestry ||
        !params.effectiveBuildState.background ||
        !params.effectiveBuildState.class) {
        return [];
    }
    if (remainingCreationBoostChoices(params.effectiveBuildState) > 0) {
        return [];
    }
    const languageState = params.effectiveBuildState.languages;
    if (!languageState || languageState.maxSelections <= 0) {
        return [];
    }
    const selectableLanguages = resolveSelectableLanguages(languageState, params.availableLanguageSlugs);
    if (selectableLanguages.length === 0) {
        return [];
    }
    const draftSelections = params.draft.languageChoices[SLOT_IDS.languageChoice] ?? [];
    const existingSelections = params.readExistingLanguageSelections();
    if (draftSelections.length === 0 && existingSelections.length === languageState.maxSelections) {
        return [];
    }
    const ancestryName = params.effectiveBuildState.ancestry.document.name ?? "Ancestry";
    return [
        createLanguageChoiceStep(1, {
            slotId: SLOT_IDS.languageChoice,
            sourceItemType: "ancestry",
            sourceName: ancestryName,
            grantedLanguages: languageState.grantedLanguages,
            count: languageState.maxSelections,
            options: selectableLanguages.map((option) => ({
                value: option.slug,
                label: params.localizeLanguage(option.slug),
                requiresGmApproval: option.requiresGmApproval,
            })),
        }, {
            title: "Bonus languages",
            description: buildLanguageChoiceDescription(ancestryName, languageState.maxSelections, selectableLanguages.some((option) => option.requiresGmApproval)),
        }),
    ];
}
function buildLanguageChoiceDescription(sourceName, count, hasGmApprovalOptions) {
    const label = count === 1 ? "1 additional language" : `${count} additional languages`;
    const base = `Choose ${label} from ${formatSlug(sourceName).toLowerCase()} and Intelligence-based language options.`;
    return hasGmApprovalOptions
        ? `${base} Options beyond ${formatSlug(sourceName)}'s ancestry list require GM approval.`
        : base;
}
function resolveSelectableLanguages(languageState, availableLanguageSlugs) {
    const ancestryLanguages = normalizeLanguageSlugs(languageState.selectableLanguages);
    const ancestryLanguageSet = new Set(ancestryLanguages);
    const hasAncestryList = ancestryLanguages.length > 0;
    const source = availableLanguageSlugs === undefined ? ancestryLanguages : normalizeLanguageSlugs(availableLanguageSlugs);
    const granted = new Set(languageState.grantedLanguages);
    return source
        .filter((slug) => !granted.has(slug))
        .map((slug) => ({
        slug,
        requiresGmApproval: hasAncestryList && !ancestryLanguageSet.has(slug),
    }));
}
function normalizeLanguageSlugs(slugs) {
    return Array.from(new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean)));
}
//# sourceMappingURL=language-choice-service.js.map