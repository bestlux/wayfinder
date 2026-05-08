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
    const selectableLanguages = resolveSelectableLanguages(languageState, params.availableLanguageSlugs ?? []);
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
            options: selectableLanguages.map((slug) => ({
                value: slug,
                label: params.localizeLanguage(slug),
            })),
        }, {
            title: "Bonus languages",
            description: buildLanguageChoiceDescription(ancestryName, languageState.maxSelections),
        }),
    ];
}
function buildLanguageChoiceDescription(sourceName, count) {
    const label = count === 1 ? "1 additional language" : `${count} additional languages`;
    return `Choose ${label} from ${formatSlug(sourceName).toLowerCase()} and Intelligence-based language options.`;
}
function resolveSelectableLanguages(languageState, availableLanguageSlugs) {
    const source = languageState.selectableLanguages.length > 0 ? languageState.selectableLanguages : availableLanguageSlugs;
    const granted = new Set(languageState.grantedLanguages);
    return Array.from(new Set(source.map((slug) => slug.trim().toLowerCase()).filter(Boolean))).filter((slug) => !granted.has(slug));
}
//# sourceMappingURL=language-choice-service.js.map