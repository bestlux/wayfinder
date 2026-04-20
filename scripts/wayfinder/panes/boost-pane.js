import { ABILITY_KEYS } from "../../constants.js";
import { canChooseFromSlotRecord, requiredBoostSlots } from "../domain/boost-rules.js";
export { canChooseFromSlotRecord, isAncestryBoostSectionComplete, isBackgroundBoostSectionComplete, isClassBoostSectionComplete, remainingCreationBoostChoices, requiredBoostSlots, } from "../domain/boost-rules.js";
export async function buildBoostPane(step, effectiveBuildState, deps) {
    const isCreationStep = step.level === 1;
    const blocked = isCreationStep && (!effectiveBuildState.ancestry || !effectiveBuildState.background || !effectiveBuildState.class);
    const abilitySummary = Object.values(effectiveBuildState.projectedAbilities).map((entry) => ({
        attribute: entry.key,
        label: deps.abilityLabel(entry.key),
        modifierLabel: `${entry.modifier >= 0 ? "+" : ""}${entry.modifier}`,
        partial: entry.partial,
    }));
    return {
        kind: "boost",
        isPickItem: false,
        isManual: false,
        isBoost: true,
        isSkillIncrease: false,
        isSkillTraining: false,
        isClassChoice: false,
        isSpellChoice: false,
        stepId: step.id,
        slotId: step.slotId,
        level: step.level,
        modeLabel: "Boosts",
        title: step.title,
        description: step.description,
        blocked,
        blockedTitle: blocked ? "Choose ancestry, background, and class first" : null,
        blockedMessage: blocked
            ? "Wayfinder needs the drafted ancestry, background, and class before it can offer a legal creation-boost layout."
            : null,
        completed: await deps.isStepComplete(step, effectiveBuildState),
        selectedLabel: await deps.stepStatus(step, effectiveBuildState),
        abilitySummary,
        ancestrySection: isCreationStep && effectiveBuildState.ancestry
            ? buildAncestryBoostSection(effectiveBuildState, deps.abilityLabel)
            : null,
        voluntarySection: isCreationStep && effectiveBuildState.ancestry
            ? buildVoluntaryFlawSection(effectiveBuildState, deps.abilityLabel)
            : null,
        backgroundSection: isCreationStep && effectiveBuildState.background
            ? buildBackgroundBoostSection(effectiveBuildState, deps.abilityLabel)
            : null,
        classSection: isCreationStep && effectiveBuildState.class
            ? buildClassBoostSection(effectiveBuildState, deps.abilityLabel)
            : null,
        levelSection: buildLevelBoostSection(step.level, effectiveBuildState, deps.abilityLabel),
    };
}
function buildAncestryBoostSection(effectiveBuildState, abilityLabel) {
    const ancestry = effectiveBuildState.ancestry;
    if (!ancestry) {
        return null;
    }
    if (ancestry.mode === "alternate") {
        return {
            mode: "alternate",
            canToggleAlternate: true,
            remaining: Math.max(0, 2 - ancestry.alternateBoosts.length),
            buttons: ABILITY_KEYS.map((attribute) => ({
                attribute,
                label: abilityLabel(attribute),
                selected: ancestry.alternateBoosts.includes(attribute),
                disabled: !ancestry.alternateBoosts.includes(attribute) && ancestry.alternateBoosts.length >= 2,
            })),
        };
    }
    const selected = Object.values(ancestry.selectedBoosts).filter((ability) => ability !== null);
    return {
        mode: "standard",
        canToggleAlternate: true,
        remaining: requiredBoostSlots(ancestry.document?.system?.boosts) - selected.length,
        buttons: ABILITY_KEYS.map((attribute) => ({
            attribute,
            label: abilityLabel(attribute),
            selected: selected.includes(attribute),
            disabled: !selected.includes(attribute) &&
                !canChooseFromSlotRecord(ancestry.document?.system?.boosts, ancestry.selectedBoosts, attribute),
        })),
    };
}
function buildVoluntaryFlawSection(effectiveBuildState, abilityLabel) {
    const ancestry = effectiveBuildState.ancestry;
    if (!ancestry) {
        return null;
    }
    const netBoosted = ancestry.buildBoosts.filter((attribute) => !ancestry.buildFlaws.includes(attribute));
    const flawsComplete = ancestry.voluntary.legacy && ancestry.voluntary.flaws.length >= 2;
    return {
        enabled: ancestry.voluntary.enabled,
        legacy: ancestry.voluntary.legacy,
        buttons: ABILITY_KEYS.map((attribute) => {
            const numFlaws = ancestry.voluntary.flaws.filter((entry) => entry === attribute).length;
            const flawSelected = numFlaws > 0;
            const showSecondFlaw = ancestry.voluntary.legacy && ancestry.lockedBoosts.includes(attribute);
            const boostSelected = ancestry.voluntary.boost === attribute;
            return {
                attribute,
                label: abilityLabel(attribute),
                flawSelected,
                flawDisabled: !ancestry.voluntary.enabled || (!flawSelected && ancestry.voluntary.legacy && flawsComplete),
                secondFlawSelected: numFlaws > 1,
                secondFlawDisabled: !ancestry.voluntary.enabled || !showSecondFlaw || !flawSelected || (numFlaws < 2 && flawsComplete),
                showSecondFlaw,
                boostSelected,
                boostDisabled: !ancestry.voluntary.enabled ||
                    !ancestry.voluntary.legacy ||
                    (!boostSelected && (!flawsComplete || !!ancestry.voluntary.boost || netBoosted.includes(attribute))),
                showBoost: ancestry.voluntary.legacy,
            };
        }),
    };
}
function buildBackgroundBoostSection(effectiveBuildState, abilityLabel) {
    const background = effectiveBuildState.background;
    if (!background) {
        return null;
    }
    return {
        remaining: requiredBoostSlots(background.document?.system?.boosts) - background.buildBoosts.length,
        buttons: ABILITY_KEYS.map((attribute) => ({
            attribute,
            label: abilityLabel(attribute),
            selected: background.buildBoosts.includes(attribute),
            disabled: !background.buildBoosts.includes(attribute) &&
                !canChooseFromSlotRecord(background.document?.system?.boosts, background.selectedBoosts, attribute),
        })),
    };
}
function buildClassBoostSection(effectiveBuildState, abilityLabel) {
    const classState = effectiveBuildState.class;
    if (!classState) {
        return null;
    }
    return {
        options: classState.keyAbilityOptions.map((attribute) => ({
            attribute,
            label: abilityLabel(attribute),
            selected: classState.selectedKeyAbility === attribute,
            disabled: false,
        })),
    };
}
function buildLevelBoostSection(level, effectiveBuildState, abilityLabel) {
    const selected = effectiveBuildState.levelBoosts[level];
    const allowed = effectiveBuildState.allowedBoosts[level];
    return {
        level,
        remaining: Math.max(0, allowed - selected.length),
        buttons: ABILITY_KEYS.map((attribute) => ({
            attribute,
            label: abilityLabel(attribute),
            selected: selected.includes(attribute),
            disabled: !selected.includes(attribute) && selected.length >= allowed,
            partial: effectiveBuildState.projectedAbilities[attribute].partial && selected.includes(attribute),
        })),
    };
}
export function toggleSlotRecordChoice(selectedBoosts, record, attribute) {
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
//# sourceMappingURL=boost-pane.js.map