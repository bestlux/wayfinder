import { SLOT_IDS } from "../slot-ids.js";
export function setManualStepComplete(state, stepId, complete) {
    state.draft.manual[stepId] = complete;
    return true;
}
export function toggleSkillIncreaseSelection(state, stepId, slug) {
    if (state.draft.skillIncreases[stepId] === slug) {
        delete state.draft.skillIncreases[stepId];
    }
    else {
        state.draft.skillIncreases[stepId] = slug;
    }
    return true;
}
export function setTrainingRuleSelection(state, stepId, flag, slug) {
    state.draft.skillTrainings[stepId] ??= { ruleChoices: {}, additional: [] };
    state.draft.skillTrainings[stepId].ruleChoices[flag] = slug;
    return true;
}
export function toggleTrainingSkillSelection(state, step, slug) {
    const stepId = step?.slotId;
    if (!stepId) {
        return false;
    }
    const additionalCount = step.training?.additionalCount ?? 0;
    state.draft.skillTrainings[stepId] ??= { ruleChoices: {}, additional: [] };
    const current = state.draft.skillTrainings[stepId].additional;
    state.draft.skillTrainings[stepId].additional = current.includes(slug)
        ? current.filter((entry) => entry !== slug)
        : [...current, slug].slice(0, additionalCount);
    return true;
}
export function toggleAncestryMode(state, ancestryMode) {
    if (!ancestryMode) {
        return false;
    }
    state.draft.boosts.ancestry.modeTouched = true;
    state.draft.boosts.ancestry.mode = ancestryMode === "alternate" ? "standard" : "alternate";
    if (state.draft.boosts.ancestry.mode === "alternate") {
        state.draft.boosts.ancestry.selectedBoosts = {};
    }
    else {
        state.draft.boosts.ancestry.alternateBoosts = [];
    }
    return true;
}
export function toggleVoluntaryEnabled(state) {
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
export function toggleVoluntaryLegacy(state) {
    const voluntary = state.draft.boosts.ancestry.voluntary;
    voluntary.touched = true;
    voluntary.enabled = true;
    voluntary.legacy = !voluntary.legacy;
    if (!voluntary.legacy) {
        voluntary.boost = null;
        voluntary.flaws = Array.from(new Set(voluntary.flaws));
    }
    else {
        voluntary.flaws = voluntary.flaws.slice(0, 2);
    }
    return true;
}
export function toggleBoostChoice(state, effectiveBuildState, stepId, section, attribute) {
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
            }
            else {
                toggleSlotRecordChoice(state.draft.boosts.ancestry.selectedBoosts, effectiveBuildState.ancestry.document?.system?.boosts, attribute);
            }
            break;
        case "background":
            if (!effectiveBuildState.background) {
                return false;
            }
            toggleSlotRecordChoice(state.draft.boosts.background.selectedBoosts, effectiveBuildState.background.document?.system?.boosts, attribute);
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
            const numericLevel = Number(level);
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
export function toggleVoluntaryChoice(state, ancestry, stepId, attribute, choiceKind) {
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
        }
        else if (!voluntary.legacy || flaws.length < 2) {
            flaws.push(attribute);
        }
    }
    else if (choiceKind === "second-flaw") {
        if (!voluntary.legacy || !ancestry.lockedBoosts.includes(attribute) || numFlaws === 0) {
            return false;
        }
        if (numFlaws > 1) {
            flaws.splice(flaws.lastIndexOf(attribute), 1);
        }
        else if (flaws.length < 2) {
            flaws.push(attribute);
        }
    }
    else if (choiceKind === "boost" && voluntary.legacy && flaws.length >= 2) {
        voluntary.boost = voluntary.boost === attribute ? null : attribute;
    }
    voluntary.flaws = flaws;
    state.recentlyInvalidatedStepIds.delete(stepId);
    return true;
}
export function adjustDraftTargetLevel(draft, currentLevel, delta) {
    const nextTargetLevel = Math.min(20, Math.max(currentLevel, draft.targetLevel + delta));
    if (nextTargetLevel === draft.targetLevel) {
        return false;
    }
    draft.targetLevel = nextTargetLevel;
    return true;
}
export function syncLanguageChoiceSelections(state, effectiveBuildState) {
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
    }
    else {
        delete state.draft.languageChoices[SLOT_IDS.languageChoice];
    }
    state.recentlyInvalidatedStepIds.add(SLOT_IDS.languageChoice);
    return true;
}
function toggleSlotRecordChoice(selectedBoosts, record, attribute) {
    const selectedEntry = Object.entries(selectedBoosts).find(([, value]) => value === attribute);
    if (selectedEntry) {
        selectedBoosts[selectedEntry[0]] = null;
        return;
    }
    const candidate = Object.entries(record ?? {}).find(([slot, boost]) => !selectedBoosts[slot] && Array.isArray(boost?.value) && boost.value.includes(attribute));
    if (candidate) {
        selectedBoosts[candidate[0]] = attribute;
    }
}
//# sourceMappingURL=draft-adjustment-service.js.map