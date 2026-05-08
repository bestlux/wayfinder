import type { EffectiveBuildState } from "../build-state.js";
import type { ActorSnapshot, DraftState, PendingStep } from "../types.js";
import { remainingCreationBoostChoices } from "./domain/boost-rules.js";
import { SLOT_IDS } from "./domain/slot-ids.js";
import { createLanguageChoiceStep } from "./domain/step-types.js";
import { formatSlug } from "./formatting.js";

interface BuildLanguageChoiceStepsParams {
  snapshot: ActorSnapshot;
  targetLevel: number;
  draft: DraftState;
  effectiveBuildState: EffectiveBuildState;
  availableLanguageSlugs?: string[];
  readExistingLanguageSelections: () => string[];
  localizeLanguage: (slug: string) => string;
}

export async function buildLanguageChoiceSteps(params: BuildLanguageChoiceStepsParams): Promise<PendingStep[]> {
  if (params.targetLevel < 1 || (!params.snapshot.isBlank && params.snapshot.level > 1)) {
    return [];
  }

  if (
    !params.effectiveBuildState.ancestry ||
    !params.effectiveBuildState.background ||
    !params.effectiveBuildState.class
  ) {
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
    createLanguageChoiceStep(
      1,
      {
        slotId: SLOT_IDS.languageChoice,
        sourceItemType: "ancestry",
        sourceName: ancestryName,
        grantedLanguages: languageState.grantedLanguages,
        count: languageState.maxSelections,
        options: selectableLanguages.map((slug) => ({
          value: slug,
          label: params.localizeLanguage(slug),
        })),
      },
      {
        title: "Bonus languages",
        description: buildLanguageChoiceDescription(ancestryName, languageState.maxSelections),
      }
    ),
  ];
}

function buildLanguageChoiceDescription(sourceName: string, count: number): string {
  const label = count === 1 ? "1 additional language" : `${count} additional languages`;
  return `Choose ${label} from ${formatSlug(sourceName).toLowerCase()} and Intelligence-based language options.`;
}

function resolveSelectableLanguages(
  languageState: NonNullable<EffectiveBuildState["languages"]>,
  availableLanguageSlugs: string[]
): string[] {
  const source =
    languageState.selectableLanguages.length > 0 ? languageState.selectableLanguages : availableLanguageSlugs;
  const granted = new Set(languageState.grantedLanguages);
  return Array.from(new Set(source.map((slug) => slug.trim().toLowerCase()).filter(Boolean))).filter(
    (slug) => !granted.has(slug)
  );
}
