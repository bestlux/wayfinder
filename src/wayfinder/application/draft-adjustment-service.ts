import type { EffectiveBuildState } from "../../build-state.js";
import type { AbilityKey, BoostLevel, DraftState, PendingStep } from "../../types.js";
import { SLOT_IDS } from "../slot-ids.js";

type BoostRecord = Record<string, { value: AbilityKey[]; selected: AbilityKey | null }>;

export interface DraftAdjustmentState {
  draft: DraftState;
  recentlyInvalidatedStepIds: Set<string>;
}

export function setManualStepComplete(state: DraftAdjustmentState, stepId: string, complete: boolean): boolean {
  state.draft.manual[stepId] = complete;
  return true;
}

export function toggleSkillIncreaseSelection(state: DraftAdjustmentState, stepId: string, slug: string): boolean {
  if (state.draft.skillIncreases[stepId] === slug) {
    delete state.draft.skillIncreases[stepId];
  } else {
    state.draft.skillIncreases[stepId] = slug;
  }

  return true;
}

export function setTrainingRuleSelection(
  state: DraftAdjustmentState,
  stepId: string,
  key: string,
  slug: string
): boolean {
  state.draft.skillTrainings[stepId] ??= emptyTrainingDraft();
  state.draft.skillTrainings[stepId].ruleChoices[key] = slug;
  return true;
}

export function toggleTrainingSkillSelection(
  state: DraftAdjustmentState,
  step: PendingStep | null,
  slug: string
): boolean {
  const stepId = step?.slotId;
  if (!stepId) {
    return false;
  }

  const additionalCount = step.training?.additionalCount ?? 0;
  state.draft.skillTrainings[stepId] ??= emptyTrainingDraft();
  const current = state.draft.skillTrainings[stepId].additional;
  state.draft.skillTrainings[stepId].additional = current.includes(slug)
    ? current.filter((entry) => entry !== slug)
    : [...current, slug].slice(0, additionalCount);
  return true;
}

export function setTrainingLoreSelection(
  state: DraftAdjustmentState,
  step: PendingStep | null,
  key: string,
  rawValue: string
): boolean {
  const stepId = step?.slotId;
  const loreMeta =
    step?.kind === "skill-training" ? step.training?.loreChoices.find((entry) => entry.key === key) : null;
  if (!stepId || !loreMeta) {
    return false;
  }

  state.draft.skillTrainings[stepId] ??= emptyTrainingDraft();
  const normalized = normalizeLoreDraftValue(
    rawValue,
    loreMeta.placeholder,
    loreMeta.allowCustom,
    loreMeta.suggestions
  );

  if (!normalized) {
    delete state.draft.skillTrainings[stepId].loreChoices[key];
    return true;
  }

  state.draft.skillTrainings[stepId].loreChoices[key] = normalized;
  return true;
}

export function toggleAncestryMode(
  state: DraftAdjustmentState,
  ancestryMode: "standard" | "alternate" | null
): boolean {
  if (!ancestryMode) {
    return false;
  }

  state.draft.boosts.ancestry.modeTouched = true;
  state.draft.boosts.ancestry.mode = ancestryMode === "alternate" ? "standard" : "alternate";
  if (state.draft.boosts.ancestry.mode === "alternate") {
    state.draft.boosts.ancestry.selectedBoosts = {};
  } else {
    state.draft.boosts.ancestry.alternateBoosts = [];
  }
  return true;
}

export function toggleVoluntaryEnabled(state: DraftAdjustmentState): boolean {
  const voluntary = state.draft.boosts.ancestry.voluntary;
  voluntary.touched = true;
  voluntary.enabled = !voluntary.enabled;
  if (!voluntary.enabled) {
    voluntary.legacy = false;
    voluntary.boost = null;
    voluntary.flaws = [];
  }
  return true;
}

export function toggleVoluntaryLegacy(state: DraftAdjustmentState): boolean {
  const voluntary = state.draft.boosts.ancestry.voluntary;
  voluntary.touched = true;
  voluntary.enabled = true;
  voluntary.legacy = !voluntary.legacy;
  if (!voluntary.legacy) {
    voluntary.boost = null;
    voluntary.flaws = Array.from(new Set(voluntary.flaws));
  } else {
    voluntary.flaws = voluntary.flaws.slice(0, 2);
  }
  return true;
}

export function toggleBoostChoice(
  state: DraftAdjustmentState,
  effectiveBuildState: EffectiveBuildState,
  stepId: string,
  section: string,
  attribute: AbilityKey
): boolean {
  switch (section) {
    case "ancestry":
      if (!effectiveBuildState.ancestry) {
        return false;
      }
      if (effectiveBuildState.ancestry.mode === "alternate") {
        const current = state.draft.boosts.ancestry.alternateBoosts;
        state.draft.boosts.ancestry.alternateBoosts = current.includes(attribute)
          ? current.filter((entry) => entry !== attribute)
          : [...current, attribute].slice(0, 2);
      } else {
        toggleSlotRecordChoice(
          state.draft.boosts.ancestry.selectedBoosts,
          effectiveBuildState.ancestry.document?.system?.boosts,
          attribute
        );
      }
      break;
    case "background":
      if (!effectiveBuildState.background) {
        return false;
      }
      toggleSlotRecordChoice(
        state.draft.boosts.background.selectedBoosts,
        effectiveBuildState.background.document?.system?.boosts,
        attribute
      );
      break;
    case "class":
      state.draft.boosts.class.keyAbility = state.draft.boosts.class.keyAbility === attribute ? null : attribute;
      break;
    case "level-1":
    case "level-5":
    case "level-10":
    case "level-15":
    case "level-20": {
      const level = section.split("-")[1] ?? "";
      const numericLevel = Number(level) as BoostLevel;
      const selected = state.draft.boosts.levels[level] ?? [...effectiveBuildState.levelBoosts[numericLevel]];
      state.draft.boosts.levels[level] = selected.includes(attribute)
        ? selected.filter((entry) => entry !== attribute)
        : [...selected, attribute].slice(0, effectiveBuildState.allowedBoosts[numericLevel]);
      break;
    }
    default:
      return false;
  }

  state.recentlyInvalidatedStepIds.delete(stepId);
  return true;
}

export function toggleVoluntaryChoice(
  state: DraftAdjustmentState,
  ancestry: EffectiveBuildState["ancestry"],
  stepId: string,
  attribute: AbilityKey,
  choiceKind: "flaw" | "second-flaw" | "boost"
): boolean {
  if (!ancestry) {
    return false;
  }

  const voluntary = state.draft.boosts.ancestry.voluntary;
  if (!voluntary.enabled) {
    return false;
  }
  voluntary.touched = true;

  const flaws = [...voluntary.flaws];
  const numFlaws = flaws.filter((entry) => entry === attribute).length;

  if (choiceKind === "flaw") {
    if (numFlaws > 0) {
      flaws.splice(flaws.indexOf(attribute), 1);
    } else if (!voluntary.legacy || flaws.length < 2) {
      flaws.push(attribute);
    }
  } else if (choiceKind === "second-flaw") {
    if (!voluntary.legacy || !ancestry.lockedBoosts.includes(attribute) || numFlaws === 0) {
      return false;
    }

    if (numFlaws > 1) {
      flaws.splice(flaws.lastIndexOf(attribute), 1);
    } else if (flaws.length < 2) {
      flaws.push(attribute);
    }
  } else if (choiceKind === "boost" && voluntary.legacy && flaws.length >= 2) {
    voluntary.boost = voluntary.boost === attribute ? null : attribute;
  }

  voluntary.flaws = flaws;
  state.recentlyInvalidatedStepIds.delete(stepId);
  return true;
}

export function adjustDraftTargetLevel(draft: DraftState, currentLevel: number, delta: number): boolean {
  const nextTargetLevel = Math.min(20, Math.max(currentLevel, draft.targetLevel + delta));
  if (nextTargetLevel === draft.targetLevel) {
    return false;
  }

  draft.targetLevel = nextTargetLevel;
  return true;
}

export function syncLanguageChoiceSelections(
  state: DraftAdjustmentState,
  effectiveBuildState: EffectiveBuildState
): boolean {
  const languageState = effectiveBuildState.languages;
  const current = state.draft.languageChoices[SLOT_IDS.languageChoice] ?? [];
  if (current.length === 0) {
    return false;
  }

  const allowed = new Set(languageState?.selectableLanguages ?? []);
  const maxSelections = languageState?.maxSelections ?? 0;
  const next = current.filter((slug) => allowed.has(slug)).slice(0, maxSelections);
  if (next.length === current.length && next.every((slug, index) => slug === current[index])) {
    return false;
  }

  if (next.length > 0) {
    state.draft.languageChoices[SLOT_IDS.languageChoice] = next;
  } else {
    delete state.draft.languageChoices[SLOT_IDS.languageChoice];
  }
  state.recentlyInvalidatedStepIds.add(SLOT_IDS.languageChoice);
  return true;
}

export function syncSkillTrainingSelections(state: DraftAdjustmentState, steps: PendingStep[]): boolean {
  let changed = false;

  for (const step of steps) {
    if (step.kind !== "skill-training") {
      continue;
    }

    const current = state.draft.skillTrainings[step.slotId];
    if (!current) {
      continue;
    }

    let nextChanged = false;
    if (current.additional.length > step.training.additionalCount) {
      current.additional = current.additional.slice(0, step.training.additionalCount);
      nextChanged = true;
    }

    const allowedRuleKeys = new Set(step.training.choiceRules.map((choice) => choice.key));
    const validRuleChoices = Object.fromEntries(
      Object.entries(current.ruleChoices).filter(([key, value]) => {
        if (!allowedRuleKeys.has(key) || typeof value !== "string" || value.length === 0) {
          return false;
        }

        const choice = step.training.choiceRules.find((entry) => entry.key === key);
        return !!choice?.options.some((option) => option.slug === value);
      })
    );
    if (Object.keys(validRuleChoices).length !== Object.keys(current.ruleChoices).length) {
      current.ruleChoices = validRuleChoices;
      nextChanged = true;
    }

    const allowedLoreKeys = new Set(step.training.loreChoices.map((choice) => choice.key));
    const validLoreChoices = Object.fromEntries(
      Object.entries(current.loreChoices).filter(([key, value]) => {
        if (!allowedLoreKeys.has(key) || typeof value !== "string" || value.trim().length === 0) {
          return false;
        }

        const choice = step.training.loreChoices.find((entry) => entry.key === key);
        return (
          !!choice && (choice.allowCustom || choice.suggestions.some((suggestion) => sameLoreValue(suggestion, value)))
        );
      })
    );
    if (Object.keys(validLoreChoices).length !== Object.keys(current.loreChoices).length) {
      current.loreChoices = validLoreChoices;
      nextChanged = true;
    }

    if (nextChanged) {
      state.recentlyInvalidatedStepIds.add(step.slotId);
      changed = true;
    }
  }

  return changed;
}

function emptyTrainingDraft() {
  return { ruleChoices: {}, additional: [], loreChoices: {} };
}

function normalizeLoreDraftValue(
  value: string,
  placeholder: string,
  allowCustom: boolean,
  suggestions: string[]
): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return null;
  }

  const matchingSuggestion = suggestions.find((suggestion) => sameLoreValue(suggestion, trimmed));
  if (matchingSuggestion) {
    return matchingSuggestion;
  }

  if (!allowCustom) {
    return null;
  }

  const fallback = /\blore\b$/i.test(trimmed) ? trimmed : `${trimmed} Lore`;
  const normalizedPlaceholder = placeholder.trim();
  if (!normalizedPlaceholder) {
    return fallback;
  }

  return sameLoreValue(fallback, normalizedPlaceholder) ? normalizedPlaceholder : fallback;
}

function sameLoreValue(left: string, right: string): boolean {
  return left.trim().replace(/\s+/g, " ").toLowerCase() === right.trim().replace(/\s+/g, " ").toLowerCase();
}

function toggleSlotRecordChoice(
  selectedBoosts: Record<string, AbilityKey | null>,
  record: BoostRecord | undefined,
  attribute: AbilityKey
): void {
  const selectedEntry = Object.entries(selectedBoosts).find(([, value]) => value === attribute);
  if (selectedEntry) {
    selectedBoosts[selectedEntry[0]] = null;
    return;
  }

  const candidate = Object.entries(record ?? {}).find(
    ([slot, boost]) => !selectedBoosts[slot] && Array.isArray(boost?.value) && boost.value.includes(attribute)
  );
  if (candidate) {
    selectedBoosts[candidate[0]] = attribute;
  }
}
