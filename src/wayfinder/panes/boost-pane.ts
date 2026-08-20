import type { EffectiveBuildState } from "../../build-state.js";
import { ABILITY_KEYS } from "../../constants.js";
import type { AbilityKey, BoostStep, PendingStep } from "../../types.js";
import { canChooseFromSlotRecord, requiredBoostSlots } from "../domain/boost-rules.js";

export {
  canChooseFromSlotRecord,
  isAncestryBoostSectionComplete,
  isBackgroundBoostSectionComplete,
  isClassBoostSectionComplete,
  remainingCreationBoostChoices,
  requiredBoostSlots,
} from "../domain/boost-rules.js";

import type { BoostStepPane } from "../view-models.js";

type BoostRecord = Record<string, { value: AbilityKey[]; selected: AbilityKey | null }>;

interface BoostPaneDependencies {
  isStepComplete: (step: PendingStep, effectiveBuildState: EffectiveBuildState) => Promise<boolean>;
  stepStatus: (step: PendingStep, effectiveBuildState: EffectiveBuildState) => Promise<string>;
  abilityLabel: (attribute: AbilityKey) => string;
}

export async function buildBoostPane(
  step: BoostStep,
  effectiveBuildState: EffectiveBuildState,
  deps: BoostPaneDependencies
): Promise<BoostStepPane> {
  const isCreationStep = step.level === 1;
  const selectedBatchBoosts = effectiveBuildState.levelBoosts[step.boost.batchLevel];
  const missingPriorGradualBoost =
    step.boost.grantCount === 1 && selectedBatchBoosts.length < step.boost.requiredCount - step.boost.grantCount;
  const blockedForCreation =
    isCreationStep && (!effectiveBuildState.ancestry || !effectiveBuildState.background || !effectiveBuildState.class);
  const blocked = blockedForCreation || missingPriorGradualBoost;
  const abilitySummary = Object.values(effectiveBuildState.projectedAbilities).map((entry) => ({
    attribute: entry.key,
    label: deps.abilityLabel(entry.key),
    modifierLabel: `${entry.modifier >= 0 ? "+" : ""}${entry.modifier}`,
    partial: entry.partial,
  }));

  return {
    kind: "boost",
    templateKind: "boost",
    stepId: step.id,
    slotId: step.slotId,
    level: step.level,
    modeLabel: "Boosts",
    title: step.title,
    description: step.description,
    blocked,
    blockedTitle: blockedForCreation
      ? "Choose ancestry, background, and class first"
      : missingPriorGradualBoost
        ? "Finish the earlier boost first"
        : null,
    blockedMessage: blockedForCreation
      ? "Your ancestry, background, and class each hand you boosts, so Wayfinder needs all three before it can lay this out."
      : missingPriorGradualBoost
        ? `PF2E treats levels ${step.boost.batchLevel - 3} through ${step.boost.batchLevel} as one batch, in order. Fill in the earlier levels first.`
        : null,
    completed: await deps.isStepComplete(step, effectiveBuildState),
    selectedLabel: await deps.stepStatus(step, effectiveBuildState),
    abilitySummary,
    ancestrySection:
      isCreationStep && effectiveBuildState.ancestry
        ? buildAncestryBoostSection(effectiveBuildState, deps.abilityLabel)
        : null,
    voluntarySection:
      isCreationStep && effectiveBuildState.ancestry
        ? buildVoluntaryFlawSection(effectiveBuildState, deps.abilityLabel)
        : null,
    backgroundSection:
      isCreationStep && effectiveBuildState.background
        ? buildBackgroundBoostSection(effectiveBuildState, deps.abilityLabel)
        : null,
    classSection:
      isCreationStep && effectiveBuildState.class
        ? buildClassBoostSection(effectiveBuildState, deps.abilityLabel)
        : null,
    levelSection: buildLevelBoostSection(step, effectiveBuildState, deps.abilityLabel),
  };
}

function buildAncestryBoostSection(
  effectiveBuildState: EffectiveBuildState,
  abilityLabel: BoostPaneDependencies["abilityLabel"]
): BoostStepPane["ancestrySection"] {
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

  const selected = Object.values(ancestry.selectedBoosts).filter((ability): ability is AbilityKey => ability !== null);
  return {
    mode: "standard",
    canToggleAlternate: true,
    remaining: requiredBoostSlots(ancestry.document?.system?.boosts) - selected.length,
    buttons: ABILITY_KEYS.map((attribute) => ({
      attribute,
      label: abilityLabel(attribute),
      selected: selected.includes(attribute),
      disabled:
        !selected.includes(attribute) &&
        !canChooseFromSlotRecord(ancestry.document?.system?.boosts, ancestry.selectedBoosts, attribute),
    })),
  };
}

function buildVoluntaryFlawSection(
  effectiveBuildState: EffectiveBuildState,
  abilityLabel: BoostPaneDependencies["abilityLabel"]
): BoostStepPane["voluntarySection"] {
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
        secondFlawDisabled:
          !ancestry.voluntary.enabled || !showSecondFlaw || !flawSelected || (numFlaws < 2 && flawsComplete),
        showSecondFlaw,
        boostSelected,
        boostDisabled:
          !ancestry.voluntary.enabled ||
          !ancestry.voluntary.legacy ||
          (!boostSelected && (!flawsComplete || !!ancestry.voluntary.boost || netBoosted.includes(attribute))),
        showBoost: ancestry.voluntary.legacy,
      };
    }),
  };
}

function buildBackgroundBoostSection(
  effectiveBuildState: EffectiveBuildState,
  abilityLabel: BoostPaneDependencies["abilityLabel"]
): BoostStepPane["backgroundSection"] {
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
      disabled:
        !background.buildBoosts.includes(attribute) &&
        !canChooseFromSlotRecord(background.document?.system?.boosts, background.selectedBoosts, attribute),
    })),
  };
}

function buildClassBoostSection(
  effectiveBuildState: EffectiveBuildState,
  abilityLabel: BoostPaneDependencies["abilityLabel"]
): BoostStepPane["classSection"] {
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

function buildLevelBoostSection(
  step: BoostStep,
  effectiveBuildState: EffectiveBuildState,
  abilityLabel: BoostPaneDependencies["abilityLabel"]
): BoostStepPane["levelSection"] {
  const selected = effectiveBuildState.levelBoosts[step.boost.batchLevel];
  const allowed = step.boost.requiredCount;
  const gradualSelectionIndex = step.boost.grantCount === 1 ? allowed - 1 : null;
  const gradualSelection = gradualSelectionIndex === null ? null : (selected[gradualSelectionIndex] ?? null);
  return {
    level: step.level,
    batchLevel: step.boost.batchLevel,
    remaining: gradualSelectionIndex === null ? Math.max(0, allowed - selected.length) : Number(!gradualSelection),
    buttons: ABILITY_KEYS.map((attribute) => ({
      attribute,
      label: abilityLabel(attribute),
      selected: gradualSelectionIndex === null ? selected.includes(attribute) : gradualSelection === attribute,
      disabled:
        gradualSelectionIndex === null
          ? !selected.includes(attribute) && selected.length >= allowed
          : selected.some((entry, index) => index !== gradualSelectionIndex && entry === attribute),
      partial:
        effectiveBuildState.projectedAbilities[attribute].partial &&
        (gradualSelectionIndex === null ? selected.includes(attribute) : gradualSelection === attribute),
    })),
  };
}

export function toggleSlotRecordChoice(
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
